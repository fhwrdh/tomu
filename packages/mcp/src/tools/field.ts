// ── Field captures ──

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { api } from "../api.js";
import { fuzzyMatch, rankedMatch } from "../matching.js";
import type { FieldEventRow } from "../types.js";
import { describeRoll, eventLine } from "../format.js";
import { pickActiveRoll, resolveRollHandle, rollsIndex } from "../resolve.js";
import { randomUUID } from "node:crypto";

// Tool bodies are intentionally not re-indented: they moved verbatim out of the
// old single-file server.ts, so the split stays reviewable line by line.
export function register(server: McpServer) {

server.tool(
  "tomu_capture",
  "FIELD USE (fallback when the Tomu app isn't handy). Record a spoken field note verbatim. Pass the user's words as " +
    "`transcript` — do not summarise or reformat them; the server extracts settings and keeps the ramble. " +
    "Do NOT try to upload or attach an image: a photo taken inside the Claude app is not saved anywhere. " +
    "If `camera` names a camera with one active roll the note is linked to it and gets a provisional frame number; " +
    "otherwise it stays loose. Never ask for missing details.",
  {
    transcript: z.string().min(1).describe("The user's words, verbatim"),
    camera: z.string().optional().describe("Camera hint (e.g. 'M6', 'Mamiya'); omit if not said"),
    frameNumber: z.number().int().positive().optional().describe("Only if the user stated it and it is not in the transcript"),
    capturedAt: z.string().optional().describe("ISO time if the shot was earlier than now"),
  },
  async ({ transcript, camera, frameNumber, capturedAt }) => {
    const body: Record<string, unknown> = { clientId: randomUUID(), kind: "voice", transcript };
    const notesOut: string[] = [];
    if (camera) {
      const { roll, error } = await pickActiveRoll(camera);
      if (roll) { body.rollId = roll.id; if (roll.cameraId) body.cameraId = roll.cameraId; notesOut.push(`roll ${describeRoll(roll)}`); }
      else if (error?.startsWith("Multiple active rolls")) return { content: [{ type: "text" as const, text: error }] };
      else {
        // No active roll for this camera hint — still resolve the camera itself (V1 behaviour)
        // so the note is linked to a camera even when loose.
        const { data: cams } = await api<{ data: Array<{ id: string; make: string; model: string }> }>("/cameras");
        const m = rankedMatch(camera, cams, (c) => [`${c.make} ${c.model}`, c.model, c.make]);
        if (m.kind === "single") body.cameraId = m.item.id;
        notesOut.push("no active roll — loose");
      }
    }
    if (frameNumber != null) body.frameNumber = frameNumber;
    if (capturedAt) { const d = new Date(capturedAt); if (!Number.isNaN(d.getTime())) body.capturedAt = d.toISOString(); }
    const { data: e } = await api<{ data: FieldEventRow }>("/field-events", { method: "POST", body: JSON.stringify(body) });
    return { content: [{ type: "text" as const, text: `${eventLine(e, await rollsIndex())}${notesOut.length ? `\n${notesOut.join("; ")}` : ""}` }] };
  }
);

server.tool(
  "tomu_field_events",
  "List field events (voice notes and photos). Default: pending ones, newest first. Shows transcript first, then parsed settings.",
  {
    roll: z.string().optional().describe("display id, Dev Id, dev seq, or uuid prefix"),
    status: z.string().optional().describe("'pending' (default), 'pinned', 'roll_level', or 'all'"),
    review: z.boolean().optional().describe("Only events the parser flagged for review"),
    limit: z.number().int().positive().optional().describe("Max rows (default 20)"),
  },
  async ({ roll, status, review, limit }) => {
    const params = new URLSearchParams({ status: status ?? "pending", limit: String(limit ?? 20) });
    if (review) params.set("review", "true");
    if (roll) { const r = await resolveRollHandle(roll); if (!r.roll) return { content: [{ type: "text" as const, text: r.error! }] }; params.set("roll_id", r.roll.id); }
    const { data } = await api<{ data: FieldEventRow[] }>(`/field-events?${params}`);
    if (!data.length) return { content: [{ type: "text" as const, text: "No field events." }] };
    const idx = await rollsIndex();
    const lines = data.map((e) => {
      const extra = [e.transcript ? `  > ${e.transcript}` : "", e.parseNotes ? `  ⚠ ${e.parseNotes}` : "", e.fileUrl ? `  ${e.fileUrl}` : ""].filter(Boolean).join("\n");
      return `- ${eventLine(e, idx)}${extra ? `\n${extra}` : ""}`;
    });
    return { content: [{ type: "text" as const, text: `## Field events (${data.length})\n\n${lines.join("\n")}` }] };
  }
);

server.tool(
  "tomu_edit_event",
  "Correct a field event's parsed fields, roll, or frame number. Edited fields are protected from re-parsing. The transcript cannot be changed.",
  {
    event: z.string().describe("Event id (uuid or ≥8-char prefix)"),
    roll: z.string().optional(), frameNumber: z.number().int().positive().optional(), sheetId: z.string().optional(),
    shutterSpeed: z.string().optional(), aperture: z.string().optional(), compensation: z.string().optional(), meteringMode: z.string().optional(),
    lens: z.string().optional().describe("Lens hint (fuzzy)"), subject: z.string().optional(), locationName: z.string().optional(),
    remarks: z.string().optional(), review: z.boolean().optional().describe("false to clear a review flag"),
  },
  async ({ event, roll, lens, ...rest }) => {
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) if (v !== undefined) body[k] = v;
    if (roll) { const r = await resolveRollHandle(roll); if (!r.roll) return { content: [{ type: "text" as const, text: r.error! }] }; body.rollId = r.roll.id; }
    if (lens) {
      const { data: lenses } = await api<{ data: Array<{ id: string; make: string; model: string; focalLengthMm: number | null }> }>("/lenses");
      const m = lenses.find((l) => fuzzyMatch(lens, `${l.make} ${l.model}`, l.model, String(l.focalLengthMm ?? "")));
      if (!m) return { content: [{ type: "text" as const, text: `No lens matches "${lens}".` }] };
      body.lensId = m.id;
    }
    if (!Object.keys(body).length) return { content: [{ type: "text" as const, text: "Nothing to change." }] };
    const { data: e } = await api<{ data: FieldEventRow }>(`/field-events/${encodeURIComponent(event)}`, { method: "PATCH", body: JSON.stringify(body) });
    return { content: [{ type: "text" as const, text: `Updated ${eventLine(e, await rollsIndex())}` }] };
  }
);

server.tool(
  "tomu_pin_event",
  "After development: pin field events to frame numbers. A voice note becomes (or fills) the frame and its transcript is attached as a note; " +
    "a photo becomes a photo note on that frame. Pass `roll` for loose events. Runs in order, stops at the first failure.",
  {
    pins: z.array(z.object({ event: z.string(), frameNumber: z.number().int().positive() })).min(1),
    roll: z.string().optional(),
  },
  async ({ pins, roll }) => {
    let rollId: string | undefined;
    if (roll) { const r = await resolveRollHandle(roll); if (!r.roll) return { content: [{ type: "text" as const, text: r.error! }] }; rollId = r.roll.id; }
    const done: string[] = [];
    for (const p of pins) {
      try {
        const { data } = await api<{ data: { event: FieldEventRow; frame: { frameNumber: number }; joined: boolean } }>(
          `/field-events/${encodeURIComponent(p.event)}/pin`, { method: "POST", body: JSON.stringify(rollId ? { rollId, frameNumber: p.frameNumber } : { frameNumber: p.frameNumber }) });
        done.push(`${data.event.shortId} → frame ${data.frame.frameNumber}${data.joined ? " (joined)" : ""}`);
      } catch (err) {
        const remaining = pins.slice(done.length + 1).map((x) => x.event);
        return { content: [{ type: "text" as const, text: `${done.length ? `Pinned: ${done.join(", ")}\n` : ""}Failed on ${p.event} (frame ${p.frameNumber}): ${(err as Error).message}${remaining.length ? `\nNot attempted: ${remaining.join(", ")}` : ""}` }] };
      }
    }
    return { content: [{ type: "text" as const, text: `Pinned: ${done.join(", ")}` }] };
  }
);

server.tool(
  "tomu_roll_level_event",
  "Attach a field event to its roll as a note without a frame number (a scene reference photo, a general remark).",
  { event: z.string(), roll: z.string().optional().describe("Required for loose events") },
  async ({ event, roll }) => {
    let rollId: string | undefined;
    if (roll) { const r = await resolveRollHandle(roll); if (!r.roll) return { content: [{ type: "text" as const, text: r.error! }] }; rollId = r.roll.id; }
    const { data } = await api<{ data: { event: FieldEventRow } }>(`/field-events/${encodeURIComponent(event)}/roll-level`, { method: "POST", body: JSON.stringify(rollId ? { rollId } : {}) });
    return { content: [{ type: "text" as const, text: `Attached ${eventLine(data.event, await rollsIndex())}` }] };
  }
);

server.tool(
  "tomu_reparse_events",
  "Run the model parse again over voice events (after a prompt change, or to fill fields). Hand-edited fields are never touched.",
  { events: z.array(z.string()).optional().describe("Event ids"), roll: z.string().optional(), since: z.string().optional().describe("ISO date") },
  async ({ events, roll, since }) => {
    const body: Record<string, unknown> = {};
    if (events?.length) {
      const ids: string[] = [];
      for (const h of events) { const { data } = await api<{ data: FieldEventRow }>(`/field-events/${encodeURIComponent(h)}`); ids.push(data.id); }
      body.ids = ids;
    }
    if (roll) { const r = await resolveRollHandle(roll); if (!r.roll) return { content: [{ type: "text" as const, text: r.error! }] }; body.rollId = r.roll.id; }
    if (since) {
      const d = new Date(since);
      if (Number.isNaN(d.getTime())) return { content: [{ type: "text" as const, text: "since is not a parseable date" }] };
      body.since = d.toISOString();
    }
    const { data } = await api<{ data: { attempted: number; changed: number } }>("/field-events/reparse", { method: "POST", body: JSON.stringify(body) });
    return { content: [{ type: "text" as const, text: `Reparsed ${data.attempted} event(s); ${data.changed} changed.` }] };
  }
);

server.tool(
  "tomu_delete_event",
  "Delete a field event — the field's 'scratch that' once a note is already logged. " +
    "Pending events delete outright; a pinned or roll-level event needs `force`, and its frame, note, and photo file stay behind.",
  {
    event: z.string().describe("Event id (short id, uuid, or client id)"),
    force: z.boolean().optional().describe("Required to delete an event that is already pinned or roll-level"),
  },
  async ({ event, force }) => {
    const { data } = await api<{ data: FieldEventRow }>(`/field-events/${encodeURIComponent(event)}`);
    const line = eventLine(data, await rollsIndex());
    await api(`/field-events/${encodeURIComponent(data.id)}${force ? "?force=true" : ""}`, { method: "DELETE" });
    return { content: [{ type: "text" as const, text: `Deleted ${line}` }] };
  }
);

// ── Tool: tomu_note ───────────────────────────────────────────────────

}
