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
      error: `Multiple active rolls — specify a camera. Active: ${candidates.map((r) => `${r.cameraMake} ${r.cameraModel} (${r.manufacturer} ${r.stockName})`).join(", ")}`,
    };
  }
  return { roll: candidates[0] };
}

function describeRoll(r: ActiveRoll): string {
  const cam = r.cameraMake ? `${r.cameraMake} ${r.cameraModel}` : "no camera";
  return `${r.manufacturer} ${r.stockName} (${r.format}) in ${cam} — ${r.framesShot}/${r.frameCount} frames`;
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
    const stock = stocks.find((s) => fuzzyMatch(film, `${s.manufacturer} ${s.name}`, s.name, s.manufacturer));
    if (!stock) {
      return { content: [{ type: "text" as const, text: `Film stock "${film}" not found. Known stocks: ${stocks.map((s) => `${s.manufacturer} ${s.name}`).join(", ") || "none"}.` }] };
    }

    // Resolve camera
    const { data: cams } = await api<{ data: Array<{ id: string; make: string; model: string; format: string }> }>("/cameras");
    const matches = cams.filter((c) => fuzzyMatch(camera, `${c.make} ${c.model}`, c.model, c.make));
    if (matches.length === 0) {
      return { content: [{ type: "text" as const, text: `Camera "${camera}" not found. Known cameras: ${cams.map((c) => `${c.make} ${c.model}`).join(", ") || "none"}.` }] };
    }
    if (matches.length > 1) {
      return { content: [{ type: "text" as const, text: `Camera "${camera}" is ambiguous. Matches: ${matches.map((c) => `${c.make} ${c.model}`).join(", ")}.` }] };
    }
    const cam = matches[0];

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
        text: `Loaded **${stock.manufacturer} ${stock.name}** (${loaded.data.format}, ${loaded.data.form.replace("_", " ")}, ${isoText}) into **${cam.make} ${cam.model}** — ${loaded.data.frameCount} frames.${note ? ` Note saved.` : ""}`,
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
        text: `Frame ${f.frameNumber}/${roll.frameCount} logged on ${roll.manufacturer} ${roll.stockName} in ${roll.cameraMake} ${roll.cameraModel}${settings ? ` — ${settings}` : ""}${subject ? ` — ${subject}` : ""}.`,
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
        text: `Unloaded **${roll.manufacturer} ${roll.stockName}** from ${roll.cameraMake} ${roll.cameraModel}. ID: **${data.displayId}** (${roll.framesShot} frames logged).${note ? " Note saved." : ""}`,
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
      ? `frame ${frameNumber} of ${roll.manufacturer} ${roll.stockName}`
      : `${roll.manufacturer} ${roll.stockName} in ${roll.cameraMake} ${roll.cameraModel}`;
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
        text: `Undid load of ${roll.manufacturer} ${roll.stockName} in ${roll.cameraMake} ${roll.cameraModel}. Inventory restored.${warn}`,
      }],
    };
  }
);

// ── Tool: tomu_rolls ──────────────────────────────────────────────────

server.tool(
  "tomu_rolls",
  "List rolls. Defaults to active (loaded or shooting) rolls; pass status='all' or 'unloaded' to see others.",
  {
    status: z.string().optional().describe("'active' (default), 'all', 'loaded', 'shooting', 'unloaded'"),
  },
  async ({ status }) => {
    const q = status ? `?status=${encodeURIComponent(status)}` : "";
    const { data } = await api<{ data: Array<ActiveRoll & { displayId: string | null; unloadedAt: string | null }> }>(`/rolls${q}`);

    if (data.length === 0) {
      return { content: [{ type: "text" as const, text: `No rolls found for status "${status || "active"}".` }] };
    }

    const lines: string[] = [`## Rolls (${status || "active"})\n`];
    for (const r of data) {
      const id = r.displayId ?? "unassigned";
      const cam = r.cameraMake ? `${r.cameraMake} ${r.cameraModel}` : "—";
      lines.push(`- **${id}** — ${r.manufacturer} ${r.stockName} (${r.format}) in ${cam} [${r.status}] — ${r.framesShot}/${r.frameCount}`);
    }
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

// ── Start ──

const transport = new StdioServerTransport();
await server.connect(transport);
