import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  completeDevSessionSchema,
  createDevSessionSchema,
  formatDevId,
  parseDevShorthand,
} from "@tomu/shared";
import { db } from "../db/client.js";
import { devSessions, filmStocks, rolls } from "../db/schema.js";
import { computeDevCandidates } from "../services/dev-candidates.js";

/** Compute display ID `YYYYMMDD.NN` for a new dev session. Max-based so it
 * survives sparse/imported sequences on the same date. */
async function computeSessionDisplayId(userId: string, localDate?: string): Promise<string> {
  const date = localDate ?? new Date().toISOString().slice(0, 10);
  const ymd = date.replace(/-/g, "");
  const prefix = `${ymd}.`;
  const existing = await db
    .select({ displayId: devSessions.displayId })
    .from(devSessions)
    .where(
      and(
        eq(devSessions.userId, userId),
        sql`${devSessions.displayId} LIKE ${prefix + "%"}`,
      ),
    );
  let maxSeq = 0;
  for (const r of existing) {
    const m = r.displayId?.match(/\.(\d+)$/);
    if (m && Number(m[1]) > maxSeq) maxSeq = Number(m[1]);
  }
  return `${ymd}.${String(maxSeq + 1).padStart(2, "0")}`;
}

export async function devSessionsRoutes(fastify: FastifyInstance) {
  // ── Dev candidates ───────────────────────────────────────────────────
  // Shot-but-undeveloped rolls grouped by recipe (4 tiers). Grouping lives in
  // services/dev-candidates.ts so the tank planner can reuse it verbatim.
  fastify.get("/candidates", async (request) => {
    return { data: await computeDevCandidates(request.userId) };
  });

  // ── List sessions ────────────────────────────────────────────────────
  fastify.get("/", async (request) => {
    const rows = await db
      .select()
      .from(devSessions)
      .where(eq(devSessions.userId, request.userId))
      .orderBy(desc(devSessions.developedAt));
    return { data: rows };
  });

  // ── Get one session with member rolls ────────────────────────────────
  fastify.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const [session] = await db
      .select()
      .from(devSessions)
      .where(and(eq(devSessions.id, request.params.id), eq(devSessions.userId, request.userId)))
      .limit(1);
    if (!session) return reply.status(404).send({ error: "Session not found" });

    const memberRolls = await db
      .select({
        id: rolls.id,
        displayId: rolls.displayId,
        status: rolls.status,
        format: rolls.format,
        ratedIso: rolls.ratedIso,
        devDate: rolls.devDate,
        devSeq: rolls.devSeq,
        manufacturer: filmStocks.manufacturer,
        stockName: filmStocks.name,
        stockIso: filmStocks.iso,
      })
      .from(rolls)
      .innerJoin(filmStocks, eq(rolls.filmStockId, filmStocks.id))
      .where(eq(rolls.devSessionId, session.id))
      .orderBy(asc(rolls.displayId));

    return {
      data: {
        ...session,
        rolls: memberRolls.map((r) => ({ ...r, devId: formatDevId(r.devDate, r.devSeq) })),
      },
    };
  });

  // ── Create session ───────────────────────────────────────────────────
  // Parses shorthand if provided. Verifies all rolls belong to user and are in 'shot' status.
  // Sets rolls.devSessionId and transitions roll status to 'developing'.
  fastify.post("/", async (request, reply) => {
    const body = createDevSessionSchema.parse(request.body);

    const memberRolls = await db
      .select({ id: rolls.id, status: rolls.status })
      .from(rolls)
      .where(and(inArray(rolls.id, body.rollIds), eq(rolls.userId, request.userId)));

    if (memberRolls.length !== body.rollIds.length) {
      return reply.status(404).send({ error: "One or more rolls not found" });
    }
    const wrongStatus = memberRolls.filter((r) => r.status !== "shot");
    if (wrongStatus.length) {
      return reply.status(409).send({
        error: `Rolls must be in 'shot' status to start a dev session.`,
        rolls: wrongStatus.map((r) => r.id),
      });
    }

    let dilution = body.dilution ?? null;
    let devTimeSeconds = body.devTimeSeconds ?? null;
    let dilutionRaw: string | null = null;
    if (body.shorthand) {
      const parsed = parseDevShorthand(body.shorthand);
      dilutionRaw = parsed.raw;
      dilution = body.dilution ?? parsed.dilution;
      devTimeSeconds = body.devTimeSeconds ?? parsed.devTimeSeconds;
    }

    const displayId = await computeSessionDisplayId(request.userId, body.localDate);
    const devDate = body.localDate ?? new Date().toISOString().slice(0, 10);

    // Lifetime Dev Ids: each roll gets the next devSeq, assigned at tank time
    // (this is when bag/canister labels get written). Continues from the
    // all-time max — the pre-Tomu import ended at 0716, live rolls at 0735.
    const [{ maxSeq }] = await db
      .select({ maxSeq: sql<number | null>`max(${rolls.devSeq})` })
      .from(rolls)
      .where(eq(rolls.userId, request.userId));

    const session = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(devSessions)
        .values({
          userId: request.userId,
          displayId,
          developer: body.developer,
          dilution,
          dilutionRaw,
          devTimeSeconds,
          temperatureC: body.temperatureC != null ? String(body.temperatureC) : null,
          agitation: body.agitation ?? null,
          tank: body.tank ?? null,
          stopBath: body.stopBath ?? null,
          fixer: body.fixer ?? null,
          fixerTimeSeconds: body.fixerTimeSeconds ?? null,
          washMethod: body.washMethod ?? null,
          wettingAgent: body.wettingAgent ?? null,
          notes: body.notes ?? null,
          developedAt: body.developedAt ? new Date(body.developedAt) : new Date(),
        })
        .returning();

      let seq = maxSeq ?? 0;
      for (const rollId of body.rollIds) {
        seq += 1;
        await tx
          .update(rolls)
          .set({
            devSessionId: created.id,
            status: "developing",
            devDate,
            devSeq: seq,
            updatedAt: new Date(),
          })
          .where(eq(rolls.id, rollId));
      }
      return created;
    });

    return reply.status(201).send({ data: session });
  });

  // ── Complete session ─────────────────────────────────────────────────
  // Sets completedAt and results; transitions all member rolls to 'developed'.
  fastify.post<{ Params: { id: string } }>("/:id/complete", async (request, reply) => {
    const body = completeDevSessionSchema.parse(request.body ?? {});

    const [existing] = await db
      .select()
      .from(devSessions)
      .where(and(eq(devSessions.id, request.params.id), eq(devSessions.userId, request.userId)))
      .limit(1);
    if (!existing) return reply.status(404).send({ error: "Session not found" });
    if (existing.completedAt) {
      return reply.status(409).send({ error: "Session already completed" });
    }

    const [session] = await db
      .update(devSessions)
      .set({
        completedAt: new Date(),
        resultsRating: body.resultsRating ?? null,
        resultsNotes: body.resultsNotes ?? null,
        updatedAt: new Date(),
      })
      .where(eq(devSessions.id, existing.id))
      .returning();

    await db
      .update(rolls)
      .set({ status: "developed", updatedAt: new Date() })
      .where(eq(rolls.devSessionId, existing.id));

    return { data: session };
  });
}
