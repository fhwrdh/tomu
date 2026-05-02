import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  createFrameSchema,
  createNoteSchema,
  createRollSchema,
  logShotRollSchema,
  parseDevShorthand,
  unloadRollSchema,
  updateRollSchema,
} from "@tomu/shared";
import { db } from "../db/client.js";
import {
  cameras,
  filmInventory,
  filmStocks,
  frames,
  notes,
  rolls,
} from "../db/schema.js";

/** Nominal bulk-roll consumption per 35mm cassette (feet). One 36-exposure cassette ≈ 5ft. */
const BULK_CASSETTE_FT = 5;

/**
 * Choose the inventory item to decrement for a load.
 * Prefers: form match if given, else factory_roll, else sheet, else bulk_roll.
 * Returns the row or null.
 */
async function pickInventoryItem(
  userId: string,
  filmStockId: string,
  format: string,
  formHint?: string,
) {
  const candidates = await db
    .select()
    .from(filmInventory)
    .where(
      and(
        eq(filmInventory.userId, userId),
        eq(filmInventory.filmStockId, filmStockId),
        eq(filmInventory.format, format),
      ),
    );

  if (candidates.length === 0) return null;

  const hasQty = (row: typeof candidates[number]) => {
    if (row.form === "bulk_roll") {
      return Number(row.remainingLengthFt ?? 0) >= BULK_CASSETTE_FT;
    }
    return row.quantity > 0;
  };

  const available = candidates.filter(hasQty);
  if (available.length === 0) return null;

  if (formHint) {
    const exact = available.find((r) => r.form === formHint);
    if (exact) return exact;
  }

  const priority = ["factory_roll", "sheet", "bulk_roll"];
  for (const form of priority) {
    const hit = available.find((r) => r.form === form);
    if (hit) return hit;
  }
  return available[0];
}

/**
 * Compute display ID `YYYYMMDD.NN` for a roll on a given local date.
 * If `seq` is provided, returns that exact slot or throws CollisionError if taken.
 * Otherwise returns max(seq)+1 across existing IDs for the date — handles sparse
 * sequences (e.g. .07 exists but .01-.06 don't) without recycling numbers.
 */
class DisplayIdCollisionError extends Error {
  constructor(public displayId: string) {
    super(`Display ID ${displayId} is already in use`);
  }
}

async function computeDisplayId(
  userId: string,
  localDate?: string,
  seq?: number,
): Promise<string> {
  const date = localDate ?? new Date().toISOString().slice(0, 10);
  const ymd = date.replace(/-/g, "");
  const prefix = `${ymd}.`;

  const existing = await db
    .select({ displayId: rolls.displayId })
    .from(rolls)
    .where(
      and(
        eq(rolls.userId, userId),
        sql`${rolls.displayId} LIKE ${prefix + "%"}`,
      ),
    );

  const usedSeqs = new Set<number>();
  let maxSeq = 0;
  for (const r of existing) {
    const m = r.displayId?.match(/\.(\d+)$/);
    if (m) {
      const n = Number(m[1]);
      usedSeqs.add(n);
      if (n > maxSeq) maxSeq = n;
    }
  }

  if (seq != null) {
    if (usedSeqs.has(seq)) {
      throw new DisplayIdCollisionError(`${ymd}.${String(seq).padStart(2, "0")}`);
    }
    return `${ymd}.${String(seq).padStart(2, "0")}`;
  }

  const next = maxSeq + 1;
  return `${ymd}.${String(next).padStart(2, "0")}`;
}

export async function rollsRoutes(fastify: FastifyInstance) {
  // ── List rolls ─────────────────────────────────────────────────────────
  // Query: ?status=active (default: loaded+shooting) | all | <any RollStatus>
  fastify.get<{ Querystring: { status?: string } }>("/", async (request) => {
    const status = request.query.status ?? "active";
    const statusFilter =
      status === "active"
        ? inArray(rolls.status, ["loaded", "shooting"])
        : status === "all"
          ? undefined
          : eq(rolls.status, status);

    const where = statusFilter
      ? and(eq(rolls.userId, request.userId), statusFilter)
      : eq(rolls.userId, request.userId);

    const rows = await db
      .select({
        id: rolls.id,
        cameraId: rolls.cameraId,
        filmStockId: rolls.filmStockId,
        format: rolls.format,
        form: rolls.form,
        status: rolls.status,
        loadedAt: rolls.loadedAt,
        unloadedAt: rolls.unloadedAt,
        displayId: rolls.displayId,
        frameCount: rolls.frameCount,
        ratedIso: rolls.ratedIso,
        title: rolls.title,
        description: rolls.description,
        tags: rolls.tags,
        createdAt: rolls.createdAt,
        updatedAt: rolls.updatedAt,
        manufacturer: filmStocks.manufacturer,
        stockName: filmStocks.name,
        iso: filmStocks.iso,
        filmType: filmStocks.type,
        cameraMake: cameras.make,
        cameraModel: cameras.model,
      })
      .from(rolls)
      .innerJoin(filmStocks, eq(rolls.filmStockId, filmStocks.id))
      .leftJoin(cameras, eq(rolls.cameraId, cameras.id))
      .where(where)
      .orderBy(desc(rolls.loadedAt));

    // Frame counts per roll (number of frames actually logged)
    const countMap = new Map<string, number>();
    if (rows.length) {
      const counts = await db
        .select({
          rollId: frames.rollId,
          shot: sql<number>`count(*)::int`,
        })
        .from(frames)
        .where(inArray(frames.rollId, rows.map((r) => r.id)))
        .groupBy(frames.rollId);
      for (const c of counts) countMap.set(c.rollId, c.shot);
    }

    return {
      data: rows.map((r) => ({ ...r, framesShot: countMap.get(r.id) ?? 0 })),
    };
  });

  // ── Get single roll with frames + notes ───────────────────────────────
  fastify.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const [roll] = await db
      .select({
        id: rolls.id,
        cameraId: rolls.cameraId,
        filmStockId: rolls.filmStockId,
        format: rolls.format,
        form: rolls.form,
        status: rolls.status,
        loadedAt: rolls.loadedAt,
        unloadedAt: rolls.unloadedAt,
        displayId: rolls.displayId,
        frameCount: rolls.frameCount,
        ratedIso: rolls.ratedIso,
        title: rolls.title,
        description: rolls.description,
        tags: rolls.tags,
        createdAt: rolls.createdAt,
        updatedAt: rolls.updatedAt,
        manufacturer: filmStocks.manufacturer,
        stockName: filmStocks.name,
        iso: filmStocks.iso,
        filmType: filmStocks.type,
        cameraMake: cameras.make,
        cameraModel: cameras.model,
      })
      .from(rolls)
      .innerJoin(filmStocks, eq(rolls.filmStockId, filmStocks.id))
      .leftJoin(cameras, eq(rolls.cameraId, cameras.id))
      .where(and(eq(rolls.id, request.params.id), eq(rolls.userId, request.userId)))
      .limit(1);

    if (!roll) return reply.status(404).send({ error: "Roll not found" });

    const [rollFrames, rollNotes] = await Promise.all([
      db
        .select()
        .from(frames)
        .where(eq(frames.rollId, roll.id))
        .orderBy(asc(frames.frameNumber)),
      db
        .select()
        .from(notes)
        .where(eq(notes.rollId, roll.id))
        .orderBy(asc(notes.createdAt)),
    ]);

    // Frame-level notes (joined through frame ids belonging to this roll)
    const frameIds = rollFrames.map((f) => f.id);
    const frameNotes = frameIds.length
      ? await db
          .select()
          .from(notes)
          .where(inArray(notes.frameId, frameIds))
          .orderBy(asc(notes.createdAt))
      : [];

    return {
      data: {
        ...roll,
        frames: rollFrames,
        notes: rollNotes,
        frameNotes,
      },
    };
  });

  // ── Load a roll ───────────────────────────────────────────────────────
  fastify.post("/", async (request, reply) => {
    const body = createRollSchema.parse(request.body);

    // Verify stock belongs to user.
    const [stock] = await db
      .select()
      .from(filmStocks)
      .where(and(eq(filmStocks.id, body.filmStockId), eq(filmStocks.userId, request.userId)))
      .limit(1);
    if (!stock) return reply.status(404).send({ error: "Film stock not found" });

    // Optional camera must belong to user; also pulls frameCount default.
    let cameraDefault: number | null = null;
    if (body.cameraId) {
      const [cam] = await db
        .select()
        .from(cameras)
        .where(and(eq(cameras.id, body.cameraId), eq(cameras.userId, request.userId)))
        .limit(1);
      if (!cam) return reply.status(404).send({ error: "Camera not found" });
      cameraDefault = cam.frameCount;
    }

    // Find inventory to decrement.
    const inv = await pickInventoryItem(request.userId, body.filmStockId, body.format, body.form);
    if (!inv) {
      return reply
        .status(409)
        .send({ error: `No available ${body.format} inventory for this stock.` });
    }

    // Decrement inventory.
    if (inv.form === "bulk_roll") {
      const remaining = Number(inv.remainingLengthFt ?? 0) - BULK_CASSETTE_FT;
      await db
        .update(filmInventory)
        .set({ remainingLengthFt: String(remaining), updatedAt: new Date() })
        .where(eq(filmInventory.id, inv.id));
    } else {
      await db
        .update(filmInventory)
        .set({ quantity: inv.quantity - 1, updatedAt: new Date() })
        .where(eq(filmInventory.id, inv.id));
    }

    // Resolve frameCount: explicit > inv override > stock default (factory/sheet only) > camera default > format fallback.
    // Bulk-loaded rolls ignore stock.frameCount since you decide the count when spooling; inv.frameCount
    // covers the pre-spooled-cassette case where specific cassettes have known frame counts.
    const fallback = body.format === "35mm" ? 36 : body.format === "120" ? 10 : 1;
    const stockDefault = inv.form !== "bulk_roll" ? stock.frameCount : null;
    const frameCount = body.frameCount ?? inv.frameCount ?? stockDefault ?? cameraDefault ?? fallback;

    const [row] = await db
      .insert(rolls)
      .values({
        userId: request.userId,
        filmStockId: body.filmStockId,
        cameraId: body.cameraId ?? null,
        format: body.format,
        form: inv.form,
        status: "loaded",
        loadedAt: new Date(),
        frameCount,
        ratedIso: body.ratedIso ?? inv.ratedIso ?? stock.iso,
        pushPullStops: body.pushPullStops != null ? String(body.pushPullStops) : null,
        // Carry the inventory display ID (e.g. R001) over as the roll's title for traceability.
        title: body.title ?? inv.displayId ?? null,
        description: body.description ?? null,
        tags: body.tags ?? [],
      })
      .returning();

    return reply.status(201).send({ data: row });
  });

  // ── Log a shot roll (retroactive entry) ───────────────────────────────
  // Drops a roll directly into status='shot' with no inventory decrement.
  // For backlog/fridge-pile entry, not the field-shoot flow.
  fastify.post("/log-shot", async (request, reply) => {
    const body = logShotRollSchema.parse(request.body);

    const [stock] = await db
      .select()
      .from(filmStocks)
      .where(and(eq(filmStocks.id, body.filmStockId), eq(filmStocks.userId, request.userId)))
      .limit(1);
    if (!stock) return reply.status(404).send({ error: "Film stock not found" });

    let cameraDefault: number | null = null;
    if (body.cameraId) {
      const [cam] = await db
        .select()
        .from(cameras)
        .where(and(eq(cameras.id, body.cameraId), eq(cameras.userId, request.userId)))
        .limit(1);
      if (!cam) return reply.status(404).send({ error: "Camera not found" });
      cameraDefault = cam.frameCount;
    }

    const fallback = body.format === "35mm" ? 36 : body.format === "120" ? 10 : 1;
    const frameCount =
      body.frameCount ?? stock.frameCount ?? cameraDefault ?? fallback;

    let displayId: string | null = null;
    if (body.shotDate) {
      try {
        displayId = await computeDisplayId(request.userId, body.shotDate, body.fieldSeq);
      } catch (e) {
        if (e instanceof DisplayIdCollisionError) {
          return reply.status(409).send({
            error: `Display ID ${e.displayId} is already in use. Pick a different fieldSeq or omit it for auto-assignment.`,
          });
        }
        throw e;
      }
    }
    const unloadedAt = body.shotDate ? new Date(`${body.shotDate}T12:00:00Z`) : null;

    let intendedDilution = body.intendedDilution ?? null;
    let intendedDevTimeSeconds = body.intendedDevTimeSeconds ?? null;
    let intendedDilutionRaw: string | null = null;
    if (body.devShorthand) {
      const parsed = parseDevShorthand(body.devShorthand);
      intendedDilutionRaw = parsed.raw;
      intendedDilution = body.intendedDilution ?? parsed.dilution;
      intendedDevTimeSeconds = body.intendedDevTimeSeconds ?? parsed.devTimeSeconds;
    }

    const [row] = await db
      .insert(rolls)
      .values({
        userId: request.userId,
        filmStockId: body.filmStockId,
        cameraId: body.cameraId ?? null,
        format: body.format,
        form: body.form ?? "factory_roll",
        status: "shot",
        loadedAt: null,
        unloadedAt,
        displayId,
        frameCount,
        ratedIso: body.ratedIso ?? stock.iso,
        pushPullStops: body.pushPullStops != null ? String(body.pushPullStops) : null,
        title: body.title ?? null,
        description: body.description ?? null,
        tags: body.tags ?? [],
        intendedDeveloper: body.intendedDeveloper ?? null,
        intendedDilution,
        intendedDilutionRaw,
        intendedDevTimeSeconds,
      })
      .returning();

    if (body.note) {
      await db.insert(notes).values({
        userId: request.userId,
        rollId: row.id,
        type: "text",
        content: body.note,
      });
    }

    return reply.status(201).send({ data: row });
  });

  // ── Update roll metadata ──────────────────────────────────────────────
  fastify.patch<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const body = updateRollSchema.parse(request.body);
    const { devShorthand, ...rest } = body;

    // devShorthand parses into intended dilution + time. Explicit fields override.
    const updates: Record<string, unknown> = { ...rest, updatedAt: new Date() };
    if (rest.pushPullStops != null) {
      updates.pushPullStops = String(rest.pushPullStops);
    }
    if (devShorthand !== undefined) {
      if (devShorthand === null) {
        updates.intendedDilution = updates.intendedDilution ?? null;
        updates.intendedDilutionRaw = null;
        updates.intendedDevTimeSeconds = updates.intendedDevTimeSeconds ?? null;
      } else {
        const parsed = parseDevShorthand(devShorthand);
        updates.intendedDilutionRaw = parsed.raw;
        if (rest.intendedDilution === undefined) updates.intendedDilution = parsed.dilution;
        if (rest.intendedDevTimeSeconds === undefined) updates.intendedDevTimeSeconds = parsed.devTimeSeconds;
      }
    }

    const [row] = await db
      .update(rolls)
      .set(updates)
      .where(and(eq(rolls.id, request.params.id), eq(rolls.userId, request.userId)))
      .returning();

    if (!row) return reply.status(404).send({ error: "Roll not found" });
    return { data: row };
  });

  // ── Unload a roll ─────────────────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>("/:id/unload", async (request, reply) => {
    const body = unloadRollSchema.parse(request.body ?? {});

    const [existing] = await db
      .select()
      .from(rolls)
      .where(and(eq(rolls.id, request.params.id), eq(rolls.userId, request.userId)))
      .limit(1);
    if (!existing) return reply.status(404).send({ error: "Roll not found" });
    if (existing.unloadedAt) {
      return reply.status(409).send({ error: "Roll is already unloaded" });
    }

    const displayId = await computeDisplayId(request.userId, body.localDate);

    const [row] = await db
      .update(rolls)
      .set({
        unloadedAt: new Date(),
        displayId,
        status: "shot",
        updatedAt: new Date(),
      })
      .where(eq(rolls.id, existing.id))
      .returning();

    // Optional unload note attached to the roll
    if (body.note) {
      await db.insert(notes).values({
        userId: request.userId,
        rollId: existing.id,
        type: "text",
        content: body.note,
      });
    }

    return { data: row };
  });

  // ── Log a frame ───────────────────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>("/:id/frames", async (request, reply) => {
    const body = createFrameSchema.parse(request.body);

    const [roll] = await db
      .select()
      .from(rolls)
      .where(and(eq(rolls.id, request.params.id), eq(rolls.userId, request.userId)))
      .limit(1);
    if (!roll) return reply.status(404).send({ error: "Roll not found" });
    if (roll.unloadedAt) {
      return reply.status(409).send({ error: "Roll is already unloaded" });
    }

    // Auto-assign frame number if omitted: next available after max.
    let frameNumber = body.frameNumber;
    if (frameNumber == null) {
      const [{ maxNum }] = await db
        .select({ maxNum: sql<number | null>`max(${frames.frameNumber})` })
        .from(frames)
        .where(eq(frames.rollId, roll.id));
      frameNumber = (maxNum ?? 0) + 1;
    }

    const [row] = await db
      .insert(frames)
      .values({
        rollId: roll.id,
        frameNumber,
        lensId: body.lensId ?? null,
        shutterSpeed: body.shutterSpeed ?? null,
        aperture: body.aperture ?? null,
        compensation: body.compensation ?? null,
        meteringMode: body.meteringMode ?? null,
        subject: body.subject ?? null,
        notes: body.notes ?? null,
        latitude: body.latitude != null ? String(body.latitude) : null,
        longitude: body.longitude != null ? String(body.longitude) : null,
        locationName: body.locationName ?? null,
        shotAt: body.shotAt ? new Date(body.shotAt) : new Date(),
        tags: body.tags ?? [],
      })
      .returning();

    // First frame promotes status to "shooting".
    if (roll.status === "loaded") {
      await db
        .update(rolls)
        .set({ status: "shooting", updatedAt: new Date() })
        .where(eq(rolls.id, roll.id));
    }

    return reply.status(201).send({ data: row });
  });

  // ── Add note to roll ──────────────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>("/:id/notes", async (request, reply) => {
    const body = createNoteSchema.parse(request.body);

    const [roll] = await db
      .select({ id: rolls.id })
      .from(rolls)
      .where(and(eq(rolls.id, request.params.id), eq(rolls.userId, request.userId)))
      .limit(1);
    if (!roll) return reply.status(404).send({ error: "Roll not found" });

    const [row] = await db
      .insert(notes)
      .values({
        userId: request.userId,
        rollId: roll.id,
        type: body.type ?? "text",
        content: body.content,
        latitude: body.latitude != null ? String(body.latitude) : null,
        longitude: body.longitude != null ? String(body.longitude) : null,
      })
      .returning();

    return reply.status(201).send({ data: row });
  });

  // ── Undo load (cancel a roll before unload) ──────────────────────────
  // Distinct from unload: this treats the load as a mistake, deletes the
  // roll entirely (cascading frames/notes), and credits inventory back.
  fastify.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const [existing] = await db
      .select()
      .from(rolls)
      .where(and(eq(rolls.id, request.params.id), eq(rolls.userId, request.userId)))
      .limit(1);
    if (!existing) return reply.status(404).send({ error: "Roll not found" });
    if (existing.unloadedAt) {
      return reply
        .status(409)
        .send({ error: "Roll is already unloaded. Undo is only available before unload." });
    }

    // Restore inventory: try exact stock+format+form first, then fall back to stock+format.
    const exact = await db
      .select()
      .from(filmInventory)
      .where(
        and(
          eq(filmInventory.userId, request.userId),
          eq(filmInventory.filmStockId, existing.filmStockId),
          eq(filmInventory.format, existing.format),
          eq(filmInventory.form, existing.form),
        ),
      )
      .limit(1);
    let target = exact[0];
    if (!target) {
      const loose = await db
        .select()
        .from(filmInventory)
        .where(
          and(
            eq(filmInventory.userId, request.userId),
            eq(filmInventory.filmStockId, existing.filmStockId),
            eq(filmInventory.format, existing.format),
          ),
        )
        .limit(1);
      target = loose[0];
    }

    if (target) {
      if (target.form === "bulk_roll") {
        const restored = Number(target.remainingLengthFt ?? 0) + BULK_CASSETTE_FT;
        await db
          .update(filmInventory)
          .set({ remainingLengthFt: String(restored), updatedAt: new Date() })
          .where(eq(filmInventory.id, target.id));
      } else {
        await db
          .update(filmInventory)
          .set({ quantity: target.quantity + 1, updatedAt: new Date() })
          .where(eq(filmInventory.id, target.id));
      }
    } else {
      fastify.log.warn(
        { rollId: existing.id, filmStockId: existing.filmStockId },
        "Undo load: no matching inventory item to credit; inventory will be off by 1.",
      );
    }

    // Hard delete; FK cascade drops frames and roll-scoped notes.
    await db.delete(rolls).where(eq(rolls.id, existing.id));

    return reply.status(204).send();
  });

  // ── Add note to a specific frame (by frame number) ───────────────────
  fastify.post<{ Params: { id: string; frameNumber: string } }>(
    "/:id/frames/:frameNumber/notes",
    async (request, reply) => {
      const body = createNoteSchema.parse(request.body);
      const fn = Number(request.params.frameNumber);
      if (!Number.isFinite(fn) || fn < 1) {
        return reply.status(400).send({ error: "Invalid frame number" });
      }

      const [frame] = await db
        .select({ id: frames.id })
        .from(frames)
        .innerJoin(rolls, eq(frames.rollId, rolls.id))
        .where(
          and(
            eq(rolls.id, request.params.id),
            eq(rolls.userId, request.userId),
            eq(frames.frameNumber, fn),
          ),
        )
        .limit(1);
      if (!frame) return reply.status(404).send({ error: "Frame not found" });

      const [row] = await db
        .insert(notes)
        .values({
          userId: request.userId,
          frameId: frame.id,
          type: body.type ?? "text",
          content: body.content,
          latitude: body.latitude != null ? String(body.latitude) : null,
          longitude: body.longitude != null ? String(body.longitude) : null,
        })
        .returning();

      return reply.status(201).send({ data: row });
    },
  );
}
