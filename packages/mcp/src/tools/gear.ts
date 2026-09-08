// ── Gear and tank fleet ──

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { api } from "../api.js";
import { fuzzyMatch } from "../matching.js";
import type { TankRow } from "../types.js";
import { tankLine } from "../format.js";

// Tool bodies are intentionally not re-indented: they moved verbatim out of the
// old single-file server.ts, so the split stays reviewable line by line.
export function register(server: McpServer) {


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

}
