import { and, asc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { createTankSchema, tankPlanRequestSchema, updateTankSchema } from "@tomu/shared";
import { db } from "../db/client.js";
import { tanks } from "../db/schema.js";
import { computeDevCandidates } from "../services/dev-candidates.js";
import { planTanks, type FleetTank } from "../services/tank-plan.js";

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Fuzzy tank-name match for tanksAvailable/excludeTanks ("paterson 2", "sp445"…). */
function nameMatches(query: string, tankName: string): boolean {
  const q = norm(query);
  const n = norm(tankName);
  return n.includes(q) || q.includes(n);
}

export async function tanksRoutes(fastify: FastifyInstance) {
  // ── Fleet CRUD ───────────────────────────────────────────────────────

  fastify.get("/", async (request) => {
    const rows = await db
      .select()
      .from(tanks)
      .where(eq(tanks.userId, request.userId))
      .orderBy(asc(tanks.name));
    return { data: rows };
  });

  fastify.post("/", async (request, reply) => {
    const body = createTankSchema.parse(request.body);
    if (body.kind === "roll" && body.reelUnits == null) {
      return reply.status(400).send({ error: "roll tanks need reelUnits" });
    }
    if (body.kind === "sheet" && body.sheetCapacity == null) {
      return reply.status(400).send({ error: "sheet tanks need sheetCapacity" });
    }
    const [created] = await db
      .insert(tanks)
      .values({
        userId: request.userId,
        name: body.name,
        kind: body.kind,
        volumeMl: body.volumeMl,
        reelUnits: body.reelUnits != null ? String(body.reelUnits) : null,
        sheetCapacity: body.sheetCapacity ?? null,
        quantity: body.quantity,
        agitation: body.agitation,
        notes: body.notes ?? null,
      })
      .returning();
    return reply.status(201).send({ data: created });
  });

  fastify.patch<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const body = updateTankSchema.parse(request.body);
    const [updated] = await db
      .update(tanks)
      .set({
        ...(body.name != null && { name: body.name }),
        ...(body.kind != null && { kind: body.kind }),
        ...(body.volumeMl != null && { volumeMl: body.volumeMl }),
        ...(body.reelUnits != null && { reelUnits: String(body.reelUnits) }),
        ...(body.sheetCapacity != null && { sheetCapacity: body.sheetCapacity }),
        ...(body.quantity != null && { quantity: body.quantity }),
        ...(body.agitation != null && { agitation: body.agitation }),
        ...(body.notes !== undefined && { notes: body.notes ?? null }),
        ...(body.isActive != null && { isActive: body.isActive }),
        updatedAt: new Date(),
      })
      .where(and(eq(tanks.id, request.params.id), eq(tanks.userId, request.userId)))
      .returning();
    if (!updated) return reply.status(404).send({ error: "Tank not found" });
    return { data: updated };
  });

  fastify.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    // Soft delete — history may reference the tank by name.
    const [updated] = await db
      .update(tanks)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(tanks.id, request.params.id), eq(tanks.userId, request.userId)))
      .returning();
    if (!updated) return reply.status(404).send({ error: "Tank not found" });
    return { data: updated };
  });

  // ── Tank plan ────────────────────────────────────────────────────────
  // Pack the dev backlog into concrete tank loads. Advisory only — session
  // creation stays explicit via POST /dev-sessions.
  fastify.post("/plan", async (request, reply) => {
    const body = tankPlanRequestSchema.parse(request.body ?? {});

    const fleetRows = await db
      .select()
      .from(tanks)
      .where(and(eq(tanks.userId, request.userId), eq(tanks.isActive, true)));
    if (!fleetRows.length) {
      return reply.status(409).send({ error: "No tanks on file — add your fleet first (POST /tanks)" });
    }

    let selected = fleetRows;
    if (body.tanksAvailable?.length) {
      selected = fleetRows.filter((t) => body.tanksAvailable!.some((q) => nameMatches(q, t.name)));
      if (!selected.length) {
        return reply.status(400).send({ error: `tanksAvailable matched no tanks: ${body.tanksAvailable.join(", ")}` });
      }
    }
    if (body.excludeTanks?.length) {
      selected = selected.filter((t) => !body.excludeTanks!.some((q) => nameMatches(q, t.name)));
    }

    // Expand quantities into individual instances the packer can consume.
    const fleet: FleetTank[] = selected.flatMap((t) =>
      Array.from({ length: t.quantity }, () => ({
        tankId: t.id,
        name: t.name,
        kind: t.kind as "roll" | "sheet",
        volumeMl: t.volumeMl,
        capacityUnits: t.kind === "sheet" ? (t.sheetCapacity ?? 0) : Number(t.reelUnits ?? 0),
        agitation: t.agitation,
      })),
    );

    const groups = await computeDevCandidates(request.userId);
    const plan = planTanks(groups, fleet, {
      maxTanks: body.maxTanks,
      includeRolls: body.includeRolls,
      tags: body.tags,
      developer: body.developer,
    });
    return { data: plan };
  });
}
