import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { createLensSchema, updateLensSchema } from "@filmlog/shared";
import { db } from "../db/client.js";
import { lenses } from "../db/schema.js";

export async function lensesRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (request) => {
    const rows = await db
      .select()
      .from(lenses)
      .where(eq(lenses.userId, request.userId))
      .orderBy(lenses.make, lenses.model);

    return { data: rows };
  });

  fastify.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const [row] = await db
      .select()
      .from(lenses)
      .where(and(eq(lenses.id, request.params.id), eq(lenses.userId, request.userId)))
      .limit(1);

    if (!row) return reply.status(404).send({ error: "Lens not found" });
    return { data: row };
  });

  fastify.post("/", async (request, reply) => {
    const body = createLensSchema.parse(request.body);
    const [row] = await db
      .insert(lenses)
      .values({ ...body, userId: request.userId })
      .returning();

    return reply.status(201).send({ data: row });
  });

  fastify.patch<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const body = updateLensSchema.parse(request.body);
    const [row] = await db
      .update(lenses)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(lenses.id, request.params.id), eq(lenses.userId, request.userId)))
      .returning();

    if (!row) return reply.status(404).send({ error: "Lens not found" });
    return { data: row };
  });

  fastify.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const [row] = await db
      .delete(lenses)
      .where(and(eq(lenses.id, request.params.id), eq(lenses.userId, request.userId)))
      .returning();

    if (!row) return reply.status(404).send({ error: "Lens not found" });
    return reply.status(204).send();
  });
}
