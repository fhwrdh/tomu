import multipart from "@fastify/multipart";
import { and, desc, eq, gte, inArray, max, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { imageSize } from "image-size";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createFieldEventSchema,
  eventToFrame,
  fieldEventPhotoMetaSchema,
  nextFrameNumber,
  parseTranscript,
  pinFieldEventSchema,
  reparseFieldEventsSchema,
  rollLevelFieldEventSchema,
  updateFieldEventSchema,
} from "@tomu/shared";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { cameras, fieldEvents, frames, lenses, notes, rolls } from "../db/schema.js";
import { parseEventWithModel, reparseMany, tier2Enabled } from "../services/field-parse-model.js";
import { loadGear } from "../services/gear.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type FieldEventRow = typeof fieldEvents.$inferSelect;

export function presentEvent(row: FieldEventRow) {
  return { ...row, shortId: row.id.slice(0, 8) };
}

/** uuid, uuid prefix (≥ 8 chars), or clientId. */
export async function findEvent(userId: string, handle: string): Promise<FieldEventRow | undefined> {
  const h = handle.trim().toLowerCase();
  if (UUID_RE.test(h)) {
    const [row] = await db.select().from(fieldEvents)
      .where(and(eq(fieldEvents.userId, userId), sql`(${fieldEvents.id} = ${h} or ${fieldEvents.clientId} = ${h})`)).limit(1);
    return row;
  }
  if (/^[0-9a-f]{8,}$/.test(h)) {
    const rows = await db.select().from(fieldEvents)
      .where(and(eq(fieldEvents.userId, userId), sql`${fieldEvents.id}::text like ${h + "%"}`)).limit(2);
    return rows.length === 1 ? rows[0] : undefined;
  }
  return undefined;
}

export function eventFilePath(eventId: string): { key: string; url: string; abs: string } {
  const key = `events/${eventId}.jpg`;
  return { key, url: `/uploads/${key}`, abs: join(config.UPLOADS_DIR, key) };
}

async function userOwnsRoll(userId: string, rollId: string): Promise<{ id: string; format: string; status: string } | null> {
  const [roll] = await db.select({ id: rolls.id, format: rolls.format, status: rolls.status }).from(rolls)
    .where(and(eq(rolls.id, rollId), eq(rolls.userId, userId))).limit(1);
  return roll ?? null;
}

async function userOwnsCamera(userId: string, cameraId: string): Promise<boolean> {
  const [row] = await db.select({ id: cameras.id }).from(cameras)
    .where(and(eq(cameras.id, cameraId), eq(cameras.userId, userId))).limit(1);
  return !!row;
}

async function userOwnsLens(userId: string, lensId: string): Promise<boolean> {
  const [row] = await db.select({ id: lenses.id }).from(lenses)
    .where(and(eq(lenses.id, lensId), eq(lenses.userId, userId))).limit(1);
  return !!row;
}

/** Highest frame number noted on a roll across frames and events (pending or pinned). */
export async function highestNotedFrame(rollId: string): Promise<number | null> {
  const [f] = await db.select({ m: max(frames.frameNumber) }).from(frames).where(eq(frames.rollId, rollId));
  const [e] = await db.select({ m: max(fieldEvents.frameNumber) }).from(fieldEvents).where(eq(fieldEvents.rollId, rollId));
  const vals = [f?.m, e?.m].filter((x): x is number => x != null);
  return vals.length ? Math.max(...vals) : null;
}

export async function fieldEventsRoutes(fastify: FastifyInstance) {
  await fastify.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
  await mkdir(join(config.UPLOADS_DIR, "events"), { recursive: true });

  // ── Create (idempotent on clientId) ─────────────────────────────────
  fastify.post("/", async (request, reply) => {
    const body = createFieldEventSchema.parse(request.body);
    const [dup] = await db.select().from(fieldEvents)
      .where(and(eq(fieldEvents.userId, request.userId), eq(fieldEvents.clientId, body.clientId))).limit(1);
    if (dup) return reply.status(200).send({ data: presentEvent(dup) });

    let roll: { id: string; format: string; status: string } | null = null;
    if (body.rollId) {
      roll = await userOwnsRoll(request.userId, body.rollId);
      if (!roll) return reply.status(404).send({ error: "Roll not found" });
    }
    if (body.cameraId && !(await userOwnsCamera(request.userId, body.cameraId))) {
      return reply.status(404).send({ error: "Camera not found" });
    }
    if (body.lensId && !(await userOwnsLens(request.userId, body.lensId))) {
      return reply.status(404).send({ error: "Lens not found" });
    }

    // Tier 1 on the server when the client sent none (Claude-app path / curl).
    let parsed = { shutterSpeed: body.shutterSpeed, aperture: body.aperture, compensation: body.compensation, meteringMode: body.meteringMode, lensId: body.lensId, subject: body.subject, locationName: body.locationName };
    let cameraId = body.cameraId ?? null;
    let spokenFrame = body.frameNumber ?? null;
    let sheetId = body.sheetId ?? null;
    let parser: string | null = body.parser ?? null;
    if (body.kind === "voice" && body.transcript && !body.parser) {
      const r = parseTranscript(body.transcript, await loadGear(request.userId));
      parsed = {
        shutterSpeed: parsed.shutterSpeed ?? r.fields.shutterSpeed, aperture: parsed.aperture ?? r.fields.aperture,
        compensation: parsed.compensation ?? r.fields.compensation, meteringMode: parsed.meteringMode ?? r.fields.meteringMode,
        lensId: parsed.lensId ?? r.fields.lensId, subject: parsed.subject, locationName: parsed.locationName,
      };
      cameraId = cameraId ?? r.fields.cameraId ?? null;
      spokenFrame = spokenFrame ?? r.fields.frameNumber ?? null;
      sheetId = sheetId ?? r.fields.sheetId ?? null;
      if (Object.keys(r.fields).length) parser = "regex";
    }
    // Camera without a roll → the camera's active roll, if exactly one.
    if (!roll && cameraId) {
      const active = await db.select({ id: rolls.id, format: rolls.format, status: rolls.status }).from(rolls)
        .where(and(eq(rolls.userId, request.userId), eq(rolls.cameraId, cameraId), inArray(rolls.status, ["loaded", "shooting"])));
      if (active.length === 1) roll = active[0];
    }
    let frameNumber: number | null = null, provisional = false;
    if (body.kind === "voice" && roll) {
      const n = nextFrameNumber({ spoken: spokenFrame, highestNoted: await highestNotedFrame(roll.id), format: roll.format });
      frameNumber = n.frameNumber; provisional = n.provisional;
    } else if (spokenFrame != null) {
      frameNumber = spokenFrame;
    }

    try {
      const [row] = await db.insert(fieldEvents).values({
        clientId: body.clientId,
        userId: request.userId,
        kind: body.kind,
        capturedAt: body.capturedAt ? new Date(body.capturedAt) : new Date(),
        latitude: body.latitude != null ? String(body.latitude) : null,
        longitude: body.longitude != null ? String(body.longitude) : null,
        rollId: roll?.id ?? null,
        cameraId,
        frameNumber,
        frameProvisional: provisional,
        sheetId,
        transcript: body.kind === "voice" ? (body.transcript ?? null) : null,
        shutterSpeed: parsed.shutterSpeed ?? null,
        aperture: parsed.aperture ?? null,
        compensation: parsed.compensation ?? null,
        meteringMode: parsed.meteringMode ?? null,
        lensId: parsed.lensId ?? null,
        subject: parsed.subject ?? null,
        locationName: parsed.locationName ?? null,
        parser,
        parsedAt: parser ? new Date() : null,
        editedFields: body.editedFields ?? [],
      }).returning();
      if (row.kind === "voice" && row.transcript && tier2Enabled()) {
        parseEventWithModel(row.id).catch((err) => request.log.warn({ err }, "tier-2 parse failed"));
      }
      return reply.status(201).send({ data: presentEvent(row) });
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        const [existing] = await db.select().from(fieldEvents)
          .where(and(eq(fieldEvents.userId, request.userId), eq(fieldEvents.clientId, body.clientId))).limit(1);
        if (existing) return reply.status(200).send({ data: presentEvent(existing) });
      }
      throw err;
    }
  });

  // ── List ────────────────────────────────────────────────────────────
  fastify.get<{ Querystring: { status?: string; kind?: string; roll_id?: string; since?: string; review?: string; client_ids?: string; limit?: string } }>("/", async (request, reply) => {
    const q = request.query;
    const conds = [eq(fieldEvents.userId, request.userId)];
    const status = q.status ?? (q.client_ids ? "all" : "pending");
    if (status !== "all") {
      if (!["pending", "pinned", "roll_level"].includes(status)) return reply.status(400).send({ error: `Invalid status: ${status}` });
      conds.push(eq(fieldEvents.status, status));
    }
    if (q.kind) {
      if (!["voice", "photo"].includes(q.kind)) return reply.status(400).send({ error: `Invalid kind: ${q.kind}` });
      conds.push(eq(fieldEvents.kind, q.kind));
    }
    if (q.roll_id) {
      if (!UUID_RE.test(q.roll_id)) return reply.status(400).send({ error: `Invalid roll_id: ${q.roll_id}` });
      conds.push(eq(fieldEvents.rollId, q.roll_id));
    }
    if (q.since) {
      const d = new Date(q.since);
      if (Number.isNaN(d.getTime())) return reply.status(400).send({ error: `Invalid since: ${q.since}` });
      conds.push(gte(fieldEvents.capturedAt, d));
    }
    if (q.review === "true") conds.push(eq(fieldEvents.review, true));
    if (q.client_ids) {
      const ids = q.client_ids.split(",").map((s) => s.trim()).filter((s) => UUID_RE.test(s));
      if (!ids.length) return reply.status(400).send({ error: "client_ids must be uuids" });
      conds.push(inArray(fieldEvents.clientId, ids));
    }
    const limit = Math.min(Math.max(Number(q.limit ?? 100) || 100, 1), 500);
    const rows = await db.select().from(fieldEvents).where(and(...conds)).orderBy(desc(fieldEvents.capturedAt)).limit(limit);
    return { data: rows.map(presentEvent) };
  });

  // ── Reparse (tier 2 again) ──────────────────────────────────────────
  fastify.post("/reparse", async (request, reply) => {
    const body = reparseFieldEventsSchema.parse(request.body);
    if (!tier2Enabled()) return reply.status(503).send({ error: "Tier-2 parsing is not configured (ANTHROPIC_API_KEY)" });
    const r = await reparseMany(request.userId, body);
    return { data: r };
  });

  // ── Get one ─────────────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const row = await findEvent(request.userId, request.params.id);
    if (!row) return reply.status(404).send({ error: "Event not found" });
    return { data: presentEvent(row) };
  });

  // ── Patch (transcript immutable; edited fields recorded) ────────────
  fastify.patch<{ Params: { id: string } }>("/:id", async (request, reply) => {
    if (request.body && typeof request.body === "object" && "transcript" in (request.body as object)) {
      return reply.status(400).send({ error: "transcript is immutable" });
    }
    const row = await findEvent(request.userId, request.params.id);
    if (!row) return reply.status(404).send({ error: "Event not found" });
    const body = updateFieldEventSchema.parse(request.body);
    if (body.rollId && !(await userOwnsRoll(request.userId, body.rollId))) return reply.status(404).send({ error: "Roll not found" });
    if (body.cameraId && !(await userOwnsCamera(request.userId, body.cameraId))) return reply.status(404).send({ error: "Camera not found" });
    if (body.lensId && !(await userOwnsLens(request.userId, body.lensId))) return reply.status(404).send({ error: "Lens not found" });
    const set: Partial<typeof fieldEvents.$inferInsert> = { updatedAt: new Date() };
    const edited = new Set(row.editedFields);
    for (const k of ["shutterSpeed", "aperture", "compensation", "meteringMode", "lensId", "subject", "locationName"] as const) {
      if (body[k] !== undefined) { set[k] = body[k]; edited.add(k); }
    }
    for (const k of ["rollId", "cameraId", "sheetId", "remarks", "sceneDescription", "review"] as const) {
      if (body[k] !== undefined) (set as Record<string, unknown>)[k] = body[k];
    }
    if (body.frameNumber !== undefined) { set.frameNumber = body.frameNumber; set.frameProvisional = false; }
    if (body.capturedAt !== undefined) set.capturedAt = new Date(body.capturedAt);
    set.editedFields = [...edited];
    const [updated] = await db.update(fieldEvents).set(set).where(eq(fieldEvents.id, row.id)).returning();
    return { data: presentEvent(updated) };
  });

  // ── Photo upload (PWA or photos:sync) ───────────────────────────────
  fastify.post<{ Params: { id: string } }>("/:id/photo", async (request, reply) => {
    const row = await findEvent(request.userId, request.params.id);
    if (!row) return reply.status(404).send({ error: "Event not found" });
    if (row.kind !== "photo") return reply.status(400).send({ error: "Only photo events take a file" });
    const fields: Record<string, string> = {};
    let fileBuf: Buffer | undefined;
    let mime: string | undefined;
    try {
      for await (const part of request.parts()) {
        if (part.type === "file") {
          if (part.fieldname !== "file") { await part.toBuffer(); continue; }
          mime = part.mimetype;
          fileBuf = await part.toBuffer();
        } else {
          fields[part.fieldname] = String(part.value);
        }
      }
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "FST_REQ_FILE_TOO_LARGE") return reply.status(413).send({ error: "Photo exceeds 25 MB" });
      if (code === "FST_FILES_LIMIT") return reply.status(400).send({ error: "Send exactly one file part named 'file'" });
      if (code === "FST_INVALID_MULTIPART_CONTENT_TYPE") return reply.status(400).send({ error: "Send multipart/form-data with a 'file' part" });
      throw err;
    }
    if (!fileBuf) return reply.status(400).send({ error: "Missing multipart field 'file'" });
    if (mime !== "image/jpeg") return reply.status(415).send({ error: `Only image/jpeg accepted, got ${mime}` });
    const meta = fieldEventPhotoMetaSchema.parse(fields);
    let dims: { width?: number; height?: number } = {};
    try { dims = imageSize(fileBuf); } catch { /* not fatal */ }
    const { key, url, abs } = eventFilePath(row.id);
    await writeFile(abs, fileBuf);
    const [updated] = await db.update(fieldEvents).set({
      fileKey: key, fileUrl: url, mimeType: mime, fileSizeBytes: fileBuf.length,
      widthPx: dims.width ?? null, heightPx: dims.height ?? null,
      capturedAt: meta.photoTakenAt ? new Date(meta.photoTakenAt) : row.capturedAt,
      latitude: meta.latitude != null ? String(meta.latitude) : row.latitude,
      longitude: meta.longitude != null ? String(meta.longitude) : row.longitude,
      photoAssetId: meta.photoAssetId ?? row.photoAssetId,
      updatedAt: new Date(),
    }).where(eq(fieldEvents.id, row.id)).returning();
    return { data: presentEvent(updated) };
  });

  // ── Pin: event becomes (or joins) a frame ───────────────────────────
  fastify.post<{ Params: { id: string } }>("/:id/pin", async (request, reply) => {
    const row = await findEvent(request.userId, request.params.id);
    if (!row) return reply.status(404).send({ error: "Event not found" });
    if (row.status !== "pending") return reply.status(409).send({ error: `Event is already ${row.status}` });
    if (row.kind === "photo" && !row.fileKey) {
      return reply.status(400).send({ error: "Nothing to attach: photo not uploaded yet" });
    }
    const body = pinFieldEventSchema.parse(request.body);
    const rollId = body.rollId ?? row.rollId;
    if (!rollId) return reply.status(400).send({ error: "Event is not linked to a roll; pass rollId" });
    const roll = await userOwnsRoll(request.userId, rollId);
    if (!roll) return reply.status(404).send({ error: "Roll not found" });

    const result = await db.transaction(async (tx) => {
      let [frame] = await tx.select().from(frames)
        .where(and(eq(frames.rollId, roll.id), eq(frames.frameNumber, body.frameNumber))).limit(1);
      let joined = !!frame;
      if (!frame) {
        const f = eventToFrame(row, body.frameNumber);
        try {
          // Nested transaction (savepoint): on a unique-violation, this rolls back to the
          // savepoint only, so the outer transaction can keep going with a plain SELECT below.
          [frame] = await tx.transaction(async (tx2) =>
            tx2.insert(frames).values({
              rollId: roll.id, frameNumber: f.frameNumber, lensId: f.lensId, shutterSpeed: f.shutterSpeed, aperture: f.aperture,
              compensation: f.compensation, meteringMode: f.meteringMode, subject: f.subject, notes: null,
              latitude: f.latitude != null ? String(f.latitude) : null, longitude: f.longitude != null ? String(f.longitude) : null,
              locationName: f.locationName, shotAt: new Date(f.shotAt), tags: [],
            }).returning()
          );
        } catch (err) {
          if ((err as { code?: string }).code !== "23505") throw err;
          // Lost the race to a concurrent pin at the same (rollId, frameNumber): join it instead.
          [frame] = await tx.select().from(frames)
            .where(and(eq(frames.rollId, roll.id), eq(frames.frameNumber, body.frameNumber))).limit(1);
          joined = true;
        }
      }
      if (joined && row.kind === "voice") {
        // Joining an existing frame (e.g. a photo pinned after the voice note, or two notes on one frame,
        // or a race lost above): fill only empty frame fields; never overwrite what is there.
        const f = eventToFrame(row, body.frameNumber);
        const fill: Partial<typeof frames.$inferInsert> = {};
        for (const k of ["lensId", "shutterSpeed", "aperture", "compensation", "meteringMode", "subject", "locationName"] as const) {
          if (frame[k] == null && f[k] != null) (fill as Record<string, unknown>)[k] = f[k];
        }
        if (Object.keys(fill).length) [frame] = await tx.update(frames).set({ ...fill, updatedAt: new Date() }).where(eq(frames.id, frame.id)).returning();
      }
      if (row.kind === "voice" && row.transcript) {
        await tx.insert(notes).values({ userId: request.userId, frameId: frame.id, type: "text", content: row.transcript, latitude: row.latitude, longitude: row.longitude });
      }
      if (row.kind === "photo" && row.fileKey) {
        await tx.insert(notes).values({
          userId: request.userId, frameId: frame.id, type: "photo", content: row.sceneDescription ?? null,
          fileKey: row.fileKey, fileUrl: row.fileUrl, mimeType: row.mimeType, fileSizeBytes: row.fileSizeBytes, latitude: row.latitude, longitude: row.longitude,
        });
      }
      if (roll.status === "loaded") await tx.update(rolls).set({ status: "shooting", updatedAt: new Date() }).where(eq(rolls.id, roll.id));
      const [ev] = await tx.update(fieldEvents)
        .set({ status: "pinned", rollId: roll.id, frameNumber: body.frameNumber, frameProvisional: false, frameId: frame.id, updatedAt: new Date() })
        .where(eq(fieldEvents.id, row.id)).returning();
      return { event: presentEvent(ev), frame, joined };
    });
    return reply.status(201).send({ data: result });
  });

  // ── Roll-level: attach as a roll note, no frame ─────────────────────
  fastify.post<{ Params: { id: string } }>("/:id/roll-level", async (request, reply) => {
    const row = await findEvent(request.userId, request.params.id);
    if (!row) return reply.status(404).send({ error: "Event not found" });
    if (row.status !== "pending") return reply.status(409).send({ error: `Event is already ${row.status}` });
    const body = rollLevelFieldEventSchema.parse(request.body ?? {});
    const rollId = body.rollId ?? row.rollId;
    if (!rollId) return reply.status(400).send({ error: "Event is not linked to a roll; pass rollId" });
    const roll = await userOwnsRoll(request.userId, rollId);
    if (!roll) return reply.status(404).send({ error: "Roll not found" });
    if ((row.kind === "voice" && !row.transcript) || (row.kind === "photo" && !row.fileKey)) {
      return reply.status(400).send({ error: "Nothing to attach: event has no transcript/photo" });
    }
    const result = await db.transaction(async (tx) => {
      await tx.insert(notes).values({
        userId: request.userId, rollId: roll.id,
        type: row.kind === "photo" ? "photo" : "text",
        content: row.kind === "photo" ? row.sceneDescription ?? null : row.transcript ?? null,
        fileKey: row.fileKey, fileUrl: row.fileUrl, mimeType: row.mimeType, fileSizeBytes: row.fileSizeBytes,
        latitude: row.latitude, longitude: row.longitude,
      });
      const [ev] = await tx.update(fieldEvents).set({ status: "roll_level", rollId: roll.id, updatedAt: new Date() }).where(eq(fieldEvents.id, row.id)).returning();
      return { event: presentEvent(ev) };
    });
    return reply.status(201).send({ data: result });
  });

  // ── Delete ──────────────────────────────────────────────────────────
  fastify.delete<{ Params: { id: string }; Querystring: { force?: string } }>("/:id", async (request, reply) => {
    const row = await findEvent(request.userId, request.params.id);
    if (!row) return reply.status(404).send({ error: "Event not found" });
    if (row.status !== "pending" && request.query.force !== "true") {
      return reply.status(409).send({ error: `Event is ${row.status}; pass ?force=true to delete the event record (the frame/note and photo file stay).` });
    }
    await db.delete(fieldEvents).where(eq(fieldEvents.id, row.id));
    if (row.fileKey && row.status === "pending") await rm(join(config.UPLOADS_DIR, row.fileKey), { force: true });
    return reply.status(204).send();
  });
}
