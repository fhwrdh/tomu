#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_BASE = process.env.FILMLOG_API_URL || "http://localhost:3456/api/v1";
const API_TOKEN = process.env.FILMLOG_API_TOKEN || "";

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
  name: "filmlog",
  version: "0.1.0",
});

// ── Tool: filmlog_inventory ──

server.tool(
  "filmlog_inventory",
  "Query film inventory. Shows what film you have, quantities, and expiration alerts. " +
    "Use without query to see everything, or search by film name/manufacturer.",
  {
    query: z.string().optional().describe("Optional search query: film name, manufacturer, format, or type (e.g. 'Tri-X', 'Kodak', '120', 'bw')"),
  },
  async ({ query }) => {
    const { data: summary } = await api<any>("/inventory/summary");

    let results = summary.byStock;
    if (query) {
      results = results.filter((s: any) =>
        fuzzyMatch(query, s.manufacturer, s.stockName, s.format, s.filmType, `ISO ${s.iso}`, `${s.iso}`)
      );
    }

    const lines: string[] = [];
    lines.push(`## Film Inventory (${summary.totalRolls} total rolls)\n`);

    if (results.length === 0) {
      lines.push(query ? `No film matching "${query}" found.` : "Inventory is empty.");
    } else {
      for (const s of results) {
        lines.push(`- **${s.manufacturer} ${s.stockName}** (${s.format}, ISO ${s.iso}) — **${s.totalRolls} rolls**`);
      }
    }

    if (summary.expiringSoon.length > 0) {
      lines.push(`\n### Expiring Soon`);
      for (const item of summary.expiringSoon) {
        lines.push(`- ${item.manufacturer} ${item.stockName} (${item.format}): ${item.quantity} rolls, expires ${item.expirationDate} [${item.storageLocation}]`);
      }
    }

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

// ── Tool: filmlog_add_inventory ──

server.tool(
  "filmlog_add_inventory",
  "Add film rolls to inventory. Can reference film stock by name (fuzzy matched) or ID. " +
    "If the film stock doesn't exist yet, creates it automatically.",
  {
    film: z.string().describe("Film stock name or ID (e.g. 'Tri-X 400', 'Kodak Portra 400', 'HP5+')"),
    quantity: z.number().int().positive().describe("Number of rolls to add"),
    format: z.string().optional().describe("Film format if creating new stock: '35mm', '120', '4x5', '8x10'"),
    manufacturer: z.string().optional().describe("Manufacturer if creating new stock (e.g. 'Kodak', 'Ilford')"),
    iso: z.number().int().positive().optional().describe("ISO if creating new stock"),
    type: z.string().optional().describe("Film type if creating new stock: 'bw', 'color_negative', 'color_positive'"),
    expirationDate: z.string().optional().describe("Expiration date (YYYY-MM-DD)"),
    storageLocation: z.string().optional().describe("Storage location: 'fridge', 'freezer', 'room_temp'"),
    costPerRoll: z.number().optional().describe("Cost per roll in dollars"),
  },
  async ({ film, quantity, format, manufacturer, iso, type, expirationDate, storageLocation, costPerRoll }) => {
    // Try to find existing stock by fuzzy match
    const { data: stocks } = await api<any>("/film-stocks");
    let stock = stocks.find((s: any) =>
      fuzzyMatch(film, s.manufacturer + " " + s.name, s.name, s.manufacturer)
    );

    // Create stock if not found
    if (!stock) {
      if (!manufacturer || !iso) {
        return {
          content: [{
            type: "text" as const,
            text: `Film stock "${film}" not found. To create it, also provide: manufacturer, iso, and optionally format and type.`,
          }],
        };
      }
      const { data: newStock } = await api<any>("/film-stocks", {
        method: "POST",
        body: JSON.stringify({
          manufacturer,
          name: film,
          iso,
          type: type || "bw",
          format: format || "35mm",
        }),
      });
      stock = newStock;
    }

    // Add inventory
    const { data: inv } = await api<any>("/inventory", {
      method: "POST",
      body: JSON.stringify({
        filmStockId: stock.id,
        quantity,
        expirationDate,
        storageLocation: storageLocation || "fridge",
        costPerRoll,
      }),
    });

    return {
      content: [{
        type: "text" as const,
        text: `Added ${quantity} roll(s) of **${stock.manufacturer} ${stock.name}** (${stock.format}, ISO ${stock.iso}) to inventory.${expirationDate ? ` Expires: ${expirationDate}.` : ""}${storageLocation ? ` Stored in: ${storageLocation}.` : ""}`,
      }],
    };
  }
);

// ── Tool: filmlog_gear ──

server.tool(
  "filmlog_gear",
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

// ── Tool: filmlog_summary ──

server.tool(
  "filmlog_summary",
  "Get a dashboard overview: inventory summary, expiring film, active rolls (when available), and gear count.",
  {},
  async () => {
    const [summaryRes, camerasRes, lensesRes] = await Promise.all([
      api<any>("/inventory/summary"),
      api<any>("/cameras"),
      api<any>("/lenses"),
    ]);

    const summary = summaryRes.data;
    const lines: string[] = [
      "## FilmLog Dashboard\n",
      `- **${summary.totalRolls}** rolls in inventory across **${summary.byStock.length}** stocks`,
      `- **${camerasRes.data.length}** cameras, **${lensesRes.data.length}** lenses`,
    ];

    if (summary.expiringSoon.length > 0) {
      lines.push(`- **${summary.expiringSoon.length}** inventory items expiring within 6 months`);
    }

    if (summary.byStock.length > 0) {
      lines.push("\n### Top Stocks");
      const sorted = [...summary.byStock].sort((a: any, b: any) => b.totalRolls - a.totalRolls).slice(0, 5);
      for (const s of sorted) {
        lines.push(`- ${s.manufacturer} ${s.stockName}: ${s.totalRolls} rolls`);
      }
    }

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

// ── Start ──

const transport = new StdioServerTransport();
await server.connect(transport);
