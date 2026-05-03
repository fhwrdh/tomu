import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  completeDevSessionSchema,
  createDevSessionSchema,
  parseDevShorthand,
} from "@tomu/shared";
import { db } from "../db/client.js";
import { devRecipes, devSessions, filmStocks, rolls } from "../db/schema.js";

/** Compute display ID `YYYYMMDD.NN` for a new dev session. */
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
  const n = existing.length + 1;
  return `${ymd}.${String(n).padStart(2, "0")}`;
}

export async function devSessionsRoutes(fastify: FastifyInstance) {
  // ── Dev candidates ───────────────────────────────────────────────────
  // Returns shot-but-not-yet-developed rolls, grouped by recipe.
  // Tier 1: rolls with explicit intended-dev (from bag/canister labels).
  // Tier 2: rolls without intended-dev → look up most recent completed session for (stockId, ratedIso).
  // Tier 3 (MDC): rolls with no history → look up Massive Dev Chart recipes for the user's preferred developers.
  //               Prefer HC-110, then Rodinal, then 510-Pyro. Match on exact ISO, fall back to nearest within ±20%.
  // Tier 4: still nothing → cluster by (stock, ratedIso) so the user can manually pick a recipe.
  fastify.get("/candidates", async (request) => {
    const shotRolls = await db
      .select({
        id: rolls.id,
        displayId: rolls.displayId,
        filmStockId: rolls.filmStockId,
        ratedIso: rolls.ratedIso,
        format: rolls.format,
        manufacturer: filmStocks.manufacturer,
        stockName: filmStocks.name,
        stockIso: filmStocks.iso,
        intendedDeveloper: rolls.intendedDeveloper,
        intendedDilution: rolls.intendedDilution,
        intendedDilutionRaw: rolls.intendedDilutionRaw,
        intendedDevTimeSeconds: rolls.intendedDevTimeSeconds,
      })
      .from(rolls)
      .innerJoin(filmStocks, eq(rolls.filmStockId, filmStocks.id))
      .where(and(eq(rolls.userId, request.userId), eq(rolls.status, "shot")))
      .orderBy(asc(rolls.displayId));

    // Pull historical recipes: most-recent completed session per (stockId, ratedIso).
    const history = await db
      .select({
        filmStockId: rolls.filmStockId,
        ratedIso: rolls.ratedIso,
        developer: devSessions.developer,
        dilution: devSessions.dilution,
        devTimeSeconds: devSessions.devTimeSeconds,
        temperatureC: devSessions.temperatureC,
        completedAt: devSessions.completedAt,
      })
      .from(devSessions)
      .innerJoin(rolls, eq(rolls.devSessionId, devSessions.id))
      .where(
        and(
          eq(devSessions.userId, request.userId),
          sql`${devSessions.completedAt} IS NOT NULL`,
        ),
      )
      .orderBy(desc(devSessions.completedAt));

    const recipeByStockIso = new Map<string, typeof history[number]>();
    for (const h of history) {
      const key = `${h.filmStockId}|${h.ratedIso ?? ""}`;
      if (!recipeByStockIso.has(key)) recipeByStockIso.set(key, h);
    }

    // Pull all MDC recipes for stocks the user has shot rolls for (just those stocks
    // — keeps the working set small).
    const stockIds = Array.from(new Set(shotRolls.map((r) => r.filmStockId)));
    const mdcRows = stockIds.length
      ? await db
          .select({
            filmStockId: devRecipes.filmStockId,
            developer: devRecipes.developer,
            dilution: devRecipes.dilution,
            asaIso: devRecipes.asaIso,
            time35mmSec: devRecipes.time35mmSec,
            time120Sec: devRecipes.time120Sec,
            timeSheetSec: devRecipes.timeSheetSec,
            temperatureC: devRecipes.temperatureC,
          })
          .from(devRecipes)
          .where(inArray(devRecipes.filmStockId, stockIds))
      : [];

    const DEV_PREF = ["HC-110", "Rodinal", "510-Pyro"];
    /**
     * Find the best MDC recipe for a (stockId, format, ratedIso). Walks developers
     * in user-preference order. For each developer, prefers exact ISO; falls back
     * to the nearest within ±20% (so ISO 5 hits ISO 6 recipes, 1600 hits 2000, etc.).
     */
    function findMdcRecipe(
      stockId: string,
      format: string,
      ratedIso: number | null,
    ): typeof mdcRows[number] | null {
      if (ratedIso == null) return null;
      const stockRecipes = mdcRows.filter((r) => r.filmStockId === stockId);
      if (stockRecipes.length === 0) return null;

      const formatTime = (r: typeof mdcRows[number]) =>
        format === "120"
          ? r.time120Sec
          : format === "4x5" || format === "8x10"
            ? r.timeSheetSec
            : r.time35mmSec;

      for (const dev of DEV_PREF) {
        const devRows = stockRecipes.filter((r) => r.developer === dev && formatTime(r) != null);
        if (!devRows.length) continue;
        const exact = devRows.find((r) => r.asaIso === ratedIso);
        if (exact) return exact;
        // Nearest within ±20%
        const tolerance = 0.2;
        const inRange = devRows
          .filter((r) => Math.abs(r.asaIso - ratedIso) / ratedIso <= tolerance)
          .sort((a, b) => Math.abs(a.asaIso - ratedIso) - Math.abs(b.asaIso - ratedIso));
        if (inRange.length) return inRange[0];
      }
      return null;
    }

    type Recipe = {
      developer: string | null;
      dilution: string | null;
      devTimeSeconds: number | null;
      temperatureC: string | null;
      mdcAsaIso?: number | null;
    };
    type Group = {
      recipeKey: string;
      tier: "intended" | "history" | "mdc" | "stock-iso";
      recipe: (Recipe & { mdcAsaIso?: number | null }) | null;
      rolls: typeof shotRolls;
    };
    const groups = new Map<string, Group>();

    function bucket(key: string, tier: Group["tier"], recipe: Recipe | null, roll: typeof shotRolls[number]) {
      if (!groups.has(key)) groups.set(key, { recipeKey: key, tier, recipe, rolls: [] });
      groups.get(key)!.rolls.push(roll);
    }

    for (const r of shotRolls) {
      // Tier 1: explicit intended dev on the roll
      if (r.intendedDilution != null || r.intendedDevTimeSeconds != null) {
        const dev = r.intendedDeveloper ?? "?";
        const key = `intended|${dev}|${r.intendedDilution ?? ""}|${r.intendedDevTimeSeconds ?? ""}`;
        bucket(key, "intended", {
          developer: r.intendedDeveloper,
          dilution: r.intendedDilution,
          devTimeSeconds: r.intendedDevTimeSeconds,
          temperatureC: null,
        }, r);
        continue;
      }

      // Tier 2: historical recipe for this (stock, ratedIso)
      const hist = recipeByStockIso.get(`${r.filmStockId}|${r.ratedIso ?? ""}`);
      if (hist) {
        const key = `history|${hist.developer}|${hist.dilution ?? ""}|${hist.devTimeSeconds ?? ""}|${hist.temperatureC ?? ""}`;
        bucket(key, "history", {
          developer: hist.developer,
          dilution: hist.dilution,
          devTimeSeconds: hist.devTimeSeconds,
          temperatureC: hist.temperatureC,
        }, r);
        continue;
      }

      // Tier 3: MDC recipe for the format + ISO (preferring user's developer order)
      const mdc = findMdcRecipe(r.filmStockId, r.format, r.ratedIso);
      if (mdc) {
        const time =
          r.format === "120"
            ? mdc.time120Sec
            : r.format === "4x5" || r.format === "8x10"
              ? mdc.timeSheetSec
              : mdc.time35mmSec;
        const key = `mdc|${mdc.developer}|${mdc.dilution}|${time ?? ""}|${mdc.temperatureC ?? ""}|${mdc.asaIso}`;
        bucket(key, "mdc", {
          developer: mdc.developer,
          dilution: mdc.dilution,
          devTimeSeconds: time,
          temperatureC: mdc.temperatureC,
          mdcAsaIso: mdc.asaIso,
        }, r);
        continue;
      }

      // Tier 4: cluster by (stock, ratedIso) so similar rolls land together
      const key = `stock-iso|${r.filmStockId}|${r.ratedIso ?? ""}`;
      bucket(key, "stock-iso", null, r);
    }

    return { data: Array.from(groups.values()) };
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
        manufacturer: filmStocks.manufacturer,
        stockName: filmStocks.name,
        stockIso: filmStocks.iso,
      })
      .from(rolls)
      .innerJoin(filmStocks, eq(rolls.filmStockId, filmStocks.id))
      .where(eq(rolls.devSessionId, session.id))
      .orderBy(asc(rolls.displayId));

    return { data: { ...session, rolls: memberRolls } };
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

    const [session] = await db
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

    await db
      .update(rolls)
      .set({ devSessionId: session.id, status: "developing", updatedAt: new Date() })
      .where(inArray(rolls.id, body.rollIds));

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
