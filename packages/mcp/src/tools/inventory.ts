// ── Inventory tools ──

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { api } from "../api.js";
import { cleanStockName, displayStock, fuzzyMatch, normalize, strictStockMatch } from "../matching.js";
import type { InventoryItem, InventoryRow } from "../types.js";
import { coerceExpiration, describeItem, describeLot } from "../format.js";
import { resolveLot } from "../resolve.js";

// Tool bodies are intentionally not re-indented: they moved verbatim out of the
// old single-file server.ts, so the split stays reviewable line by line.
export function register(server: McpServer) {


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

}
