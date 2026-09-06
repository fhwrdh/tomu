import multipart from "@fastify/multipart";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { imageSize } from "image-size";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  capturePhotoMetaSchema,
  createCaptureSchema,
  formatCaptureId,
  parseCaptureId,
  updateCaptureSchema,
} from "@tomu/shared";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { captures } from "../db/schema.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CaptureRow = typeof captures.$inferSelect;

/** API shape: DB row + the display id. Numeric strings from `numeric` columns are left as-is (client parses). */
export function presentCapture(row: CaptureRow) {
  return { ...row, captureId: formatCaptureId(row.seq) };
}

/** Find one of the user's captures by uuid or by "C412"/"412". */
export async function findCapture(userId: string, handle: string): Promise<CaptureRow | undefined> {
  const seq = parseCaptureId(handle);
  const where = UUID_RE.test(handle)
    ? and(eq(captures.userId, userId), eq(captures.id, handle))
    : seq != null
      ? and(eq(captures.userId, userId), eq(captures.seq, seq))
      : undefined;
  if (!where) return undefined;
  const [row] = await db.select().from(captures).where(where).limit(1);
  return row;
}

export function captureFilePath(captureId: string): { key: string; url: string; abs: string } {
  const key = `captures/${captureId}.jpg`;
  return { key, url: `/uploads/${key}`, abs: join(config.UPLOADS_DIR, key) };
}

export async function capturesRoutes(fastify: FastifyInstance) {
  await fastify.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
  await mkdir(join(config.UPLOADS_DIR, "captures"), { recursive: true });

  // ── Create ──────────────────────────────────────────────────────────
  fastify.post("/", async (request, reply) => {
    const body = createCaptureSchema.parse(request.body);
    const values = {
      userId: request.userId,
      rollId: body.rollId ?? null,
      cameraId: body.cameraId ?? null,
      lensId: body.lensId ?? null,
      frameNumber: body.frameNumber ?? null,
      capturedAt: body.capturedAt ? new Date(body.capturedAt) : new Date(),
      shutterSpeed: body.shutterSpeed ?? null,
      aperture: body.aperture ?? null,
      compensation: body.compensation ?? null,
      meteringMode: body.meteringMode ?? null,
      subject: body.subject ?? null,
      locationName: body.locationName ?? null,
      notes: body.notes ?? null,
      sceneDescription: body.sceneDescription ?? null,
    };
    // seq = max(seq)+1 for this user, computed inside the insert. The unique
    // index catches a concurrent insert; retry once.
    const nextSeq = sql<number>`(select coalesce(max(${captures.seq}), 0) + 1 from ${captures} where ${captures.userId} = ${request.userId})`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const [row] = await db.insert(captures).values({ ...values, seq: nextSeq }).returning();
        return reply.status(201).send({ data: presentCapture(row) });
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code !== "23505" || attempt === 1) throw err;
      }
    }
  });

  // ── List ────────────────────────────────────────────────────────────
  fastify.get<{ Querystring: { status?: string; roll_id?: string; since?: string; limit?: string } }>(
    "/",
    async (request, reply) => {
      const q = request.query;
      const status = q.status ?? "pending";
      const conds = [eq(captures.userId, request.userId)];
      if (status !== "all") {
        if (status !== "pending" && status !== "assigned") {
          return reply.status(400).send({ error: `Invalid status: ${status}` });
        }
        conds.push(eq(captures.status, status));
      }
      if (q.roll_id) {
        if (!UUID_RE.test(q.roll_id)) return reply.status(400).send({ error: `Invalid roll_id: ${q.roll_id}` });
        conds.push(eq(captures.rollId, q.roll_id));
      }
      if (q.since) {
        const d = new Date(q.since);
        if (Number.isNaN(d.getTime())) return reply.status(400).send({ error: `Invalid since: ${q.since}` });
        conds.push(gte(captures.capturedAt, d));
      }
      const limit = Math.min(Math.max(Number(q.limit ?? 100) || 100, 1), 500);
      const rows = await db
        .select()
        .from(captures)
        .where(and(...conds))
        .orderBy(desc(captures.capturedAt))
        .limit(limit);
      return { data: rows.map(presentCapture) };
    },
  );

  // ── Get one ─────────────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const row = await findCapture(request.userId, request.params.id);
    if (!row) return reply.status(404).send({ error: "Capture not found" });
    return { data: presentCapture(row) };
  });

  // ── Patch ───────────────────────────────────────────────────────────
  fastify.patch<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const row = await findCapture(request.userId, request.params.id);
    if (!row) return reply.status(404).send({ error: "Capture not found" });
    const body = updateCaptureSchema.parse(request.body);
    const set: Partial<typeof captures.$inferInsert> = { updatedAt: new Date() };
    if (body.rollId !== undefined) set.rollId = body.rollId;
    if (body.cameraId !== undefined) set.cameraId = body.cameraId;
    if (body.lensId !== undefined) set.lensId = body.lensId;
    if (body.frameNumber !== undefined) set.frameNumber = body.frameNumber;
    if (body.capturedAt !== undefined) set.capturedAt = new Date(body.capturedAt);
    for (const k of ["shutterSpeed", "aperture", "compensation", "meteringMode", "subject", "locationName", "notes", "sceneDescription"] as const) {
      if (body[k] !== undefined) set[k] = body[k];
    }
    const [updated] = await db.update(captures).set(set).where(eq(captures.id, row.id)).returning();
    return { data: presentCapture(updated) };
  });

  // ── Photo upload (laptop sync) ──────────────────────────────────────
  fastify.post<{ Params: { id: string } }>("/:id/photo", async (request, reply) => {
    const row = await findCapture(request.userId, request.params.id);
    if (!row) return reply.status(404).send({ error: "Capture not found" });

    const fields: Record<string, string> = {};
    let fileBuf: Buffer | undefined;
    let mime: string | undefined;
    for await (const part of request.parts()) {
      if (part.type === "file") {
        if (part.fieldname !== "file") { await part.toBuffer(); continue; }
        mime = part.mimetype;
        fileBuf = await part.toBuffer();
        if (part.file.truncated) return reply.status(413).send({ error: "Photo exceeds 25 MB" });
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }
    if (!fileBuf) return reply.status(400).send({ error: "Missing multipart field 'file'" });
    if (mime !== "image/jpeg") return reply.status(415).send({ error: `Only image/jpeg accepted, got ${mime}` });
    const meta = capturePhotoMetaSchema.parse(fields);

    let dims: { width?: number; height?: number } = {};
    try { dims = imageSize(fileBuf); } catch { /* not fatal */ }

    const { key, url, abs } = captureFilePath(row.id);
    await writeFile(abs, fileBuf);

    const [updated] = await db
      .update(captures)
      .set({
        fileKey: key,
        fileUrl: url,
        mimeType: mime,
        fileSizeBytes: fileBuf.length,
        widthPx: dims.width ?? null,
        heightPx: dims.height ?? null,
        photoTakenAt: meta.photoTakenAt ? new Date(meta.photoTakenAt) : row.photoTakenAt,
        latitude: meta.latitude != null ? String(meta.latitude) : row.latitude,
        longitude: meta.longitude != null ? String(meta.longitude) : row.longitude,
        photoAssetId: meta.photoAssetId ?? row.photoAssetId,
        updatedAt: new Date(),
      })
      .where(eq(captures.id, row.id))
      .returning();
    return { data: presentCapture(updated) };
  });

  // ── Delete ──────────────────────────────────────────────────────────
  fastify.delete<{ Params: { id: string }; Querystring: { force?: string } }>("/:id", async (request, reply) => {
    const row = await findCapture(request.userId, request.params.id);
    if (!row) return reply.status(404).send({ error: "Capture not found" });
    if (row.status === "assigned" && request.query.force !== "true") {
      return reply.status(409).send({ error: `${formatCaptureId(row.seq)} is assigned to a frame; pass ?force=true to delete anyway (the frame and its note stay).` });
    }
    await db.delete(captures).where(eq(captures.id, row.id));
    if (row.fileKey) await rm(join(config.UPLOADS_DIR, row.fileKey), { force: true });
    return reply.status(204).send();
  });
}
