#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

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

function fuzzyMatch(query: string, ...candidates: string[]): boolean {
  const q = normalize(query);
  return candidates.some((c) => {
    const n = normalize(c);
    return n.includes(q) || q.includes(n);
  });
}

// ── Server ──

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
        lines.push(`- **${first.manufacturer} ${first.stockName}** (ISO ${first.iso}, ${first.filmType})`);
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
        lines.push(`- ${item.manufacturer} ${item.stockName}: ${describeItem(item)}, expires ${item.expirationDate}`);
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
  },
  async ({ film, format, form, quantity, lengthFt, manufacturer, iso, type, expirationDate, storageLocation, costPerRoll }) => {
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
    let stock = stocks.find((s) =>
      fuzzyMatch(film, `${s.manufacturer} ${s.name}`, s.name, s.manufacturer)
    );

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

    await api("/inventory", { method: "POST", body: JSON.stringify(body) });

    const summary =
      frm === "bulk_roll"
        ? `${lengthFt}ft bulk roll`
        : `${quantity} ${frm === "sheet" ? "sheet(s)" : "roll(s)"}`;
    return {
      content: [{
        type: "text" as const,
        text: `Added ${summary} of **${stock.manufacturer} ${stock.name}** (${fmt}, ISO ${stock.iso}).${expirationDate ? ` Expires ${expirationDate}.` : ""}`,
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

// ── Start ──

const transport = new StdioServerTransport();
await server.connect(transport);
