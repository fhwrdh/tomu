/**
 * Tier-2 parse: Claude reads the transcript (+ a nearby photo) and fills what the
 * regex could not. Never modifies the transcript; never overwrites hand-edited
 * fields; a failure leaves the event untouched (retried by the sweep).
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { and, desc, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
// `zodOutputFormat` requires a zod/v4 `ZodType`; the rest of the codebase uses the zod v3
// classic API (package.json pins zod ^3.25, which ships a `zod/v4` compat entry point), so
// this schema — local to the tier-2 SDK call — is built against `zod/v4` specifically.
import { z } from "zod/v4";
import { mergeParse, PARSED_FIELD_NAMES, type Tier2Result } from "@tomu/shared";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { cameras, fieldEvents, lenses, rolls } from "../db/schema.js";

const Field = z.object({ value: z.string().nullable(), confidence: z.number().min(0).max(1) });
const Output = z.object({
  shutterSpeed: Field, aperture: Field, compensation: Field, meteringMode: Field,
  lensId: Field, subject: Field, locationName: Field,
  cameraId: z.string().nullable(),
  remarks: z.string().nullable(),
  sceneDescription: z.string().nullable(),
  reviewReason: z.string().nullable(),
});

let promptCache: string | null = null;
async function prompt(): Promise<string> {
  if (!promptCache) promptCache = await readFile(new URL("./field-parse-prompt.md", import.meta.url), "utf8");
  return promptCache;
}

const client = config.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: config.ANTHROPIC_API_KEY }) : null;

export function tier2Enabled(): boolean { return client != null; }

export async function parseEventWithModel(eventId: string): Promise<{ skipped: boolean; changed: string[] }> {
  if (!client) return { skipped: true, changed: [] };
  const [ev] = await db.select().from(fieldEvents).where(eq(fieldEvents.id, eventId)).limit(1);
  if (!ev || ev.kind !== "voice" || !ev.transcript) return { skipped: true, changed: [] };

  const [cams, lens, roll] = await Promise.all([
    db.select({ id: cameras.id, make: cameras.make, model: cameras.model }).from(cameras).where(eq(cameras.userId, ev.userId)),
    db.select({ id: lenses.id, make: lenses.make, model: lenses.model, focalLengthMm: lenses.focalLengthMm }).from(lenses).where(eq(lenses.userId, ev.userId)),
    ev.rollId ? db.select({ format: rolls.format }).from(rolls).where(eq(rolls.id, ev.rollId)).limit(1) : Promise.resolve([]),
  ]);
  // Nearest photo event within 10 min on the same roll (or loose), for the scene description.
  const lo = new Date(ev.capturedAt.getTime() - 10 * 60_000), hi = new Date(ev.capturedAt.getTime() + 10 * 60_000);
  const [photo] = await db.select().from(fieldEvents).where(and(
    eq(fieldEvents.userId, ev.userId), eq(fieldEvents.kind, "photo"), gte(fieldEvents.capturedAt, lo), lte(fieldEvents.capturedAt, hi),
    ev.rollId ? eq(fieldEvents.rollId, ev.rollId) : isNull(fieldEvents.rollId),
  )).orderBy(desc(fieldEvents.capturedAt)).limit(1);

  const context = [
    `Cameras: ${cams.map((c) => `${c.id} = ${c.make} ${c.model}`).join("; ") || "none"}`,
    `Lenses: ${lens.map((l) => `${l.id} = ${l.make} ${l.model} ${l.focalLengthMm ?? ""}mm`).join("; ") || "none"}`,
    `Roll format: ${roll[0]?.format ?? "unknown"}`,
    `Already parsed (keep unless the note clearly says otherwise): ${PARSED_FIELD_NAMES.map((k) => `${k}=${(ev as Record<string, unknown>)[k] ?? "null"}`).join(", ")}`,
  ].join("\n");

  const userContent: Anthropic.MessageParam["content"] = [];
  if (photo?.fileKey) {
    const buf = await readFile(join(config.UPLOADS_DIR, photo.fileKey)).catch(() => null);
    if (buf) userContent.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: buf.toString("base64") } });
  }
  userContent.push({ type: "text", text: `${context}\n\nTranscript:\n"""\n${ev.transcript}\n"""` });

  try {
    const res = await client.messages.parse({
      model: config.FIELD_PARSE_MODEL,
      max_tokens: 2000,
      system: [{ type: "text", text: await prompt(), cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userContent }],
      output_config: { format: zodOutputFormat(Output) },
    });
    const out = res.parsed_output;
    if (!out) throw new Error("tier-2 parse returned no structured output");

    const tier2: Tier2Result = {
      fields: Object.fromEntries(PARSED_FIELD_NAMES.map((k) => [k, out[k].value])) as Tier2Result["fields"],
      confidence: Object.fromEntries(PARSED_FIELD_NAMES.map((k) => [k, out[k].confidence])) as Tier2Result["confidence"],
      cameraId: out.cameraId, remarks: out.remarks ?? undefined, sceneDescription: out.sceneDescription ?? undefined, reviewReason: out.reviewReason,
    };
    // lensId must be a real lens of this user; drop hallucinated ids.
    if (tier2.fields.lensId && !lens.some((l) => l.id === tier2.fields.lensId)) { tier2.fields.lensId = null; }
    const current = Object.fromEntries(PARSED_FIELD_NAMES.map((k) => [k, (ev as Record<string, unknown>)[k] as string | null])) as Parameters<typeof mergeParse>[0];
    const merged = mergeParse(current, tier2, ev.editedFields);

    const set: Partial<typeof fieldEvents.$inferInsert> = {
      ...merged.fields,
      parsedAt: new Date(),
      parser: `claude:${config.FIELD_PARSE_MODEL}`,
      parseNotes: tier2.reviewReason ?? null,
      review: !!tier2.reviewReason,
      parseAttempts: 0,
      updatedAt: new Date(),
    };
    if (!ev.remarks && tier2.remarks) set.remarks = tier2.remarks;
    if (!ev.sceneDescription && tier2.sceneDescription) set.sceneDescription = tier2.sceneDescription;
    // Hallucinated cameraId that does not belong to this user must never be written.
    if (!ev.cameraId && tier2.cameraId && cams.some((c) => c.id === tier2.cameraId)) set.cameraId = tier2.cameraId;
    await db.update(fieldEvents).set(set).where(eq(fieldEvents.id, ev.id));
    return { skipped: false, changed: merged.changed };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      await db.update(fieldEvents).set({
        parseAttempts: sql`${fieldEvents.parseAttempts} + 1`,
        parseNotes: `tier-2 failed: ${msg.slice(0, 200)}`,
        updatedAt: new Date(),
      }).where(eq(fieldEvents.id, ev.id));
    } catch (recordErr) {
      console.error(`failed to record tier-2 failure for ${ev.id}:`, recordErr);
    }
    throw err;
  }
}

/** Max tier-2 attempts the sweep will retry before giving up on an event (explicit reparse ignores this). */
export const MAX_PARSE_ATTEMPTS = 5;

/** Voice events never seen by tier 2 (parser null or "regex"), oldest first, not yet at the attempt cap. Returns how many were attempted. */
export async function sweepUnparsed(limit = 20): Promise<number> {
  if (!client) return 0;
  const rows = await db.select({ id: fieldEvents.id }).from(fieldEvents)
    .where(and(
      eq(fieldEvents.kind, "voice"),
      sql`${fieldEvents.transcript} is not null`,
      sql`(${fieldEvents.parser} is null or ${fieldEvents.parser} = 'regex')`,
      lt(fieldEvents.parseAttempts, MAX_PARSE_ATTEMPTS),
    ))
    .orderBy(fieldEvents.capturedAt).limit(limit);
  for (const r of rows) {
    try { await parseEventWithModel(r.id); } catch (err) { console.error(`tier-2 parse failed for ${r.id}:`, (err as Error).message); }
  }
  return rows.length;
}

export async function reparseMany(userId: string, sel: { ids?: string[]; rollId?: string; since?: string }): Promise<{ attempted: number; changed: number }> {
  const conds = [eq(fieldEvents.userId, userId), eq(fieldEvents.kind, "voice")];
  if (sel.ids) conds.push(inArray(fieldEvents.id, sel.ids));
  if (sel.rollId) conds.push(eq(fieldEvents.rollId, sel.rollId));
  if (sel.since) conds.push(gte(fieldEvents.capturedAt, new Date(sel.since)));
  const rows = await db.select({ id: fieldEvents.id }).from(fieldEvents).where(and(...conds)).limit(200);
  let changed = 0;
  for (const r of rows) {
    try { const res = await parseEventWithModel(r.id); if (res.changed.length) changed++; }
    catch (err) { console.error(`reparse failed for ${r.id}:`, (err as Error).message); }
  }
  return { attempted: rows.length, changed };
}
