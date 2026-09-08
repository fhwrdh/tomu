// ── Standing summary ──

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { api } from "../api.js";
import type { InventoryItem } from "../types.js";

// Tool bodies are intentionally not re-indented: they moved verbatim out of the
// old single-file server.ts, so the split stays reviewable line by line.
export function register(server: McpServer) {


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

}
