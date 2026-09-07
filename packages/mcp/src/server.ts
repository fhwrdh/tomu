import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { computeDilution, findTank, formatDevId, rollEquivalents, TANKS } from "@tomu/shared";
import {
  bestMatch,
  cleanStockName,
  displayStock,
  fuzzyMatch,
  normalize,
  rankedMatch,
  strictStockMatch,
} from "./matching.js";

const API_BASE = process.env.TOMU_API_URL || "http://localhost:3456/api/v1";
const API_TOKEN = process.env.TOMU_API_TOKEN || "";

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${API_TOKEN}`,
    ...((options.headers as Record<string, string>) || {}),
  };
  // Only advertise a JSON body when we actually send one. A DELETE (or any
  // bodyless request) with Content-Type: application/json makes Fastify reject
  // it as "body cannot be empty" (400) — which broke tomu_undo_load.
  if (options.body != null) headers["Content-Type"] = "application/json";

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`API error ${res.status}: ${body.error || res.statusText}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
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

    // Find or create stock (stock no longer carries format — it's on the inventory item).
    //
    // Resolution is deliberately strict. `bestMatch` used to be used here, which
    // scores any single overlapping token above zero — so "Verichrome Pan" landed
    // on the existing "Kodak Technical Pan" and "Washi F" on "Washi S", and the
    // create-it-automatically path never fired. `strictStockMatch` requires every
    // query token to be present exactly.
    type Stock = { id: string; manufacturer: string; name: string; iso: number; type: string; aliases?: string[] };
    const { data: stocks } = await api<{ data: Stock[] }>("/film-stocks");
    const m = strictStockMatch(film, stocks, (s) => [`${s.manufacturer} ${s.name}`, s.name, s.manufacturer, ...(s.aliases ?? [])]);
    let matches = m.kind === "single" ? [m.item] : m.kind === "tied" ? m.items : [];

    // Passing manufacturer + iso is the caller stating what this stock *is*. An
    // existing stock only counts as "the same film" if it agrees on both;
    // otherwise this is a genuinely new stock and we create it rather than
    // silently filing the lot under a near-namesake.
    const isNewStockSpec = Boolean(manufacturer) && iso != null;
    if (isNewStockSpec) {
      matches = matches.filter(
        (s) => normalize(s.manufacturer) === normalize(manufacturer!) && s.iso === iso
      );
    }

    if (matches.length > 1) {
      const lines = matches.map((s) => `- ${displayStock(s.manufacturer, s.name)} (ISO ${s.iso})`);
      return {
        content: [{
          type: "text" as const,
          text: `"${film}" matches more than one stock — say which one:\n${lines.join("\n")}`,
        }],
      };
    }

    let stock = matches[0] ?? null;
    let createdStock = false;

    if (!stock) {
      if (!isNewStockSpec) {
        return {
          content: [{
            type: "text" as const,
            text: `Film stock "${film}" not found. To create it, also provide: manufacturer, iso, and optionally type.`,
          }],
        };
      }
      const created = await api<{ data: Stock }>("/film-stocks", {
        method: "POST",
        body: JSON.stringify({
          manufacturer,
          name: cleanStockName(film, manufacturer!),
          iso,
          type: type || "bw",
        }),
      });
      stock = created.data;
      createdStock = true;
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
        text: `Added ${summary} of **${displayStock(stock.manufacturer, stock.name)}** (${fmt}, ISO ${stock.iso}).${expirationDate ? ` Expires ${expirationDate}.` : ""}${createdStock ? " Created this film stock — it was new." : ""}`,
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
  remainingLengthFt?: string | number | null;
  originalLengthFt?: string | number | null;
  expirationDate?: string | null;
  storageLocation: string;
  costPerRoll?: string | number | null;
  source?: string | null;
}

/** One-line rendering of a lot, for disambiguation lists and delete confirmations. */
function describeLot(r: InventoryRow): string {
  const id = r.displayId ? `[${r.displayId}] ` : `[${r.id.slice(0, 8)}] `;
  const exp = r.expirationDate ? `, exp ${r.expirationDate}` : "";
  const src = r.source ? `, src ${r.source}` : "";
  return `${id}${displayStock(r.manufacturer, r.stockName)} — ${describeItem(r as unknown as InventoryItem)}${exp}${src}`;
}

/**
 * Resolve exactly one inventory lot from a loose identifier, or explain why not.
 * Shared by tomu_edit_inventory and tomu_delete_inventory so both refuse to guess
 * in the same way. Returns `{ lot }` on a clean hit, `{ text }` otherwise.
 */
async function resolveLot(opts: {
  film?: string;
  displayId?: string;
  format?: string;
  form?: string;
}): Promise<{ lot: InventoryRow } | { text: string }> {
  const { film, displayId, format, form } = opts;
  const { data: rows } = await api<{ data: InventoryRow[] }>("/inventory");

  let candidates: InventoryRow[];
  if (displayId) {
    candidates = rows.filter((r) => r.displayId === displayId);
    if (candidates.length === 0) {
      return { text: `No inventory lot with displayId "${displayId}".` };
    }
  } else {
    const m = rankedMatch(film!, rows, (r) => [`${r.manufacturer} ${r.stockName}`, r.stockName, r.manufacturer]);
    if (m.kind === "none") {
      return { text: `No inventory lot matching "${film}".` };
    }
    candidates = m.kind === "single" ? [m.item] : m.items;
    // Narrow by format/form when provided
    if (format) candidates = candidates.filter((r) => r.format === format);
    if (form) candidates = candidates.filter((r) => r.form === form);
  }

  if (candidates.length === 0) {
    return { text: `Matched the stock, but no lot with that format/form. Drop the format/form filter to see options.` };
  }
  if (candidates.length > 1) {
    const lines = candidates.map((r) => `- ${describeLot(r)}`);
    return { text: `Multiple lots match — narrow with format/form (or displayId):\n${lines.join("\n")}` };
  }
  return { lot: candidates[0] };
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

    const resolved = await resolveLot({ film, displayId, format, form });
    if ("text" in resolved) return { content: [{ type: "text" as const, text: resolved.text }] };
    const lot = resolved.lot;
    const updated = await api<{ data: InventoryRow }>(`/inventory/${lot.id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
    // Merge over the pre-patch lot: formatting the confirmation must never be able
    // to fail on a write that already succeeded. (It did — the API used to return
    // a bare row with no manufacturer/stockName, so displayStock() threw
    // "Cannot read properties of undefined (reading 'trim')" and the tool reported
    // an error for a patch that had landed.)
    const u = { ...lot, ...updated.data };

    const changes = Object.entries(patch).map(([k, v]) => `${k}=${v}`).join(", ");
    return {
      content: [{
        type: "text" as const,
        text: `Updated **${displayStock(u.manufacturer, u.stockName)}** (${u.format}, ${describeItem(u as unknown as InventoryItem)}): ${changes}.`,
      }],
    };
  }
);

// ── Tool: tomu_delete_inventory ───────────────────────────────────────

server.tool(
  "tomu_delete_inventory",
  "Remove an inventory lot entirely. Use this to undo a mistaken add — zeroing the " +
    "quantity leaves a phantom lot behind, deleting takes it off the books. Identify the " +
    "lot the same way as tomu_edit_inventory: film name (fuzzy) plus optional format/form, " +
    "or displayId. A lot that still holds film requires `confirm: true`; an empty one deletes " +
    "outright. The film stock definition itself is left alone.",
  {
    film: z.string().optional().describe("Film stock name to locate the lot (fuzzy: 'verichrome', 'washi'). Omit if using displayId."),
    displayId: z.string().optional().describe("Lot display ID if it has one (e.g. 'R001'). Takes precedence over film/format/form."),
    format: z.string().optional().describe("Disambiguate by format: '35mm', '120', '4x5', '8x10'"),
    form: z.string().optional().describe("Disambiguate by form: 'factory_roll', 'bulk_roll', 'sheet'"),
    confirm: z.boolean().optional().describe("Required to delete a lot that still has film in it (quantity > 0, or bulk footage remaining)."),
  },
  async ({ film, displayId, format, form, confirm }) => {
    if (!film && !displayId) {
      return { content: [{ type: "text" as const, text: "Identify the lot: pass `film` (+ optional format/form) or `displayId`." }] };
    }

    const resolved = await resolveLot({ film, displayId, format, form });
    if ("text" in resolved) return { content: [{ type: "text" as const, text: resolved.text }] };
    const lot = resolved.lot;

    // Guard non-empty lots — deleting film you still own is almost always a
    // mis-identified lot rather than the intent.
    const remainingFt = lot.remainingLengthFt != null ? Number(lot.remainingLengthFt) : 0;
    const hasFilm = lot.form === "bulk_roll" ? remainingFt > 0 : lot.quantity > 0;
    if (hasFilm && !confirm) {
      return {
        content: [{
          type: "text" as const,
          text: `That lot still has film in it: ${describeLot(lot)}. Re-run with confirm: true to delete it anyway.`,
        }],
      };
    }

    const summary = describeLot(lot);
    await api(`/inventory/${lot.id}`, { method: "DELETE" });

    return { content: [{ type: "text" as const, text: `Deleted ${summary}.` }] };
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
    ? rolls.filter(
        (r) =>
          // Must have an actual camera to match a camera hint — otherwise
          // camera-less rolls (e.g. loaded 4x5 sheets) fuzzy-match every hint
          // because their empty make/model are trivially "contained" in it.
          (r.cameraMake || r.cameraModel) &&
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

// ── Field captures ────────────────────────────────────────────────────
//
// Captures are spoken settings recorded before the frame number is known.
// The phone photo never passes through Claude: the laptop sync script attaches
// it later by timestamp. Tools here only move words.

interface CaptureRow {
  id: string;
  captureId: string;
  seq: number;
  status: "pending" | "assigned";
  rollId: string | null;
  cameraId: string | null;
  frameNumber: number | null;
  capturedAt: string;
  shutterSpeed: string | null;
  aperture: string | null;
  compensation: string | null;
  meteringMode: string | null;
  subject: string | null;
  locationName: string | null;
  notes: string | null;
  sceneDescription: string | null;
  fileUrl: string | null;
  photoTakenAt: string | null;
}

interface AnyRoll {
  id: string;
  displayId: string | null;
  devDate: string | null;
  devSeq: number | null;
  status: string;
  manufacturer: string;
  stockName: string;
  cameraMake: string | null;
  cameraModel: string | null;
}

/** Resolve a roll by display id ("20260906.1"), Dev Id ("20260906.0741"), bare dev seq ("741"), or uuid prefix. */
async function resolveRollHandle(handle: string): Promise<{ roll?: AnyRoll; error?: string }> {
  const h = handle.trim();
  const { data } = await api<{ data: AnyRoll[] }>("/rolls?status=all");
  const hits = data.filter((r) => {
    if (r.displayId === h) return true;
    if (formatDevId(r.devDate, r.devSeq) === h) return true;
    if (/^\d{1,5}$/.test(h) && r.devSeq === Number(h)) return true;
    return h.length >= 8 && r.id.startsWith(h.toLowerCase());
  });
  if (hits.length === 1) return { roll: hits[0] };
  if (hits.length === 0) return { error: `No roll matches "${h}". Use a display id (20260906.1), Dev Id (20260906.0741), or dev seq (741).` };
  return { error: `"${h}" matches ${hits.length} rolls: ${hits.map((r) => r.displayId ?? r.id.slice(0, 8)).join(", ")}` };
}

function rollLabel(r: { displayId?: string | null; devDate?: string | null; devSeq?: number | null; id: string }): string {
  return r.displayId ?? formatDevId(r.devDate, r.devSeq) ?? r.id.slice(0, 8);
}

function captureLine(c: CaptureRow, rollsById: Map<string, AnyRoll>): string {
  const settings = [c.shutterSpeed, c.aperture, c.compensation].filter(Boolean).join(" ");
  const roll = c.rollId ? rollsById.get(c.rollId) : undefined;
  const where = roll ? `roll ${rollLabel(roll)}` : "loose";
  const when = c.capturedAt.slice(0, 16).replace("T", " ");
  const photo = c.fileUrl ? "photo ✓" : "pending photo";
  const frame = c.status === "assigned" ? ` → frame ${c.frameNumber}` : "";
  return `**${c.captureId}** · ${when} · ${where}${settings ? ` · ${settings}` : ""}${c.subject ? ` · ${c.subject}` : ""} · ${photo}${frame}`;
}

// ── Tool: tomu_capture ────────────────────────────────────────────────

server.tool(
  "tomu_capture",
  "FIELD USE. Record spoken exposure settings for a film frame whose number is not known yet, " +
    "with an optional description of the phone photo you were shown. Do NOT try to upload or attach the image — " +
    "the photo is matched to this capture later on the laptop by timestamp; just describe it in `description`. " +
    "The photo must be taken with the phone's Camera app (so it lands in the camera roll and iCloud) — a picture " +
    "taken from inside the Claude app is not saved anywhere and cannot be matched; if the user did that, say so once. " +
    "If `camera` resolves to one active roll the capture is linked to it; otherwise it stays loose. " +
    "Never ask for missing fields — a capture with only a description is valid. Returns the capture id (C412).",
  {
    camera: z.string().optional().describe("Camera hint to link the active roll (e.g. 'M6', 'Mamiya'). Omit if unknown."),
    lens: z.string().optional().describe("Lens hint for fuzzy match"),
    frameNumber: z.number().int().positive().optional().describe("Only when known now (typical for 4x5 sheets)."),
    shutterSpeed: z.string().optional().describe("e.g. '1/250', '2s'"),
    aperture: z.string().optional().describe("e.g. 'f/8', '5.6'"),
    compensation: z.string().optional().describe("e.g. '+1', '-1/3'"),
    meteringMode: z.string().optional().describe("e.g. 'incident', 'spot', 'sunny 16', 'guess'"),
    subject: z.string().optional().describe("Short subject"),
    locationName: z.string().optional().describe("Place name"),
    notes: z.string().optional().describe("Anything unstructured"),
    description: z.string().optional().describe("What the phone photo shows (scene, light, framing). Your words, not the image."),
    capturedAt: z.string().optional().describe("ISO time if the shot was earlier than now (e.g. 'that was ten minutes ago')."),
  },
  async ({ camera, lens, frameNumber, shutterSpeed, aperture, compensation, meteringMode, subject, locationName, notes, description, capturedAt }) => {
    const body: Record<string, unknown> = {};
    const notesOut: string[] = [];

    if (camera) {
      const { roll, error } = await pickActiveRoll(camera);
      if (roll) {
        body.rollId = roll.id;
        if (roll.cameraId) body.cameraId = roll.cameraId;
        notesOut.push(`roll ${describeRoll(roll)}`);
      } else if (error?.startsWith("Multiple active rolls")) {
        return { content: [{ type: "text" as const, text: error }] };
      } else {
        // No active roll for that camera: link the camera if it exists, keep the capture loose.
        const { data: cams } = await api<{ data: Array<{ id: string; make: string; model: string }> }>("/cameras");
        const cam = cams.find((c) => fuzzyMatch(camera, c.make, c.model, `${c.make} ${c.model}`));
        if (cam) { body.cameraId = cam.id; notesOut.push(`${cam.make} ${cam.model}, no active roll — capture is loose`); }
        else notesOut.push(`no camera matched "${camera}" — capture is loose`);
      }
    } else {
      notesOut.push("loose (no camera given)");
    }

    let lensUnmatched = false;
    if (lens) {
      const { data: lenses } = await api<{ data: Array<{ id: string; make: string; model: string; focalLengthMm: number | null }> }>("/lenses");
      const match = lenses.find((l) => fuzzyMatch(lens, `${l.make} ${l.model}`, l.model, String(l.focalLengthMm ?? "")));
      if (match) body.lensId = match.id;
      else lensUnmatched = true;
    }
    if (frameNumber != null) body.frameNumber = frameNumber;
    if (shutterSpeed) body.shutterSpeed = shutterSpeed;
    if (aperture) body.aperture = aperture;
    if (compensation) body.compensation = compensation;
    if (meteringMode) body.meteringMode = meteringMode;
    if (subject) body.subject = subject;
    if (locationName) body.locationName = locationName;
    if (notes) body.notes = notes;
    if (description) body.sceneDescription = description;
    if (capturedAt) {
      const d = new Date(capturedAt);
      if (!Number.isNaN(d.getTime())) body.capturedAt = d.toISOString();
    }

    const { data: c } = await api<{ data: CaptureRow }>("/captures", { method: "POST", body: JSON.stringify(body) });
    const settings = [c.shutterSpeed, c.aperture, c.compensation].filter(Boolean).join(" ");
    return {
      content: [{
        type: "text" as const,
        text: `**${c.captureId}** · ${notesOut.join("; ")}${settings ? ` · ${settings}` : ""}${subject ? ` · ${subject}` : ""} · pending photo${lensUnmatched ? ` · lens "${lens}" not matched` : ""}`,
      }],
    };
  }
);

// ── Tool: tomu_captures ───────────────────────────────────────────────

server.tool(
  "tomu_captures",
  "List field captures. Default: pending ones (no frame number yet), newest first. Shows whether the phone photo has been attached.",
  {
    roll: z.string().optional().describe("Restrict to one roll: display id, Dev Id, or dev seq"),
    status: z.string().optional().describe("'pending' (default), 'assigned', or 'all'"),
    limit: z.number().int().positive().optional().describe("Max rows (default 30)"),
  },
  async ({ roll, status, limit }) => {
    const params = new URLSearchParams();
    params.set("status", status ?? "pending");
    params.set("limit", String(limit ?? 30));
    if (roll) {
      const r = await resolveRollHandle(roll);
      if (!r.roll) return { content: [{ type: "text" as const, text: r.error! }] };
      params.set("roll_id", r.roll.id);
    }
    const { data } = await api<{ data: CaptureRow[] }>(`/captures?${params}`);
    if (data.length === 0) return { content: [{ type: "text" as const, text: "No captures." }] };
    const { data: allRolls } = await api<{ data: AnyRoll[] }>("/rolls?status=all");
    const rollsById = new Map(allRolls.map((r) => [r.id, r]));
    const lines = data.map((c) => `- ${captureLine(c, rollsById)}${c.sceneDescription ? `\n  _${c.sceneDescription}_` : ""}`);
    return { content: [{ type: "text" as const, text: `## Captures (${data.length})\n\n${lines.join("\n")}` }] };
  }
);

// ── Tool: tomu_edit_capture ───────────────────────────────────────────

server.tool(
  "tomu_edit_capture",
  "Fix a capture: a misheard setting, or link a loose capture to a roll. Only the fields you pass change.",
  {
    capture: z.string().describe("Capture id, e.g. 'C412' or '412'"),
    roll: z.string().optional().describe("Link to this roll: display id, Dev Id, or dev seq"),
    lens: z.string().optional(),
    frameNumber: z.number().int().positive().optional(),
    shutterSpeed: z.string().optional(),
    aperture: z.string().optional(),
    compensation: z.string().optional(),
    meteringMode: z.string().optional(),
    subject: z.string().optional(),
    locationName: z.string().optional(),
    notes: z.string().optional(),
    description: z.string().optional(),
    capturedAt: z.string().optional().describe("ISO time"),
  },
  async ({ capture, roll, lens, description, capturedAt, ...rest }) => {
    const body: Record<string, unknown> = { ...rest };
    for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
    if (roll) {
      const r = await resolveRollHandle(roll);
      if (!r.roll) return { content: [{ type: "text" as const, text: r.error! }] };
      body.rollId = r.roll.id;
    }
    if (lens) {
      const { data: lenses } = await api<{ data: Array<{ id: string; make: string; model: string; focalLengthMm: number | null }> }>("/lenses");
      const match = lenses.find((l) => fuzzyMatch(lens, `${l.make} ${l.model}`, l.model, String(l.focalLengthMm ?? "")));
      if (!match) return { content: [{ type: "text" as const, text: `No lens matches "${lens}".` }] };
      body.lensId = match.id;
    }
    if (description) body.sceneDescription = description;
    let capturedAtIgnored = false;
    if (capturedAt) {
      const d = new Date(capturedAt);
      if (Number.isNaN(d.getTime())) capturedAtIgnored = true;
      else body.capturedAt = d.toISOString();
    }
    if (Object.keys(body).length === 0) return { content: [{ type: "text" as const, text: "Nothing to change." }] };
    const { data: c } = await api<{ data: CaptureRow }>(`/captures/${encodeURIComponent(capture)}`, { method: "PATCH", body: JSON.stringify(body) });
    const { data: allRolls } = await api<{ data: AnyRoll[] }>("/rolls?status=all");
    const ignoredNote = capturedAtIgnored ? ` (capturedAt "${capturedAt}" ignored as unparseable — retry with ISO)` : "";
    return { content: [{ type: "text" as const, text: `Updated ${captureLine(c, new Map(allRolls.map((r) => [r.id, r])))}${ignoredNote}` }] };
  }
);

// ── Tool: tomu_assign_capture ─────────────────────────────────────────

server.tool(
  "tomu_assign_capture",
  "After development: give captures their frame numbers. Each capture becomes a real frame on its roll " +
    "(settings copied, phone photo attached as a note). Pass `roll` when any listed capture is still loose. " +
    "Runs in order and stops at the first failure. The photo itself is attached later by the laptop sync script — " +
    "never supply it to this tool.",
  {
    assignments: z.array(z.object({
      capture: z.string().describe("'C412' or '412'"),
      frameNumber: z.number().int().positive(),
    })).min(1),
    roll: z.string().optional().describe("Roll for loose captures: display id, Dev Id, or dev seq"),
  },
  async ({ assignments, roll }) => {
    let rollId: string | undefined;
    if (roll) {
      const r = await resolveRollHandle(roll);
      if (!r.roll) return { content: [{ type: "text" as const, text: r.error! }] };
      rollId = r.roll.id;
    }
    const done: string[] = [];
    for (const a of assignments) {
      try {
        const { data } = await api<{ data: { capture: CaptureRow; frame: { frameNumber: number } } }>(
          `/captures/${encodeURIComponent(a.capture)}/assign`,
          { method: "POST", body: JSON.stringify(rollId ? { rollId, frameNumber: a.frameNumber } : { frameNumber: a.frameNumber }) },
        );
        done.push(`${data.capture.captureId} → frame ${data.frame.frameNumber}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const remaining = assignments.slice(done.length + 1).map((x) => x.capture);
        return {
          content: [{
            type: "text" as const,
            text: `${done.length ? `Assigned: ${done.join(", ")}\n` : ""}Failed on ${a.capture} (frame ${a.frameNumber}): ${msg}${remaining.length ? `\nNot attempted: ${remaining.join(", ")}` : ""}`,
          }],
        };
      }
    }
    return { content: [{ type: "text" as const, text: `Assigned: ${done.join(", ")}` }] };
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
  "Fix fields on an already-logged roll, found by its CURRENT displayId (e.g. '20260528.01'). " +
    "Corrects the film stock (pass `film`; if the stock isn't in the DB, add manufacturer + iso to create it) " +
    "and/or dates: `newDisplayId` fixes a mis-stamped date/sequence (e.g. a server-timezone error), " +
    "`devDate` (YYYY-MM-DD), `loadedAt`/`unloadedAt` (ISO 8601). Pass only what you want to change.",
  {
    displayId: z.string().describe("Current display ID of the roll to correct (e.g. '20260528.01')"),
    film: z.string().optional().describe("Correct film stock name (e.g. 'Kodak Ektapan'). Omit to change only dates."),
    manufacturer: z.string().optional().describe("Manufacturer if creating a new stock"),
    iso: z.number().int().positive().optional().describe("Box ISO if creating a new stock"),
    type: z.string().optional().describe("Film type if creating a new stock: 'bw' (default), 'color_negative', 'color_positive'"),
    ratedIso: z.number().int().positive().optional().describe("Override rated ISO (defaults to the stock's box ISO when film changes)"),
    newDisplayId: z.string().optional().describe("Corrected display ID, format YYYYMMDD.N (e.g. fix 20260816.01 -> 20260815.01)"),
    devDate: z.string().optional().describe("Corrected develop date, YYYY-MM-DD"),
    loadedAt: z.string().optional().describe("Corrected load timestamp, ISO 8601"),
    unloadedAt: z.string().optional().describe("Corrected unload timestamp, ISO 8601"),
  },
  async ({ displayId, film, manufacturer, iso, type, ratedIso, newDisplayId, devDate, loadedAt, unloadedAt }) => {
    // Find roll by displayId (scan all statuses)
    const { data: allRolls } = await api<{ data: Array<{ id: string; displayId: string | null }> }>("/rolls?status=all");
    const roll = allRolls.find((r) => r.displayId === displayId);
    if (!roll) {
      return { content: [{ type: "text" as const, text: `No roll with displayId "${displayId}".` }] };
    }

    const patch: Record<string, unknown> = {};
    const changed: string[] = [];

    // Optional film-stock correction
    if (film) {
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
      patch.filmStockId = stock.id;
      patch.ratedIso = ratedIso ?? stock.iso;
      changed.push(`stock → ${stock.manufacturer} ${stock.name} (ISO ${patch.ratedIso})`);
    } else if (ratedIso != null) {
      patch.ratedIso = ratedIso;
      changed.push(`rated ISO → ${ratedIso}`);
    }

    // Optional date corrections
    if (newDisplayId != null) { patch.displayId = newDisplayId; changed.push(`display ID → ${newDisplayId}`); }
    if (devDate != null) { patch.devDate = devDate; changed.push(`dev date → ${devDate}`); }
    if (loadedAt != null) { patch.loadedAt = loadedAt; changed.push(`loaded → ${loadedAt}`); }
    if (unloadedAt != null) { patch.unloadedAt = unloadedAt; changed.push(`unloaded → ${unloadedAt}`); }

    if (Object.keys(patch).length === 0) {
      return { content: [{ type: "text" as const, text: `Nothing to change. Pass film and/or a date field (newDisplayId, devDate, loadedAt, unloadedAt).` }] };
    }

    await api(`/rolls/${roll.id}`, { method: "PATCH", body: JSON.stringify(patch) });

    return {
      content: [{ type: "text" as const, text: `Roll **${displayId}** corrected: ${changed.join("; ")}.` }],
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

// ── Tool: tomu_tanks ──────────────────────────────────────────────────

interface TankRow {
  id: string;
  name: string;
  kind: "roll" | "sheet";
  volumeMl: number;
  reelUnits: string | null;
  sheetCapacity: number | null;
  quantity: number;
  agitation: string;
  notes: string | null;
  isActive: boolean;
}

function tankLine(t: TankRow): string {
  const cap =
    t.kind === "sheet"
      ? `${t.sheetCapacity}× 4x5`
      : `${Number(t.reelUnits)} reel units (120 = 1.5)`;
  const qty = t.quantity > 1 ? ` ×${t.quantity}` : "";
  const inactive = t.isActive ? "" : " [retired]";
  return `- **${t.name}**${qty}${inactive} — ${t.volumeMl} ml, ${cap}, ${t.agitation}${t.notes ? ` — ${t.notes}` : ""}`;
}

server.tool(
  "tomu_tanks",
  "Manage the developing-tank fleet (stored in Tomu, editable anytime). action='list' shows the fleet; " +
    "'add' creates a tank (roll tanks need reelUnits — 35mm=1, 120=1.5; sheet tanks need sheetCapacity); " +
    "'update' edits by fuzzy name (volume, quantity, capacity, notes, retire via isActive=false).",
  {
    action: z.enum(["list", "add", "update"]).describe("list | add | update"),
    name: z.string().optional().describe("Tank name (add: new name; update: fuzzy match on existing)"),
    kind: z.enum(["roll", "sheet"]).optional().describe("add: roll (35mm/120 reels) or sheet (4x5)"),
    volumeMl: z.number().int().positive().optional().describe("Working volume in ml"),
    reelUnits: z.number().positive().optional().describe("Roll tanks: capacity in 35mm-reel units (a 120 reel costs 1.5)"),
    sheetCapacity: z.number().int().positive().optional().describe("Sheet tanks: 4x5 sheets per load"),
    quantity: z.number().int().positive().optional().describe("How many of this tank are owned"),
    agitation: z.enum(["inversion", "rotation"]).optional(),
    notes: z.string().optional(),
    isActive: z.boolean().optional().describe("update: false retires a tank without deleting history"),
    newName: z.string().optional().describe("update: rename the tank"),
  },
  async ({ action, name, kind, volumeMl, reelUnits, sheetCapacity, quantity, agitation, notes, isActive, newName }) => {
    if (action === "list") {
      const { data } = await api<{ data: TankRow[] }>("/tanks");
      if (!data.length) return { content: [{ type: "text" as const, text: "No tanks on file." }] };
      return { content: [{ type: "text" as const, text: ["## Tank fleet\n", ...data.map(tankLine)].join("\n") }] };
    }

    if (action === "add") {
      if (!name || !kind || !volumeMl) {
        return { content: [{ type: "text" as const, text: "add needs name, kind, and volumeMl (plus reelUnits or sheetCapacity)." }] };
      }
      const { data } = await api<{ data: TankRow }>("/tanks", {
        method: "POST",
        body: JSON.stringify({ name, kind, volumeMl, reelUnits, sheetCapacity, quantity: quantity ?? 1, agitation: agitation ?? "inversion", notes }),
      });
      return { content: [{ type: "text" as const, text: `Added:\n${tankLine(data)}` }] };
    }

    // update
    if (!name) return { content: [{ type: "text" as const, text: "update needs a name to match." }] };
    const { data: fleet } = await api<{ data: TankRow[] }>("/tanks");
    const matches = fleet.filter((t) => fuzzyMatch(name, t.name));
    if (!matches.length) return { content: [{ type: "text" as const, text: `No tank matching "${name}".` }] };
    if (matches.length > 1) {
      return { content: [{ type: "text" as const, text: `"${name}" is ambiguous: ${matches.map((t) => t.name).join(", ")}.` }] };
    }
    const patch: Record<string, unknown> = {};
    if (newName != null) patch.name = newName;
    if (kind != null) patch.kind = kind;
    if (volumeMl != null) patch.volumeMl = volumeMl;
    if (reelUnits != null) patch.reelUnits = reelUnits;
    if (sheetCapacity != null) patch.sheetCapacity = sheetCapacity;
    if (quantity != null) patch.quantity = quantity;
    if (agitation != null) patch.agitation = agitation;
    if (notes != null) patch.notes = notes;
    if (isActive != null) patch.isActive = isActive;
    const { data } = await api<{ data: TankRow }>(`/tanks/${matches[0].id}`, { method: "PATCH", body: JSON.stringify(patch) });
    return { content: [{ type: "text" as const, text: `Updated:\n${tankLine(data)}` }] };
  }
);

// ── Tool: tomu_tank_plan ──────────────────────────────────────────────

interface PlanRoll {
  id: string;
  displayId: string | null;
  format: string;
  manufacturer: string;
  stockName: string;
  ratedIso: number | null;
  stockIso: number;
  loadedAt: string | null;
}

interface PlanLoad {
  tankName: string;
  tankVolumeMl: number;
  tier: "intended" | "history" | "mdc" | "stock-iso";
  recipe: { developer: string | null; dilution: string | null; devTimeSeconds: number | null; temperatureC: string | null };
  rolls: PlanRoll[];
  usedUnits: number;
  capacityUnits: number;
  oldestLoadedAt: string | null;
  mix: { concentrateMl: number; waterMl: number; dilution: string } | null;
  warnings: string[];
}

interface PlanResponse {
  loads: PlanLoad[];
  remainder: { roll: PlanRoll; reason: string }[];
  warnings: string[];
}

const TIER_LABEL: Record<PlanLoad["tier"], string> = {
  intended: "tier 1: intended (labels)",
  history: "tier 2: historical",
  mdc: "tier 3: MDC (community)",
  "stock-iso": "tier 4: clustered",
};

server.tool(
  "tomu_tank_plan",
  "Plan a dev session: pack the shot-roll backlog into concrete tank loads (one recipe per tank, zero tolerance — " +
    "groups from tomu_dev_candidates are atomic). Returns ordered loads with mix volumes, recipe provenance, and " +
    "a waiting list of what didn't pack. Advisory only — create sessions explicitly with tomu_dev_session.",
  {
    tanksAvailable: z.array(z.string()).optional().describe("Restrict to these tanks (fuzzy names). Default: full fleet"),
    excludeTanks: z.array(z.string()).optional().describe("Leave these out (e.g. a tank still wet)"),
    maxTanks: z.number().int().positive().optional().describe("'I'll run N tanks tonight' — best N loads only"),
    includeRolls: z.array(z.string()).optional().describe("Roll display ids that MUST be in the plan"),
    tags: z.array(z.string()).optional().describe("Only rolls carrying any of these tags"),
    developer: z.string().optional().describe("Only this developer (e.g. 'HC-110')"),
  },
  async (params) => {
    const { data: plan } = await api<{ data: PlanResponse }>("/tanks/plan", {
      method: "POST",
      body: JSON.stringify(params),
    });

    if (!plan.loads.length && !plan.remainder.length) {
      return { content: [{ type: "text" as const, text: "Backlog is empty — nothing to plan." }] };
    }

    const lines: string[] = ["## Tank plan\n"];

    plan.loads.forEach((l, i) => {
      const r = l.recipe;
      const temp = r.temperatureC ? ` @ ${r.temperatureC}°C` : "";
      lines.push(
        `### Load ${i + 1} — ${l.tankName} — ${r.developer} ${r.dilution ?? "?"} ${formatTime(r.devTimeSeconds)}${temp}  [${TIER_LABEL[l.tier]}]`,
      );
      const oldest = l.oldestLoadedAt?.slice(0, 10);
      for (const roll of l.rolls) {
        const iso = roll.ratedIso && roll.ratedIso !== roll.stockIso ? ` @ ${roll.ratedIso}` : "";
        const marker = oldest && roll.loadedAt?.slice(0, 10) === oldest ? `  ← oldest: ${oldest}` : "";
        lines.push(`- **${roll.displayId ?? roll.id.slice(0, 8)}** ${displayStock(roll.manufacturer, roll.stockName)}${iso} (${roll.format})${marker}`);
      }
      lines.push(`- Fill: ${l.usedUnits}/${l.capacityUnits} ${l.rolls[0]?.format === "4x5" ? "sheets" : "reel units"}`);
      if (l.mix) lines.push(`- Mix: **${l.mix.concentrateMl} ml** ${r.developer} + **${l.mix.waterMl} ml** water (${l.mix.dilution}) in ${l.tankVolumeMl} ml`);
      for (const w of l.warnings) lines.push(`- ⚠️ ${w}`);
      lines.push("");
    });

    if (plan.remainder.length) {
      lines.push(`### Waiting (${plan.remainder.length})\n`);
      const byReason = new Map<string, PlanRoll[]>();
      for (const u of plan.remainder) {
        if (!byReason.has(u.reason)) byReason.set(u.reason, []);
        byReason.get(u.reason)!.push(u.roll);
      }
      for (const [reason, rollList] of byReason) {
        lines.push(`**${reason}** (${rollList.length}):`);
        lines.push(rollList.map((roll) => roll.displayId ?? roll.id.slice(0, 8)).join(", "));
        lines.push("");
      }
    }

    for (const w of plan.warnings) lines.push(`⚠️ ${w}`);

    if (plan.loads.length) {
      lines.push(
        `_To run a load: tomu_dev_session action=create with its rolls, developer, dilution/time, and tank._`,
      );
    }

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

return server;
}
