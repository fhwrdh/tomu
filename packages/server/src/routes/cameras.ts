import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { createCameraSchema, updateCameraSchema } from "@tomu/shared";
import { db } from "../db/client.js";
import { cameras } from "../db/schema.js";

export async function camerasRoutes(fastify: FastifyInstance) {
  // List cameras
  fastify.get("/", async (request) => {
    const rows = await db
      .select()
      .from(cameras)
      .where(eq(cameras.userId, request.userId))
      .orderBy(cameras.make, cameras.model);

    return { data: rows };
  });

  // Get camera by ID
  fastify.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const [row] = await db
      .select()
      .from(cameras)
      .where(and(eq(cameras.id, request.params.id), eq(cameras.userId, request.userId)))
      .limit(1);

    if (!row) return reply.status(404).send({ error: "Camera not found" });
    return { data: row };
  });

  // Create camera
  fastify.post("/", async (request, reply) => {
    const body = createCameraSchema.parse(request.body);
    const [row] = await db
      .insert(cameras)
      .values({ ...body, userId: request.userId })
      .returning();

    return reply.status(201).send({ data: row });
  });

  // Update camera
  fastify.patch<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const body = updateCameraSchema.parse(request.body);
    const [row] = await db
      .update(cameras)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(cameras.id, request.params.id), eq(cameras.userId, request.userId)))
      .returning();

    if (!row) return reply.status(404).send({ error: "Camera not found" });
    return { data: row };
  });

  // Delete camera
  fastify.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const [row] = await db
      .delete(cameras)
      .where(and(eq(cameras.id, request.params.id), eq(cameras.userId, request.userId)))
      .returning();

    if (!row) return reply.status(404).send({ error: "Camera not found" });
    return reply.status(204).send();
  });
}
