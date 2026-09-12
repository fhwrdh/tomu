/**
 * Tier-2 parse: Claude reads the transcript (+ a nearby photo) and fills what the
 * regex could not. Never modifies the transcript; never overwrites hand-edited
 * fields; a failure leaves the event untouched (retried by the sweep).
 *
 * The model call itself lives in `field-parse-client.ts` (no database, so the eval
 * harness can call it too). This module owns the event row: what to send, what the
 * merge is allowed to write back, and what a failure costs.
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { and, desc, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { mergeParse, PARSED_FIELD_NAMES, type Tier2Result } from "@tomu/shared";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { fieldEvents, rolls } from "../db/schema.js";
import { loadGear } from "./gear.js";
import { requestTier2 } from "./field-parse-client.js";

/** Max size of a photo attached to a tier-2 request; larger photos are skipped. */
export const TIER2_MAX_IMAGE_BYTES = 3_500_000;

const client = config.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: config.ANTHROPIC_API_KEY }) : null;

export function tier2Enabled(): boolean { return client != null; }

export async function parseEventWithModel(eventId: string): Promise<{ skipped: boolean; changed: string[] }> {
  if (!client) return { skipped: true, changed: [] };
  const [ev] = await db.select().from(fieldEvents).where(eq(fieldEvents.id, eventId)).limit(1);
  if (!ev || ev.kind !== "voice" || !ev.transcript) return { skipped: true, changed: [] };

  const [gear, roll] = await Promise.all([
    loadGear(ev.userId),
    ev.rollId ? db.select({ format: rolls.format }).from(rolls).where(eq(rolls.id, ev.rollId)).limit(1) : Promise.resolve([]),
  ]);
  // Nearest photo event within 10 min on the same roll (or loose), for the scene description.
  const lo = new Date(ev.capturedAt.getTime() - 10 * 60_000), hi = new Date(ev.capturedAt.getTime() + 10 * 60_000);
  const [photo] = await db.select().from(fieldEvents).where(and(
    eq(fieldEvents.userId, ev.userId), eq(fieldEvents.kind, "photo"), gte(fieldEvents.capturedAt, lo), lte(fieldEvents.capturedAt, hi),
    ev.rollId ? eq(fieldEvents.rollId, ev.rollId) : isNull(fieldEvents.rollId),
  )).orderBy(desc(fieldEvents.capturedAt)).limit(1);

  let imageBase64: string | null = null;
  if (photo?.fileKey) {
    if (photo.fileSizeBytes != null && photo.fileSizeBytes <= TIER2_MAX_IMAGE_BYTES) {
      const buf = await readFile(join(config.UPLOADS_DIR, photo.fileKey)).catch(() => null);
      if (buf) imageBase64 = buf.toString("base64");
    } else {
      console.debug(`skipping oversized photo for tier-2 (event ${ev.id}, photo ${photo.id})`);
    }
  }

  // What the event already holds: sent to the model as "keep unless the note says
  // otherwise", and the left-hand side of the merge.
  const current = Object.fromEntries(
    PARSED_FIELD_NAMES.map((k) => [k, (ev as Record<string, unknown>)[k] as string | null]),
  ) as Parameters<typeof mergeParse>[0];

  try {
    const tier2: Tier2Result = await requestTier2(client, config.FIELD_PARSE_MODEL, {
      transcript: ev.transcript,
      gear,
      rollFormat: roll[0]?.format ?? null,
      current,
      imageBase64,
    });
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
    if (!ev.cameraId && tier2.cameraId && gear.cameras.some((c) => c.id === tier2.cameraId)) set.cameraId = tier2.cameraId;
    await db.update(fieldEvents).set(set).where(eq(fieldEvents.id, ev.id));
    return { skipped: false, changed: merged.changed };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      const set: Record<string, unknown> = {
        parseAttempts: sql`${fieldEvents.parseAttempts} + 1`,
        updatedAt: new Date(),
      };
      // Never clobber a real reviewReason left in parseNotes — only overwrite when it's empty
      // or already our own "tier-2 failed" note from a previous attempt.
      if (ev.parseNotes == null || ev.parseNotes.startsWith("tier-2 failed")) {
        set.parseNotes = `tier-2 failed: ${msg.slice(0, 200)}`;
      }
      await db.update(fieldEvents).set(set).where(eq(fieldEvents.id, ev.id));
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
      eq(fieldEvents.status, "pending"),
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
