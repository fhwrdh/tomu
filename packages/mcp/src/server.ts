import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { computeDilution, findTank, rollEquivalents, TANKS } from "@tomu/shared";

const API_BASE = process.env.TOMU_API_URL || "http://localhost:3456/api/v1";
const API_TOKEN = process.env.TOMU_API_TOKEN || "";

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_TOKEN}`,
      ...((options.headers as Record<string, string>) || {}),
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`API error ${res.status}: ${body.error || res.statusText}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

// ── Fuzzy matching helpers (Postel's Law) ──

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function tokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * Loose substring check — kept for filters where any partial signal is good enough.
 * Do NOT use this on a `.find()` over a list of similarly-named entities;
 * it will return the first candidate whose any token overlaps and silently pick
 * the wrong one (e.g. "Arista EDU Ultra 100" query → "Arista EDU 400 DX" stock).
 * For singular resolution, use `bestMatch()` instead.
 */
function fuzzyMatch(query: string, ...candidates: string[]): boolean {
  const q = normalize(query);
  return candidates.some((c) => {
    const n = normalize(c);
    return n.includes(q) || q.includes(n);
  });
}

/**
 * Score how well `query` matches a candidate's `fields`. Higher is better.
 * Token-overlap based: every query token that appears as a substring of any
 * candidate token scores 1; an exact token match scores 2. Ties broken by
 * fewer extra (unmatched) candidate tokens — preferring more-specific names.
 */
function score(query: string, fields: string[]): number {
  const qTokens = tokens(query);
  if (qTokens.length === 0) return 0;
  const cTokens = fields.flatMap(tokens);
  if (cTokens.length === 0) return 0;

  let matchScore = 0;
  let matched = 0;
  for (const qt of qTokens) {
    let best = 0;
    for (const ct of cTokens) {
      if (ct === qt) best = Math.max(best, 2);
      else if (ct.includes(qt) || qt.includes(ct)) best = Math.max(best, 1);
    }
    matchScore += best;
    if (best > 0) matched++;
  }

  // Require at least one token match. Penalize unmatched candidate tokens
  // mildly so "Arista EDU Ultra 100" beats "Arista EDU 400 DX" for a query
  // of "arista edu ultra 100".
  if (matched === 0) return 0;
  const extra = Math.max(0, cTokens.length - matched);
  return matchScore - extra * 0.1;
}

/**
 * Stricter stock match: requires every query token to appear as an *exact* token
 * in the candidate. Returns a single winner, ambiguous tied set, or none —
 * never silently picks a partial-token match (which is how "Kodak Ektapan"
 * once resolved to "Kodak Technical Pan").
 */
function strictStockMatch<T>(query: string, items: T[], fieldsOf: (item: T) => string[]): MatchResult<T> {
  const qTokens = tokens(query);
  if (qTokens.length === 0) return { kind: "none" };

  let bestScore = -1;
  let bestItems: T[] = [];
  for (const item of items) {
    const cTokens = fieldsOf(item).flatMap(tokens);
    const cSet = new Set(cTokens);
    if (!qTokens.every((qt) => cSet.has(qt))) continue;
    const extra = Math.max(0, cTokens.length - qTokens.length);
    const s = qTokens.length * 2 - extra * 0.1;
    if (s > bestScore) {
      bestScore = s;
      bestItems = [item];
    } else if (s === bestScore) {
      bestItems.push(item);
    }
  }

  if (bestItems.length === 0) return { kind: "none" };
  if (bestItems.length === 1) return { kind: "single", item: bestItems[0], score: bestScore };
  return { kind: "tied", items: bestItems, score: bestScore };
}

/** Pick the single best candidate from a list; null if none score above 0. */
function bestMatch<T>(query: string, items: T[], fieldsOf: (item: T) => string[]): T | null {
  let best: T | null = null;
  let bestScore = 0;
  for (const item of items) {
    const s = score(query, fieldsOf(item));
    if (s > bestScore) {
      bestScore = s;
      best = item;
    }
  }
  return best;
}

/**
 * Like bestMatch but reports ties so callers can refuse to silently pick.
 * Returns:
 *   { kind: "none" }      — no candidate scored above 0
 *   { kind: "single", … } — clear winner
 *   { kind: "tied", … }   — two or more candidates tied for top score
 */
type MatchResult<T> =
  | { kind: "none" }
  | { kind: "single"; item: T; score: number }
  | { kind: "tied"; items: T[]; score: number };

function rankedMatch<T>(query: string, items: T[], fieldsOf: (item: T) => string[]): MatchResult<T> {
  let bestScore = 0;
  let bestItems: T[] = [];
  for (const item of items) {
    const s = score(query, fieldsOf(item));
    if (s <= 0) continue;
    if (s > bestScore) {
      bestScore = s;
      bestItems = [item];
    } else if (s === bestScore) {
      bestItems.push(item);
    }
  }
  if (bestItems.length === 0) return { kind: "none" };
  if (bestItems.length === 1) return { kind: "single", item: bestItems[0], score: bestScore };
  return { kind: "tied", items: bestItems, score: bestScore };
}

// ── Server ──
//
// createServer() builds a fully tool-registered McpServer. Entry points pick
// the transport: index.ts (stdio, local) and http.ts (streamable HTTP, remote).
// Tool registrations below are intentionally not re-indented — everything down
// to the closing `return server` is the factory body.

export function createServer(): McpServer {

const server = new McpServer({
  name: "tomu",
  version: "0.1.0",
});

// ── Inventory item formatting ──

interface InventoryItem {
  id: string;
  filmStockId: string;
  manufacturer: string;
  stockName: string;
  iso: number;
  filmType: string;
  format: string;
  form: "factory_roll" | "bulk_roll" | "sheet";
  quantity: number;
  remainingLengthFt?: string | number | null;
  originalLengthFt?: string | number | null;
  expirationDate?: string | null;
  storageLocation: string;
}

function describeItem(item: InventoryItem): string {
  if (item.form === "bulk_roll") {
    const remaining = item.remainingLengthFt ? Number(item.remainingLengthFt) : 0;
    const original = item.originalLengthFt ? Number(item.originalLengthFt) : 0;
    return `${remaining}ft / ${original}ft bulk ${item.format}`;
  }
  if (item.form === "sheet") {
    return `${item.quantity} sheets ${item.format}`;
  }
  return `${item.quantity} rolls ${item.format}`;
}

// ── Tool: tomu_inventory ──

server.tool(
  "tomu_inventory",
  "Query film inventory. Shows what film you have, quantities, and expiration alerts. " +
    "Use without query to see everything, or search by film name/manufacturer/format.",
  {
    query: z.string().optional().describe("Optional search: film name, manufacturer, format, or type (e.g. 'Tri-X', 'Kodak', '120', 'bw')"),
  },
  async ({ query }) => {
    const { data } = await api<{ data: { items: InventoryItem[]; expiringSoon: InventoryItem[] } }>("/inventory/summary");
    const allItems = data.items;

    const filtered = query
      ? allItems.filter((i) =>
          fuzzyMatch(query, i.manufacturer, i.stockName, i.format, i.filmType, `ISO ${i.iso}`, `${i.iso}`)
        )
      : allItems;

    // Group by stock for display
    const byStock = new Map<string, InventoryItem[]>();
    for (const item of filtered) {
      const key = item.filmStockId;
      if (!byStock.has(key)) byStock.set(key, []);
      byStock.get(key)!.push(item);
    }

    const lines: string[] = [];
    lines.push(`## Film Inventory (${filtered.length} item${filtered.length === 1 ? "" : "s"} across ${byStock.size} stock${byStock.size === 1 ? "" : "s"})\n`);

    if (filtered.length === 0) {
      lines.push(query ? `No film matching "${query}" found.` : "Inventory is empty.");
    } else {
      for (const items of byStock.values()) {
        const first = items[0];
        lines.push(`- **${displayStock(first.manufacturer, first.stockName)}** (ISO ${first.iso}, ${first.filmType})`);
        for (const item of items) {
          const loc = item.storageLocation !== "fridge" ? ` [${item.storageLocation}]` : "";
          const exp = item.expirationDate ? ` — exp ${item.expirationDate}` : "";
          lines.push(`    - ${describeItem(item)}${loc}${exp}`);
        }
      }
    }

    if (data.expiringSoon.length > 0) {
      lines.push(`\n### Expiring Soon`);
      for (const item of data.expiringSoon) {
        lines.push(`- ${displayStock(item.manufacturer, item.stockName)}: ${describeItem(item)}, expires ${item.expirationDate}`);
      }
    }

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

// ── Tool: tomu_add_inventory ──

server.tool(
  "tomu_add_inventory",
  "Add film to inventory. Can reference film stock by name (fuzzy matched) or ID. " +
    "If the film stock doesn't exist yet, creates it automatically. " +
    "Supports factory rolls, bulk rolls (by length in feet), and sheet film.",
  {
    film: z.string().describe("Film stock name (e.g. 'Tri-X 400', 'Kodak Portra 400', 'HP5+')"),
    format: z.string().optional().describe("Film format: '35mm' (default), '120', '4x5', '8x10'"),
    form: z.string().optional().describe("Form: 'factory_roll' (default), 'bulk_roll', or 'sheet'"),
    quantity: z.number().int().positive().optional().describe("Number of rolls or sheets (required for factory_roll and sheet)"),
    lengthFt: z.number().positive().optional().describe("Length in feet for bulk_roll (e.g. 100 for a standard bulk roll)"),
    manufacturer: z.string().optional().describe("Manufacturer if creating new stock (e.g. 'Kodak', 'Ilford')"),
    iso: z.number().int().positive().optional().describe("ISO if creating new stock"),
    type: z.string().optional().describe("Film type if creating new stock: 'bw', 'color_negative', 'color_positive'"),
    expirationDate: z.string().optional().describe("Expiration date (YYYY-MM-DD)"),
    storageLocation: z.string().optional().describe("Storage: 'fridge' (default), 'freezer', 'room_temp'"),
    costPerRoll: z.number().optional().describe("Cost per roll/sheet in dollars"),
    source: z.string().optional().describe("Where acquired — vendor/retailer/free-text (e.g. 'amazon.com', 'Glazer's')"),
  },
  async ({ film, format, form, quantity, lengthFt, manufacturer, iso, type, expirationDate, storageLocation, costPerRoll, source }) => {
    const fmt = format || "35mm";
    const frm = (form || "factory_roll") as "factory_roll" | "bulk_roll" | "sheet";

    // Validate inputs by form
    if (frm === "bulk_roll" && !lengthFt) {
      return { content: [{ type: "text" as const, text: "Bulk rolls require `lengthFt` (e.g. 100)." }] };
    }
    if (frm !== "bulk_roll" && !quantity) {
      return { content: [{ type: "text" as const, text: `${frm === "sheet" ? "Sheets" : "Factory rolls"} require \`quantity\`.` }] };
    }

    // Find or create stock (stock no longer carries format — it's on the inventory item)
    const { data: stocks } = await api<{ data: Array<{ id: string; manufacturer: string; name: string; iso: number; type: string }> }>("/film-stocks");
    let stock = bestMatch(film, stocks, (s) => [`${s.manufacturer} ${s.name}`, s.name, s.manufacturer]);

    if (!stock) {
      if (!manufacturer || !iso) {
        return {
          content: [{
            type: "text" as const,
            text: `Film stock "${film}" not found. To create it, also provide: manufacturer, iso, and optionally type.`,
          }],
        };
      }
      const created = await api<{ data: typeof stock }>("/film-stocks", {
        method: "POST",
        body: JSON.stringify({
          manufacturer,
          name: film,
          iso,
          type: type || "bw",
        }),
      });
      stock = created.data!;
    }

    // Build inventory body by form
    const body: Record<string, unknown> = {
      filmStockId: stock.id,
      format: fmt,
      form: frm,
      storageLocation: storageLocation || "fridge",
    };
    if (frm === "bulk_roll") {
      body.originalLengthFt = lengthFt;
      body.remainingLengthFt = lengthFt;
    } else {
      body.quantity = quantity;
    }
    if (expirationDate) body.expirationDate = expirationDate;
    if (costPerRoll != null) body.costPerRoll = costPerRoll;
    if (source) body.source = source;

    await api("/inventory", { method: "POST", body: JSON.stringify(body) });

    const summary =
      frm === "bulk_roll"
        ? `${lengthFt}ft bulk roll`
        : `${quantity} ${frm === "sheet" ? "sheet(s)" : "roll(s)"}`;
    return {
      content: [{
        type: "text" as const,
        text: `Added ${summary} of **${displayStock(stock.manufacturer, stock.name)}** (${fmt}, ISO ${stock.iso}).${expirationDate ? ` Expires ${expirationDate}.` : ""}`,
      }],
    };
  }
);

// ── Tool: tomu_edit_inventory ─────────────────────────────────────────

/**
 * Normalize a loose expiration string to YYYY-MM-DD. Film boxes print month
 * precision ("2027.12" / "2027-12") or just a year; we store the *last day* of
 * that month/year so the stock counts as good through the printed period and
 * string-compares correctly against the expiring-soon cutoff.
 */
function coerceExpiration(input: string): string {
  const s = input.trim().replace(/[./]/g, "-");
  const ymd = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymd) {
    const [, y, m, d] = ymd;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const ym = s.match(/^(\d{4})-(\d{1,2})$/);
  if (ym) {
    const [, y, m] = ym;
    const lastDay = new Date(Number(y), Number(m), 0).getDate();
    return `${y}-${m.padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  }
  const yOnly = s.match(/^(\d{4})$/);
  if (yOnly) return `${yOnly[1]}-12-31`;
  return input; // leave anything unexpected untouched
}

interface InventoryRow {
  id: string;
  displayId?: string | null;
  filmStockId: string;
  manufacturer: string;
  stockName: string;
  iso: number;
  format: string;
  form: "factory_roll" | "bulk_roll" | "sheet";
  quantity: number;
  expirationDate?: string | null;
  storageLocation: string;
  costPerRoll?: string | number | null;
  source?: string | null;
}

server.tool(
  "tomu_edit_inventory",
  "Patch an existing inventory lot in place (does NOT add a new one). Use to fix or fill in " +
    "expiration, source/vendor, cost, storage, or quantity on film you already logged. " +
    "Identify the lot by film name (fuzzy) plus optional format/form to disambiguate, or by its " +
    "displayId (e.g. 'R001'). If more than one lot matches, the tool lists them so you can narrow it down.",
  {
    film: z.string().optional().describe("Film stock name to locate the lot (fuzzy: 'shanghai', 'hp5'). Omit if using displayId."),
    displayId: z.string().optional().describe("Lot display ID if it has one (e.g. 'R001'). Takes precedence over film/format/form."),
    format: z.string().optional().describe("Disambiguate by format: '35mm', '120', '4x5', '8x10'"),
    form: z.string().optional().describe("Disambiguate by form: 'factory_roll', 'bulk_roll', 'sheet'"),
    expirationDate: z.string().optional().describe("Set expiration (YYYY-MM-DD, or 'YYYY-MM' / 'YYYY' — coerced to a date)"),
    source: z.string().optional().describe("Set source/vendor (e.g. 'amazon.com')"),
    costPerRoll: z.number().positive().optional().describe("Set cost per roll/sheet in dollars"),
    storageLocation: z.string().optional().describe("Set storage: 'fridge', 'freezer', 'room_temp', 'other'"),
    quantity: z.number().int().min(0).optional().describe("Set quantity (rolls/sheets). Use to correct miscounts."),
    notes: z.string().optional().describe("Set notes (replaces existing notes)"),
  },
  async ({ film, displayId, format, form, expirationDate, source, costPerRoll, storageLocation, quantity, notes }) => {
    // Build the patch first so we can refuse no-op calls early.
    const patch: Record<string, unknown> = {};
    if (expirationDate !== undefined) patch.expirationDate = coerceExpiration(expirationDate);
    if (source !== undefined) patch.source = source;
    if (costPerRoll !== undefined) patch.costPerRoll = costPerRoll;
    if (storageLocation !== undefined) patch.storageLocation = storageLocation;
    if (quantity !== undefined) patch.quantity = quantity;
    if (notes !== undefined) patch.notes = notes;

    if (Object.keys(patch).length === 0) {
      return { content: [{ type: "text" as const, text: "Nothing to change — pass at least one field (expirationDate, source, costPerRoll, storageLocation, quantity, notes)." }] };
    }
    if (!film && !displayId) {
      return { content: [{ type: "text" as const, text: "Identify the lot: pass `film` (+ optional format/form) or `displayId`." }] };
    }

    const { data: rows } = await api<{ data: InventoryRow[] }>("/inventory");

    // Resolve candidate lot(s)
    let candidates: InventoryRow[];
    if (displayId) {
      candidates = rows.filter((r) => r.displayId === displayId);
      if (candidates.length === 0) {
        return { content: [{ type: "text" as const, text: `No inventory lot with displayId "${displayId}".` }] };
      }
    } else {
      const m = rankedMatch(film!, rows, (r) => [`${r.manufacturer} ${r.stockName}`, r.stockName, r.manufacturer]);
      if (m.kind === "none") {
        return { content: [{ type: "text" as const, text: `No inventory lot matching "${film}".` }] };
      }
      candidates = m.kind === "single" ? [m.item] : m.items;
      // Narrow by format/form when provided
      if (format) candidates = candidates.filter((r) => r.format === format);
      if (form) candidates = candidates.filter((r) => r.form === form);
    }

    if (candidates.length === 0) {
      return { content: [{ type: "text" as const, text: `Matched the stock, but no lot with that format/form. Drop the format/form filter to see options.` }] };
    }
    if (candidates.length > 1) {
      const lines = candidates.map((r) => {
        const id = r.displayId ? `[${r.displayId}] ` : `[${r.id.slice(0, 8)}] `;
        const exp = r.expirationDate ? `, exp ${r.expirationDate}` : "";
        const src = r.source ? `, src ${r.source}` : "";
        return `- ${id}${displayStock(r.manufacturer, r.stockName)} — ${describeItem(r as unknown as InventoryItem)}${exp}${src}`;
      });
      return { content: [{ type: "text" as const, text: `Multiple lots match — narrow with format/form (or displayId):\n${lines.join("\n")}` }] };
    }

    const lot = candidates[0];
    const updated = await api<{ data: InventoryRow }>(`/inventory/${lot.id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    const u = updated.data;

    const changes = Object.entries(patch).map(([k, v]) => `${k}=${v}`).join(", ");
    return {
      content: [{
        type: "text" as const,
        text: `Updated **${displayStock(u.manufacturer, u.stockName)}** (${u.format}, ${describeItem(u as unknown as InventoryItem)}): ${changes}.`,
      }],
    };
  }
);

// ── Tool: tomu_gear ──

server.tool(
  "tomu_gear",
  "List, add, or query cameras and lenses.",
  {
    action: z.enum(["list", "add_camera", "add_lens"]).describe("Action to perform"),
    make: z.string().optional().describe("Camera/lens manufacturer (e.g. 'Nikon', 'Hasselblad')"),
    model: z.string().optional().describe("Camera/lens model (e.g. 'F3', '500C/M', 'Nikkor 50mm f/1.4')"),
    format: z.string().optional().describe("Camera format: '35mm', '120', '4x5'"),
    focalLengthMm: z.number().int().optional().describe("Lens focal length in mm"),
    maxAperture: z.string().optional().describe("Lens max aperture (e.g. '1.4', '2.8')"),
    query: z.string().optional().describe("Search query for listing (filters by name)"),
  },
  async ({ action, make, model, format, focalLengthMm, maxAperture, query }) => {
    if (action === "list") {
      const [camerasRes, lensesRes] = await Promise.all([
        api<any>("/cameras"),
        api<any>("/lenses"),
      ]);

      let cams = camerasRes.data;
      let lens = lensesRes.data;

      if (query) {
        cams = cams.filter((c: any) => fuzzyMatch(query, c.make, c.model, c.format));
        lens = lens.filter((l: any) => fuzzyMatch(query, l.make, l.model, String(l.focalLengthMm || "")));
      }

      const lines: string[] = ["## Gear\n"];

      if (cams.length > 0) {
        lines.push("### Cameras");
        for (const c of cams) {
          lines.push(`- **${c.make} ${c.model}** (${c.format})${c.serialNumber ? ` S/N: ${c.serialNumber}` : ""}`);
        }
      }
      if (lens.length > 0) {
        lines.push("\n### Lenses");
        for (const l of lens) {
          const specs = [l.focalLengthMm ? `${l.focalLengthMm}mm` : null, l.maxAperture ? `f/${l.maxAperture}` : null]
            .filter(Boolean)
            .join(" ");
          lines.push(`- **${l.make} ${l.model}**${specs ? ` (${specs})` : ""}${l.serialNumber ? ` S/N: ${l.serialNumber}` : ""}`);
        }
      }
      if (cams.length === 0 && lens.length === 0) {
        lines.push("No gear registered yet.");
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }

    if (action === "add_camera") {
      if (!make || !model) {
        return { content: [{ type: "text" as const, text: "Need make and model to add a camera." }] };
      }
      const { data: cam } = await api<any>("/cameras", {
        method: "POST",
        body: JSON.stringify({ make, model, format: format || "35mm" }),
      });
      return {
        content: [{ type: "text" as const, text: `Added camera: **${cam.make} ${cam.model}** (${cam.format})` }],
      };
    }

    if (action === "add_lens") {
      if (!make || !model) {
        return { content: [{ type: "text" as const, text: "Need make and model to add a lens." }] };
      }
      const { data: lens } = await api<any>("/lenses", {
        method: "POST",
        body: JSON.stringify({ make, model, focalLengthMm, maxAperture }),
      });
      const specs = [lens.focalLengthMm ? `${lens.focalLengthMm}mm` : null, lens.maxAperture ? `f/${lens.maxAperture}` : null]
        .filter(Boolean)
        .join(" ");
      return {
        content: [{ type: "text" as const, text: `Added lens: **${lens.make} ${lens.model}**${specs ? ` (${specs})` : ""}` }],
      };
    }

    return { content: [{ type: "text" as const, text: "Unknown action." }] };
  }
);

// ── Tool: tomu_summary ──

server.tool(
  "tomu_summary",
  "Get a dashboard overview: inventory totals, expiring film, and gear count.",
  {},
  async () => {
    const [summaryRes, camerasRes, lensesRes] = await Promise.all([
      api<{ data: { items: InventoryItem[]; expiringSoon: InventoryItem[] } }>("/inventory/summary"),
      api<{ data: Array<{ id: string }> }>("/cameras"),
      api<{ data: Array<{ id: string }> }>("/lenses"),
    ]);

    const items = summaryRes.data.items;
    const stockIds = new Set(items.map((i) => i.filmStockId));

    // Totals broken out by form
    let factoryRolls = 0;
    let sheets = 0;
    let bulkFt = 0;
    for (const item of items) {
      if (item.form === "factory_roll") factoryRolls += item.quantity;
      else if (item.form === "sheet") sheets += item.quantity;
      else if (item.form === "bulk_roll") bulkFt += Number(item.remainingLengthFt ?? 0);
    }

    const lines: string[] = ["## Tomu Dashboard\n"];
    const parts: string[] = [];
    if (factoryRolls > 0) parts.push(`**${factoryRolls}** factory rolls`);
    if (bulkFt > 0) parts.push(`**${bulkFt}ft** bulk`);
    if (sheets > 0) parts.push(`**${sheets}** sheets`);
    lines.push(`- ${parts.length ? parts.join(" + ") : "No inventory"} across **${stockIds.size}** stock${stockIds.size === 1 ? "" : "s"}`);
    lines.push(`- **${camerasRes.data.length}** cameras, **${lensesRes.data.length}** lenses`);

    if (summaryRes.data.expiringSoon.length > 0) {
      lines.push(`- **${summaryRes.data.expiringSoon.length}** item(s) expiring within 6 months`);
    }

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

// ── Rolls: shared helpers ─────────────────────────────────────────────

interface ActiveRoll {
  id: string;
  cameraId: string | null;
  filmStockId: string;
  format: string;
  form: string;
  status: string;
  loadedAt: string | null;
  frameCount: number;
  framesShot: number;
  manufacturer: string;
  stockName: string;
  iso: number;
  cameraMake: string | null;
  cameraModel: string | null;
}

async function listActiveRolls(): Promise<ActiveRoll[]> {
  const { data } = await api<{ data: ActiveRoll[] }>("/rolls?status=active");
  return data;
}

/** Find a single active roll, optionally filtered by a fuzzy camera hint. Returns {roll} or {error}. */
async function pickActiveRoll(cameraHint?: string): Promise<{ roll?: ActiveRoll; error?: string }> {
  const rolls = await listActiveRolls();
  if (rolls.length === 0) return { error: "No active rolls. Load one first with tomu_load." };

  const candidates = cameraHint
    ? rolls.filter((r) =>
        fuzzyMatch(cameraHint, r.cameraMake ?? "", r.cameraModel ?? "", `${r.cameraMake ?? ""} ${r.cameraModel ?? ""}`),
      )
    : rolls;

  if (candidates.length === 0) {
    return { error: `No active roll matching camera "${cameraHint}". Active: ${rolls.map((r) => `${r.cameraMake} ${r.cameraModel}`).join(", ")}` };
  }
  if (candidates.length > 1) {
    return {
      error: `Multiple active rolls — specify a camera. Active: ${candidates.map((r) => `${r.cameraMake} ${r.cameraModel} (${displayStock(r.manufacturer, r.stockName)})`).join(", ")}`,
    };
  }
  return { roll: candidates[0] };
}

function describeRoll(r: ActiveRoll): string {
  const cam = r.cameraMake ? `${r.cameraMake} ${r.cameraModel}` : "no camera";
  return `${displayStock(r.manufacturer, r.stockName)} (${r.format}) in ${cam} — ${r.framesShot}/${r.frameCount} frames`;
}

// ── Tool: tomu_load ───────────────────────────────────────────────────

server.tool(
  "tomu_load",
  "Load a roll of film into a camera. Fuzzy-matches film stock and camera by name. " +
    "Decrements inventory automatically. If both factory and bulk inventory of the same stock exist, " +
    "factory rolls are used first unless the user specifies otherwise.",
  {
    film: z.string().describe("Film stock name (e.g. 'HP5+', 'Tri-X 400', 'Portra 400')"),
    camera: z.string().describe("Camera name (e.g. 'M6', 'Mamiya 7', 'Leica')"),
    format: z.string().optional().describe("Film format: '35mm' (default), '120', '4x5', '8x10'"),
    form: z.string().optional().describe("Override which form to use: 'factory_roll', 'bulk_roll', or 'sheet'"),
    frameCount: z.number().int().positive().optional().describe("Override default frame count (e.g. 24 for a short 35mm cassette)"),
    ratedIso: z.number().int().positive().optional().describe("ISO to shoot at (defaults to stock's box ISO). Use for expired film or intentional push/pull rating."),
    note: z.string().optional().describe("Optional note to attach to the roll at load time"),
  },
  async ({ film, camera, format, form, frameCount, ratedIso, note }) => {
    const fmt = format || "35mm";

    // Resolve stock
    const { data: stocks } = await api<{ data: Array<{ id: string; manufacturer: string; name: string; iso: number }> }>("/film-stocks");
    const stock = bestMatch(film, stocks, (s) => [`${s.manufacturer} ${s.name}`, s.name, s.manufacturer]);
    if (!stock) {
      return { content: [{ type: "text" as const, text: `Film stock "${film}" not found. Known stocks: ${stocks.map((s) => displayStock(s.manufacturer, s.name)).join(", ") || "none"}.` }] };
    }

    // Resolve camera
    const { data: cams } = await api<{ data: Array<{ id: string; make: string; model: string; format: string }> }>("/cameras");
    const m = rankedMatch(camera, cams, (c) => [`${c.make} ${c.model}`, c.model, c.make]);
    if (m.kind === "none") {
      return { content: [{ type: "text" as const, text: `Camera "${camera}" not found. Known cameras: ${cams.map((c) => `${c.make} ${c.model}`).join(", ") || "none"}.` }] };
    }
    if (m.kind === "tied") {
      return { content: [{ type: "text" as const, text: `Camera "${camera}" is ambiguous. Tied matches: ${m.items.map((c) => `${c.make} ${c.model}`).join(", ")}.` }] };
    }
    const cam = m.item;

    // Load
    const loadBody: Record<string, unknown> = {
      filmStockId: stock.id,
      format: fmt,
      cameraId: cam.id,
    };
    if (form) loadBody.form = form;
    if (frameCount != null) loadBody.frameCount = frameCount;
    if (ratedIso != null) loadBody.ratedIso = ratedIso;

    const loaded = await api<{ data: { id: string; format: string; form: string; frameCount: number; ratedIso: number } }>("/rolls", {
      method: "POST",
      body: JSON.stringify(loadBody),
    });

    // Optional load-time note
    if (note) {
      await api(`/rolls/${loaded.data.id}/notes`, {
        method: "POST",
        body: JSON.stringify({ content: note }),
      });
    }

    const isoText =
      loaded.data.ratedIso !== stock.iso
        ? `box ${stock.iso}, rated ${loaded.data.ratedIso}`
        : `ISO ${stock.iso}`;
    return {
      content: [{
        type: "text" as const,
        text: `Loaded **${displayStock(stock.manufacturer, stock.name)}** (${loaded.data.format}, ${loaded.data.form.replace("_", " ")}, ${isoText}) into **${cam.make} ${cam.model}** — ${loaded.data.frameCount} frames.${note ? ` Note saved.` : ""}`,
      }],
    };
  }
);

// ── Tool: tomu_shoot ──────────────────────────────────────────────────

server.tool(
  "tomu_shoot",
  "Log a frame on an active roll. Frame number is auto-incremented if omitted. " +
    "All settings fields are optional — pass what you dictated, dump anything unstructured into `notes`. " +
    "If multiple rolls are loaded in different cameras, specify `camera` to disambiguate.",
  {
    camera: z.string().optional().describe("Camera hint to pick the active roll (e.g. 'M6', 'Mamiya')"),
    frameNumber: z.number().int().positive().optional().describe("Explicit frame number. Omit to auto-assign the next frame."),
    shutterSpeed: z.string().optional().describe("Shutter speed (e.g. '1/250', '2s')"),
    aperture: z.string().optional().describe("Aperture (e.g. 'f/8', '5.6')"),
    compensation: z.string().optional().describe("Exposure compensation (e.g. '+1', '-1/3')"),
    meteringMode: z.string().optional().describe("Metering mode: 'incident', 'spot', 'matrix', 'center_weighted', 'sunny_16', 'guess'"),
    subject: z.string().optional().describe("Short subject description"),
    locationName: z.string().optional().describe("Place name"),
    notes: z.string().optional().describe("Free-form notes. Put anything unstructured here."),
    lens: z.string().optional().describe("Lens hint for fuzzy match"),
  },
  async ({ camera, frameNumber, shutterSpeed, aperture, compensation, meteringMode, subject, locationName, notes, lens }) => {
    const { roll, error } = await pickActiveRoll(camera);
    if (error || !roll) return { content: [{ type: "text" as const, text: error! }] };

    // Optional fuzzy lens resolution
    let lensId: string | undefined;
    if (lens) {
      const { data: lenses } = await api<{ data: Array<{ id: string; make: string; model: string; focalLengthMm: number | null }> }>("/lenses");
      const match = lenses.find((l) => fuzzyMatch(lens, `${l.make} ${l.model}`, l.model, String(l.focalLengthMm ?? "")));
      if (match) lensId = match.id;
    }

    const body: Record<string, unknown> = {};
    if (frameNumber != null) body.frameNumber = frameNumber;
    if (lensId) body.lensId = lensId;
    if (shutterSpeed) body.shutterSpeed = shutterSpeed;
    if (aperture) body.aperture = aperture;
    if (compensation) body.compensation = compensation;
    if (meteringMode) body.meteringMode = meteringMode;
    if (subject) body.subject = subject;
    if (locationName) body.locationName = locationName;
    if (notes) body.notes = notes;

    const frame = await api<{ data: { frameNumber: number; shutterSpeed: string | null; aperture: string | null } }>(`/rolls/${roll.id}/frames`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    const f = frame.data;
    const settings = [f.shutterSpeed, f.aperture].filter(Boolean).join(" ");
    return {
      content: [{
        type: "text" as const,
        text: `Frame ${f.frameNumber}/${roll.frameCount} logged on ${displayStock(roll.manufacturer, roll.stockName)} in ${roll.cameraMake} ${roll.cameraModel}${settings ? ` — ${settings}` : ""}${subject ? ` — ${subject}` : ""}.`,
      }],
    };
  }
);

// ── Tool: tomu_unload ─────────────────────────────────────────────────

server.tool(
  "tomu_unload",
  "Unload a roll from a camera. Assigns a display ID (YYYYMMDD.N) based on your local date. " +
    "If you have multiple active rolls, specify `camera`.",
  {
    camera: z.string().optional().describe("Camera hint to pick the roll to unload"),
    note: z.string().optional().describe("Optional note attached to the roll at unload time"),
  },
  async ({ camera, note }) => {
    const { roll, error } = await pickActiveRoll(camera);
    if (error || !roll) return { content: [{ type: "text" as const, text: error! }] };

    // Local date based on MCP host (which is the user's machine)
    const now = new Date();
    const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    const { data } = await api<{ data: { displayId: string; unloadedAt: string } }>(`/rolls/${roll.id}/unload`, {
      method: "POST",
      body: JSON.stringify({ localDate, note }),
    });

    return {
      content: [{
        type: "text" as const,
        text: `Unloaded **${displayStock(roll.manufacturer, roll.stockName)}** from ${roll.cameraMake} ${roll.cameraModel}. ID: **${data.displayId}** (${roll.framesShot} frames logged).${note ? " Note saved." : ""}`,
      }],
    };
  }
);

// ── Tool: tomu_note ───────────────────────────────────────────────────

server.tool(
  "tomu_note",
  "Add a timestamped note to the active roll, or to a specific frame on it. " +
    "Use this for any context that doesn't fit structured frame fields.",
  {
    content: z.string().describe("The note content"),
    frameNumber: z.number().int().positive().optional().describe("If set, attach to this frame instead of the roll itself"),
    camera: z.string().optional().describe("Camera hint if multiple rolls are active"),
  },
  async ({ content, frameNumber, camera }) => {
    const { roll, error } = await pickActiveRoll(camera);
    if (error || !roll) return { content: [{ type: "text" as const, text: error! }] };

    const path = frameNumber
      ? `/rolls/${roll.id}/frames/${frameNumber}/notes`
      : `/rolls/${roll.id}/notes`;
    await api(path, { method: "POST", body: JSON.stringify({ content }) });

    const target = frameNumber
      ? `frame ${frameNumber} of ${displayStock(roll.manufacturer, roll.stockName)}`
      : `${displayStock(roll.manufacturer, roll.stockName)} in ${roll.cameraMake} ${roll.cameraModel}`;
    return { content: [{ type: "text" as const, text: `Note added to ${target}.` }] };
  }
);

// ── Tool: tomu_undo_load ──────────────────────────────────────────────

server.tool(
  "tomu_undo_load",
  "Undo a load — use when a roll was loaded by mistake. Deletes the roll entirely and " +
    "credits inventory back. Distinct from unload: this treats the load as if it never " +
    "happened. Frames and notes on the roll are also deleted. Only works before unload.",
  {
    camera: z.string().optional().describe("Camera hint to pick which active roll to undo"),
  },
  async ({ camera }) => {
    const { roll, error } = await pickActiveRoll(camera);
    if (error || !roll) return { content: [{ type: "text" as const, text: error! }] };

    await api(`/rolls/${roll.id}`, { method: "DELETE" });

    const warn =
      roll.framesShot > 0
        ? ` **Deleted ${roll.framesShot} logged frame(s)** along with the roll.`
        : "";
    return {
      content: [{
        type: "text" as const,
        text: `Undid load of ${displayStock(roll.manufacturer, roll.stockName)} in ${roll.cameraMake} ${roll.cameraModel}. Inventory restored.${warn}`,
      }],
    };
  }
);

// ── Tool: tomu_rolls ──────────────────────────────────────────────────

server.tool(
  "tomu_rolls",
  "List rolls. Defaults to active (loaded or shooting); pass status='all' or any specific RollStatus (shot, developing, developed, scanning, complete, archived). " +
    "Dev Id filters answer history questions like 'what were Dev Ids 0727–0732' (devSeqRange) or 'rolls developed 2026-05-12' (devDate) — using any of them defaults status to 'all'.",
  {
    status: z.string().optional().describe("'active' (default), 'all', or RollStatus: loaded | shooting | shot | developing | developed | scanning | complete | archived"),
    devSeq: z.number().int().optional().describe("Exact Dev Id sequence number (e.g. 721)"),
    devSeqRange: z.string().optional().describe("Inclusive Dev Id seq range, e.g. '717-735' (single number works too)"),
    devDate: z.string().optional().describe("Rolls developed on this local date (YYYY-MM-DD)"),
    devDateFrom: z.string().optional().describe("Developed on or after (YYYY-MM-DD)"),
    devDateTo: z.string().optional().describe("Developed on or before (YYYY-MM-DD)"),
  },
  async ({ status, devSeq, devSeqRange, devDate, devDateFrom, devDateTo }) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (devSeq != null) params.set("dev_seq", String(devSeq));
    if (devSeqRange) params.set("dev_seq_range", devSeqRange);
    if (devDate) {
      params.set("dev_date_from", devDate);
      params.set("dev_date_to", devDate);
    }
    if (devDateFrom) params.set("dev_date_from", devDateFrom);
    if (devDateTo) params.set("dev_date_to", devDateTo);
    const qs = params.toString();
    const hasDevFilter = devSeq != null || !!devSeqRange || !!devDate || !!devDateFrom || !!devDateTo;

    const { data } = await api<{
      data: Array<
        ActiveRoll & {
          displayId: string | null;
          unloadedAt: string | null;
          devId: string | null;
          devDate: string | null;
          devSeq: number | null;
          intendedDeveloper: string | null;
          intendedDilution: string | null;
          intendedDevTimeSeconds: number | null;
        }
      >;
    }>(`/rolls${qs ? `?${qs}` : ""}`);

    const scope = hasDevFilter ? "dev filter" : status || "active";
    if (data.length === 0) {
      return { content: [{ type: "text" as const, text: `No rolls found (${scope}).` }] };
    }

    const lines: string[] = [`## Rolls (${scope}: ${data.length})\n`];
    for (const r of data) {
      // display_id is the shooting handle; dev_id is the lifetime dev handle.
      // Rolls with neither (orphans) fall back to "unassigned".
      const id = r.displayId ?? r.devId ?? "unassigned";
      const cam = r.cameraMake ? `${r.cameraMake} ${r.cameraModel}` : "—";
      const dev = r.devId ? ` — Dev ${r.devId}` : "";
      const intended = r.intendedDeveloper && !r.devId ? ` — plan: ${r.intendedDeveloper}${r.intendedDilution ? ` ${r.intendedDilution}` : ""}` : "";
      lines.push(`- **${id}** — ${displayStock(r.manufacturer, r.stockName)} (${r.format}) in ${cam} [${r.status}] — ${r.framesShot}/${r.frameCount}${dev}${intended}`);
    }
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

// ── Tool: tomu_log_shot_roll ──────────────────────────────────────────

server.tool(
  "tomu_log_shot_roll",
  "Retroactively log a roll that's already been shot — for backlog/fridge-pile entry. " +
    "Drops the roll straight into status='shot' with no inventory decrement. " +
    "Use this for canisters/sheets you find lying around, not for the field-shoot flow (which is tomu_load → tomu_shoot → tomu_unload). " +
    "If you don't know the shot date, leave it off — you can patch later.",
  {
    film: z.string().describe("Film stock name (fuzzy: 'hp5', 'fp4', 'no.5', 'tri-x')"),
    format: z.string().optional().describe("Film format: '35mm' (default), '120', '4x5', '8x10'"),
    camera: z.string().optional().describe("Camera name (fuzzy, optional: 'm6', 'mm7', 'intrepid')"),
    ratedIso: z.number().int().positive().optional().describe("Rated ISO (defaults to box ISO of the stock)"),
    shotDate: z.string().optional().describe("Approx YYYY-MM-DD when shot. Used for displayId. Omit if unknown."),
    fieldSeq: z.number().int().min(1).max(99).optional().describe("Sequence number to honor an existing physical label (e.g. 7 → '20250506.07'). Server picks next available if omitted. 409 if collides."),
    intendedDeveloper: z.string().optional().describe("Intended developer when known: 'HC-110', 'Rodinal', '510 Pyro'. Defaults to HC-110 when devShorthand is a letter code."),
    devShorthand: z.string().optional().describe("Pre-stamped dev shorthand from bag/canister label: 'B7.5', '1:50/8mins', 'E10:40'. Parsed into intended dilution + time."),
    note: z.string().optional().describe("Free-text note (e.g. 'mystery roll, brandy trade, possible HP5')"),
    tags: z.array(z.string()).optional().describe("Tags (e.g. ['fridge-backlog', '2025-road-trip'])"),
    form: z.string().optional().describe("Override form: 'factory_roll' (default), 'bulk_roll', 'sheet'"),
    frameCount: z.number().int().positive().optional().describe("Override frame count"),
    manufacturer: z.string().optional().describe("If the stock doesn't exist yet, providing manufacturer + iso (+ optional type) creates it on the fly."),
    iso: z.number().int().positive().optional().describe("Box ISO for stock auto-creation."),
    type: z.string().optional().describe("Film type for auto-creation: 'bw' (default), 'color_negative', 'color_positive'."),
  },
  async ({ film, format, camera, ratedIso, shotDate, fieldSeq, intendedDeveloper, devShorthand, note, tags, form, frameCount, manufacturer, iso, type }) => {
    const fmt = format || "35mm";

    const { data: stocks } = await api<{ data: Array<{ id: string; manufacturer: string; name: string; iso: number; aliases?: string[] }> }>("/film-stocks");
    const m = strictStockMatch(film, stocks, (s) => [`${s.manufacturer} ${s.name}`, s.name, s.manufacturer, ...(s.aliases ?? [])]);
    let stock: { id: string; manufacturer: string; name: string; iso: number } | null = null;
    if (m.kind === "single") stock = m.item;
    else if (m.kind === "tied") {
      return { content: [{ type: "text" as const, text: `Film "${film}" is ambiguous. Tied: ${m.items.map((s) => displayStock(s.manufacturer, s.name)).join(", ")}. Be more specific.` }] };
    } else {
      if (!manufacturer || !iso) {
        return { content: [{ type: "text" as const, text: `Film stock "${film}" not found. To create it on the fly, pass manufacturer + iso (+ optional type).` }] };
      }
      const created = await api<{ data: { id: string; manufacturer: string; name: string; iso: number } }>("/film-stocks", {
        method: "POST",
        body: JSON.stringify({ manufacturer, name: cleanStockName(film, manufacturer), iso, type: type || "bw" }),
      });
      stock = created.data;
    }

    let cameraId: string | undefined;
    let cameraLabel = "";
    if (camera) {
      const { data: cams } = await api<{ data: Array<{ id: string; make: string; model: string }> }>("/cameras");
      const m = rankedMatch(camera, cams, (c) => [`${c.make} ${c.model}`, c.model, c.make]);
      if (m.kind === "none") {
        return { content: [{ type: "text" as const, text: `Camera "${camera}" not found. Known: ${cams.map((c) => `${c.make} ${c.model}`).join(", ")}.` }] };
      }
      if (m.kind === "tied") {
        return { content: [{ type: "text" as const, text: `Camera "${camera}" is ambiguous. Tied matches: ${m.items.map((c) => `${c.make} ${c.model}`).join(", ")}.` }] };
      }
      cameraId = m.item.id;
      cameraLabel = ` in ${m.item.make} ${m.item.model}`;
    }

    const body: Record<string, unknown> = { filmStockId: stock.id, format: fmt };
    if (cameraId) body.cameraId = cameraId;
    if (ratedIso != null) body.ratedIso = ratedIso;
    if (shotDate) body.shotDate = shotDate;
    if (fieldSeq != null) body.fieldSeq = fieldSeq;
    if (devShorthand) {
      body.devShorthand = devShorthand;
      // If shorthand is a single letter+number (HC-110 codes), default the developer.
      if (/^[A-Ha-h]\d/.test(devShorthand) && !intendedDeveloper) {
        body.intendedDeveloper = "HC-110";
      }
    }
    if (intendedDeveloper) body.intendedDeveloper = intendedDeveloper;
    if (note) body.note = note;
    if (tags?.length) body.tags = tags;
    if (form) body.form = form;
    if (frameCount != null) body.frameCount = frameCount;

    const { data } = await api<{ data: { id: string; displayId: string | null; ratedIso: number } }>("/rolls/log-shot", {
      method: "POST",
      body: JSON.stringify(body),
    });

    const isoText = data.ratedIso !== stock.iso ? `box ${stock.iso}, rated ${data.ratedIso}` : `ISO ${stock.iso}`;
    const idLabel = data.displayId ? `**${data.displayId}**` : `roll ${data.id.slice(0, 8)} (no displayId yet — pass shotDate to assign one)`;
    return {
      content: [{
        type: "text" as const,
        text: `Logged ${idLabel}: ${displayStock(stock.manufacturer, stock.name)} (${fmt}, ${isoText})${cameraLabel}. Status: shot.`,
      }],
    };
  }
);

// ── Tool: tomu_dev_candidates ─────────────────────────────────────────

interface CandidateRoll {
  id: string;
  displayId: string | null;
  ratedIso: number | null;
  format: string;
  manufacturer: string;
  stockName: string;
  stockIso: number;
}

interface CandidateGroup {
  recipeKey: string;
  tier: "intended" | "history" | "mdc" | "stock-iso";
  recipe: {
    developer: string | null;
    dilution: string | null;
    devTimeSeconds: number | null;
    temperatureC: string | null;
    mdcAsaIso?: number | null;
  } | null;
  rolls: CandidateRoll[];
}

function formatTime(seconds: number | null): string {
  if (seconds == null) return "?";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}min` : `${m}:${String(s).padStart(2, "0")}`;
}

/** A, B, …, Z, AA, AB, …, AZ, BA, … — Excel-style group labels. */
function groupLabel(i: number): string {
  let s = "";
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

/** Strip a leading manufacturer token from a stock name so create-on-the-fly
 *  doesn't produce "Kentmere Kentmere Pan 400". */
function cleanStockName(name: string, manufacturer: string): string {
  const n = name.trim();
  const m = manufacturer.trim();
  if (!m) return n;
  const prefix = m.toLowerCase() + " ";
  if (n.toLowerCase().startsWith(prefix)) return n.slice(prefix.length).trim();
  return n;
}

/** "Kentmere Pan 100" not "Kentmere Kentmere Pan 100" when name already starts with mfg. */
function displayStock(manufacturer: string, stockName: string): string {
  const n = stockName.trim();
  const m = manufacturer.trim();
  if (n.toLowerCase().startsWith(m.toLowerCase() + " ")) return n;
  if (n.toLowerCase() === m.toLowerCase()) return n;
  return `${m} ${n}`;
}

server.tool(
  "tomu_dev_candidates",
  "List rolls awaiting development, grouped by recipe. Tier 1: explicit intended-dev (from labels). Tier 2: matched against past sessions. Tier 3: MDC recipe lookup by stock+ISO. Tier 4: clustered by stock+ISO when no recipe exists anywhere.",
  {},
  async () => {
    const { data: groups } = await api<{ data: CandidateGroup[] }>("/dev-sessions/candidates");

    if (groups.length === 0) {
      return { content: [{ type: "text" as const, text: "No rolls awaiting development." }] };
    }

    function rollLine(roll: CandidateRoll): string {
      const iso = roll.ratedIso && roll.ratedIso !== roll.stockIso ? `@ ${roll.ratedIso} ` : "";
      return `- **${roll.displayId ?? roll.id.slice(0, 8)}** ${displayStock(roll.manufacturer, roll.stockName)} ${iso}(${roll.format})`;
    }
    function recipeLabel(r: CandidateGroup["recipe"]): string {
      if (!r) return "—";
      const dev = r.developer ?? "?";
      const dil = r.dilution ?? "—";
      const asa = r.mdcAsaIso != null ? ` [MDC ISO ${r.mdcAsaIso}]` : "";
      return `${dev} ${dil} ${formatTime(r.devTimeSeconds)}${r.temperatureC ? ` @ ${r.temperatureC}°C` : ""}${asa}`;
    }

    const intended = groups.filter((g) => g.tier === "intended");
    const history = groups.filter((g) => g.tier === "history");
    const mdc = groups.filter((g) => g.tier === "mdc");
    const stockIso = groups.filter((g) => g.tier === "stock-iso");

    const lines: string[] = ["## Dev candidates\n"];
    let i = 0;

    function emit(title: string, gs: CandidateGroup[], headerFor: (g: CandidateGroup) => string) {
      if (!gs.length) return;
      lines.push(`### ${title}\n`);
      for (const g of gs) {
        lines.push(`**Group ${groupLabel(i++)}** — ${headerFor(g)}  (${g.rolls.length})`);
        for (const r of g.rolls) lines.push(rollLine(r));
        lines.push("");
      }
    }

    emit("Tier 1 — intended (from labels)", intended, (g) => recipeLabel(g.recipe));
    emit("Tier 2 — historical recipe match", history, (g) => recipeLabel(g.recipe));
    emit("Tier 3 — MDC recipe lookup", mdc, (g) => recipeLabel(g.recipe));
    emit("Tier 4 — no recipe yet, clustered by stock+ISO", stockIso, (g) => {
      const r0 = g.rolls[0];
      const iso = r0.ratedIso && r0.ratedIso !== r0.stockIso ? `@ ${r0.ratedIso}` : `@ ${r0.stockIso}`;
      return `${displayStock(r0.manufacturer, r0.stockName)} ${iso}`;
    });

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

// ── Tool: tomu_dev_session ────────────────────────────────────────────

interface SessionRoll {
  id: string;
  displayId: string | null;
  status: string;
  format: string;
  devId: string | null;
  manufacturer: string;
  stockName: string;
}

interface DevSession {
  id: string;
  displayId: string | null;
  developer: string;
  dilution: string | null;
  devTimeSeconds: number | null;
  temperatureC: string | null;
  tank: string | null;
  completedAt: string | null;
  developedAt: string | null;
  rolls?: SessionRoll[];
}

server.tool(
  "tomu_dev_session",
  "Create or complete a development session (one tank of rolls dev'd together). " +
    "action='create': pass rolls (display ids like '20260528.01'), developer, and shorthand (e.g. 'B7.5', '1:50/8mins') — " +
    "assigns lifetime Dev Ids, flips rolls to 'developing', and returns mix volumes for the tank. " +
    "action='complete': closes the latest open session (or one named by sessionDisplayId), flips rolls to 'developed'. " +
    "action='list': show open (uncompleted) sessions.",
  {
    action: z.enum(["create", "complete", "list"]).describe("create | complete | list"),
    rolls: z.array(z.string()).optional().describe("create: roll display ids (e.g. ['20260528.01','20260529.02'])"),
    developer: z.string().optional().describe("create: developer name ('HC-110', 'Rodinal', '510 Pyro')"),
    shorthand: z.string().optional().describe("create: dev shorthand — 'B7.5', 'E10:40', '1:50/8mins'"),
    dilution: z.string().optional().describe("create: explicit dilution ('B', '1+31', '1:50') — wins over shorthand"),
    devTimeSeconds: z.number().int().positive().optional().describe("create: explicit time in seconds — wins over shorthand"),
    temperatureC: z.number().optional().describe("create: developer temp °C (default 20)"),
    tank: z.string().optional().describe("create: tank ('SP-445', 'MOD54', 'Paterson 2-reel', 'Jobo') — enables mix volume calc"),
    notes: z.string().optional().describe("create/complete: free-text notes"),
    localDate: z.string().optional().describe("create: local YYYY-MM-DD (defaults to today) — sets session display id and roll dev dates"),
    sessionDisplayId: z.string().optional().describe("complete: session display id (e.g. '20260707.01'); defaults to the latest open session"),
    resultsRating: z.number().int().min(1).max(5).optional().describe("complete: 1-5 results rating"),
    resultsNotes: z.string().optional().describe("complete: how the negatives look"),
  },
  async (args) => {
    if (args.action === "list") {
      const { data: sessions } = await api<{ data: DevSession[] }>("/dev-sessions");
      const open = sessions.filter((s) => !s.completedAt);
      if (!open.length) return { content: [{ type: "text" as const, text: "No open dev sessions." }] };
      const lines = ["## Open dev sessions\n"];
      for (const s of open) {
        lines.push(`- **${s.displayId ?? s.id.slice(0, 8)}** — ${s.developer} ${s.dilution ?? ""} ${formatTime(s.devTimeSeconds)}${s.tank ? ` in ${s.tank}` : ""}`);
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }

    if (args.action === "complete") {
      const { data: sessions } = await api<{ data: DevSession[] }>("/dev-sessions");
      const open = sessions
        .filter((s) => !s.completedAt)
        .sort((a, b) => (b.developedAt ?? "").localeCompare(a.developedAt ?? ""));
      const target = args.sessionDisplayId
        ? open.find((s) => s.displayId === args.sessionDisplayId)
        : open[0];
      if (!target) {
        return {
          content: [{
            type: "text" as const,
            text: args.sessionDisplayId
              ? `No open session with display id "${args.sessionDisplayId}". Open: ${open.map((s) => s.displayId).join(", ") || "none"}.`
              : "No open dev sessions to complete.",
          }],
        };
      }
      const body: Record<string, unknown> = {};
      if (args.resultsRating != null) body.resultsRating = args.resultsRating;
      if (args.resultsNotes) body.resultsNotes = args.resultsNotes;
      await api(`/dev-sessions/${target.id}/complete`, { method: "POST", body: JSON.stringify(body) });
      const { data: detail } = await api<{ data: DevSession }>(`/dev-sessions/${target.id}`);
      const lines = [`Completed **${detail.displayId}** (${detail.developer} ${detail.dilution ?? ""}). Rolls now 'developed':`];
      for (const r of detail.rolls ?? []) {
        lines.push(`- ${r.displayId ?? r.id.slice(0, 8)} → Dev **${r.devId ?? "?"}** — ${displayStock(r.manufacturer, r.stockName)}`);
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }

    // ── create ──
    if (!args.rolls?.length || !args.developer) {
      return { content: [{ type: "text" as const, text: "create needs `rolls` (display ids) and `developer`." }] };
    }

    const { data: shotRolls } = await api<{ data: Array<{ id: string; displayId: string | null; format: string; status: string }> }>(
      "/rolls?status=shot",
    );
    const resolved: string[] = [];
    const rollFormats: string[] = [];
    const missing: string[] = [];
    for (const want of args.rolls) {
      const hit = shotRolls.find((r) => r.displayId === want.trim());
      if (hit) {
        resolved.push(hit.id);
        rollFormats.push(hit.format);
      } else missing.push(want);
    }
    if (missing.length) {
      return {
        content: [{
          type: "text" as const,
          text: `Not found among 'shot' rolls: ${missing.join(", ")}. (Already developing? Wrong id? Use tomu_rolls status='shot' to check.)`,
        }],
      };
    }

    const body: Record<string, unknown> = {
      rollIds: resolved,
      developer: args.developer,
    };
    if (args.shorthand) body.shorthand = args.shorthand;
    if (args.dilution) body.dilution = args.dilution;
    if (args.devTimeSeconds) body.devTimeSeconds = args.devTimeSeconds;
    if (args.temperatureC != null) body.temperatureC = args.temperatureC;
    if (args.tank) {
      const spec = findTank(args.tank);
      body.tank = spec?.name ?? args.tank;
    }
    if (args.notes) body.notes = args.notes;
    if (args.localDate) body.localDate = args.localDate;

    const { data: session } = await api<{ data: DevSession }>("/dev-sessions", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const { data: detail } = await api<{ data: DevSession }>(`/dev-sessions/${session.id}`);

    const lines = [
      `## Dev session **${detail.displayId}** started`,
      ``,
      `${detail.developer} ${detail.dilution ?? "?"} — ${formatTime(detail.devTimeSeconds)}${detail.temperatureC ? ` @ ${detail.temperatureC}°C` : ""}${detail.tank ? ` — ${detail.tank}` : ""}`,
      ``,
      `Dev Ids assigned:`,
    ];
    for (const r of detail.rolls ?? []) {
      lines.push(`- ${r.displayId ?? r.id.slice(0, 8)} → Dev **${r.devId ?? "?"}** — ${displayStock(r.manufacturer, r.stockName)} (${r.format})`);
    }

    // Mix instructions + guardrails
    const warnings: string[] = [];
    if (detail.devTimeSeconds != null && detail.devTimeSeconds < 300) {
      warnings.push(`Dev time ${formatTime(detail.devTimeSeconds)} is under 5 minutes — standing convention avoids sub-5-minute times (timing error dominates). Consider a higher dilution.`);
    } else if (detail.devTimeSeconds != null && detail.devTimeSeconds < 420) {
      warnings.push(`Dev time ${formatTime(detail.devTimeSeconds)} is under the 7-minute preference.`);
    }
    if (args.tank && detail.dilution) {
      const spec = findTank(args.tank);
      if (spec) {
        const rollEq = rollFormats.reduce((sum, f) => sum + rollEquivalents(f, 1), 0);
        const cap = spec.capacity.find((c) => c.format === (rollFormats[0] as "35mm" | "120" | "4x5"));
        if (cap && rollFormats.length > cap.count) {
          warnings.push(`${rollFormats.length}× ${rollFormats[0]} exceeds ${spec.name} capacity (${cap.count}).`);
        }
        const mix = computeDilution(detail.developer, detail.dilution, spec.volumeMl, rollEq);
        if (mix) {
          lines.push(``, `Mix for ${spec.name} (${spec.volumeMl} ml): **${mix.concentrateMl} ml ${detail.developer} + ${mix.waterMl} ml water** (${mix.dilution})`);
          warnings.push(...mix.warnings);
        }
      }
    }
    if (warnings.length) {
      lines.push(``, `⚠️ ${warnings.join("\n⚠️ ")}`);
    }
    lines.push(``, `When the tank is done: tomu_dev_session action='complete'.`);
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

// ── Tool: tomu_dilution ───────────────────────────────────────────────

server.tool(
  "tomu_dilution",
  "Compute developer mix volumes: (developer, dilution, tank-or-volume) → ml of concentrate + water, with minimum-concentrate warnings. " +
    "Knows the HC-110 letter table (A=1+15 B=1+31 C=1+19 D=1+39 E=1+47 F=1+79 G=1+119 H=1+63) and the user's tanks.",
  {
    developer: z.string().describe("Developer: 'HC-110', 'Rodinal', '510 Pyro', 'D-76'…"),
    dilution: z.string().describe("Dilution: HC-110 letter ('B', 'H') or ratio ('1+31', '1:50')"),
    tank: z.string().optional().describe("Tank name ('SP-445', 'MOD54', 'Paterson 3-reel', 'Jobo') — sets the volume"),
    volumeMl: z.number().positive().optional().describe("Explicit volume in ml (overrides tank)"),
    rolls: z.number().positive().optional().describe("Roll count for minimum-concentrate check (4x5 sheets: pass sheets/4)"),
  },
  async ({ developer, dilution, tank, volumeMl, rolls: rollCount }) => {
    const spec = tank ? findTank(tank) : null;
    const volume = volumeMl ?? spec?.volumeMl;
    if (!volume) {
      const names = Object.values(TANKS).map((t) => `${t.name} (${t.volumeMl} ml)`).join(", ");
      return { content: [{ type: "text" as const, text: `Need a tank or volumeMl. Known tanks: ${names}.` }] };
    }
    const mix = computeDilution(developer, dilution, volume, rollCount);
    if (!mix) {
      return { content: [{ type: "text" as const, text: `Couldn't parse dilution "${dilution}". Use an HC-110 letter (A–H) or a ratio like '1+31' / '1:50'.` }] };
    }
    const lines = [
      `**${developer} ${mix.dilution}** in ${spec ? `${spec.name} (${volume} ml)` : `${volume} ml`}:`,
      ``,
      `- Concentrate: **${mix.concentrateMl} ml**`,
      `- Water: **${mix.waterMl} ml**`,
    ];
    if (mix.warnings.length) lines.push(``, `⚠️ ${mix.warnings.join("\n⚠️ ")}`);
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

// ── Tool: tomu_correct_roll ───────────────────────────────────────────

server.tool(
  "tomu_correct_roll",
  "Fix a roll that was logged against the wrong film stock. Identify the roll by displayId (e.g. '20260528.01'). " +
    "If the right stock isn't in the DB yet, pass manufacturer + iso (+ optional type) to create it on the fly. " +
    "Updates the roll's filmStockId and re-rates ISO to the new stock's box ISO unless ratedIso is passed.",
  {
    displayId: z.string().describe("Display ID of the roll to correct (e.g. '20260528.01')"),
    film: z.string().describe("Correct film stock name (e.g. 'Kodak Ektapan')"),
    manufacturer: z.string().optional().describe("Manufacturer if creating new stock"),
    iso: z.number().int().positive().optional().describe("Box ISO if creating new stock"),
    type: z.string().optional().describe("Film type if creating new stock: 'bw' (default), 'color_negative', 'color_positive'"),
    ratedIso: z.number().int().positive().optional().describe("Override rated ISO (defaults to new stock's box ISO)"),
  },
  async ({ displayId, film, manufacturer, iso, type, ratedIso }) => {
    // Find roll by displayId (scan all statuses)
    const { data: allRolls } = await api<{ data: Array<{ id: string; displayId: string | null }> }>("/rolls?status=all");
    const roll = allRolls.find((r) => r.displayId === displayId);
    if (!roll) {
      return { content: [{ type: "text" as const, text: `No roll with displayId "${displayId}".` }] };
    }

    // Resolve or create stock
    const { data: stocks } = await api<{ data: Array<{ id: string; manufacturer: string; name: string; iso: number; aliases?: string[] }> }>("/film-stocks");
    const m = strictStockMatch(film, stocks, (s) => [`${s.manufacturer} ${s.name}`, s.name, s.manufacturer, ...(s.aliases ?? [])]);
    let stock: { id: string; manufacturer: string; name: string; iso: number } | null = null;
    if (m.kind === "single") stock = m.item;
    else if (m.kind === "tied") {
      return { content: [{ type: "text" as const, text: `Film "${film}" is ambiguous. Tied: ${m.items.map((s) => `${s.manufacturer} ${s.name}`).join(", ")}.` }] };
    } else {
      if (!manufacturer || !iso) {
        return { content: [{ type: "text" as const, text: `Stock "${film}" not found. Pass manufacturer + iso to create it.` }] };
      }
      const created = await api<{ data: { id: string; manufacturer: string; name: string; iso: number } }>("/film-stocks", {
        method: "POST",
        body: JSON.stringify({ manufacturer, name: cleanStockName(film, manufacturer), iso, type: type || "bw" }),
      });
      stock = created.data;
    }

    const patch: Record<string, unknown> = { filmStockId: stock.id };
    patch.ratedIso = ratedIso ?? stock.iso;

    await api(`/rolls/${roll.id}`, { method: "PATCH", body: JSON.stringify(patch) });

    return {
      content: [{
        type: "text" as const,
        text: `Roll **${displayId}** repointed to **${stock.manufacturer} ${stock.name}** (ISO ${patch.ratedIso}).`,
      }],
    };
  }
);

// ── Tool: tomu_set_stock_aliases ──────────────────────────────────────

server.tool(
  "tomu_set_stock_aliases",
  "Add (or replace) alternate names on a film stock so fuzzy matching recognises shorthand. " +
    "Example: add alias 'NCS' to 'NoColorStudio no.5' so 'NCS #5' resolves. " +
    "Default mode is 'add' (merges with existing). Pass mode='set' to overwrite the list.",
  {
    film: z.string().describe("Film stock to update (e.g. 'NoColorStudio no.5')"),
    aliases: z.array(z.string().min(1).max(50)).min(1).describe("Aliases to add or set (e.g. ['NCS no.5', 'NCS#5'])"),
    mode: z.enum(["add", "set"]).optional().describe("'add' (default) merges; 'set' replaces the full list"),
  },
  async ({ film, aliases, mode }) => {
    const { data: stocks } = await api<{ data: Array<{ id: string; manufacturer: string; name: string; aliases?: string[] }> }>("/film-stocks");
    const m = strictStockMatch(film, stocks, (s) => [`${s.manufacturer} ${s.name}`, s.name, s.manufacturer, ...(s.aliases ?? [])]);
    if (m.kind === "none") {
      return { content: [{ type: "text" as const, text: `Film "${film}" not found.` }] };
    }
    if (m.kind === "tied") {
      return { content: [{ type: "text" as const, text: `Film "${film}" is ambiguous. Tied: ${m.items.map((s) => displayStock(s.manufacturer, s.name)).join(", ")}.` }] };
    }
    const stock = m.item;

    const next =
      mode === "set"
        ? Array.from(new Set(aliases))
        : Array.from(new Set([...(stock.aliases ?? []), ...aliases]));

    await api(`/film-stocks/${stock.id}`, {
      method: "PATCH",
      body: JSON.stringify({ aliases: next }),
    });

    return {
      content: [{
        type: "text" as const,
        text: `**${displayStock(stock.manufacturer, stock.name)}** aliases ${mode === "set" ? "set" : "now"}: ${next.join(", ")}`,
      }],
    };
  }
);

return server;
}
