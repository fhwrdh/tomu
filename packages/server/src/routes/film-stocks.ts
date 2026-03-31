import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { createFilmStockSchema, updateFilmStockSchema } from "@filmlog/shared";
import { db } from "../db/client.js";
import { filmInventory, filmStocks } from "../db/schema.js";

export async function filmStocksRoutes(fastify: FastifyInstance) {
  // List film stocks with inventory totals
  fastify.get("/", async (request) => {
    const rows = await db
      .select({
        id: filmStocks.id,
        userId: filmStocks.userId,
        manufacturer: filmStocks.manufacturer,
        name: filmStocks.name,
        iso: filmStocks.iso,
        type: filmStocks.type,
        format: filmStocks.format,
        notes: filmStocks.notes,
        isActive: filmStocks.isActive,
        createdAt: filmStocks.createdAt,
        updatedAt: filmStocks.updatedAt,
        totalRolls: sql<number>`coalesce(sum(${filmInventory.quantity}), 0)::int`,
      })
      .from(filmStocks)
      .leftJoin(filmInventory, eq(filmStocks.id, filmInventory.filmStockId))
      .where(eq(filmStocks.userId, request.userId))
      .groupBy(filmStocks.id)
      .orderBy(filmStocks.manufacturer, filmStocks.name);

    return { data: rows };
  });

  fastify.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const [stock] = await db
      .select()
      .from(filmStocks)
      .where(and(eq(filmStocks.id, request.params.id), eq(filmStocks.userId, request.userId)))
      .limit(1);

    if (!stock) return reply.status(404).send({ error: "Film stock not found" });

    const inventory = await db
      .select()
      .from(filmInventory)
      .where(eq(filmInventory.filmStockId, stock.id))
      .orderBy(filmInventory.expirationDate);

    return { data: { ...stock, inventoryItems: inventory } };
  });

  fastify.post("/", async (request, reply) => {
    const body = createFilmStockSchema.parse(request.body);
    const [row] = await db
      .insert(filmStocks)
      .values({ ...body, userId: request.userId })
      .returning();

    return reply.status(201).send({ data: row });
  });

  fastify.patch<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const body = updateFilmStockSchema.parse(request.body);
    const [row] = await db
      .update(filmStocks)
      .set({ ...body, updatedAt: new Date() })
      .where(and(eq(filmStocks.id, request.params.id), eq(filmStocks.userId, request.userId)))
      .returning();

    if (!row) return reply.status(404).send({ error: "Film stock not found" });
    return { data: row };
  });

  fastify.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const [row] = await db
      .delete(filmStocks)
      .where(and(eq(filmStocks.id, request.params.id), eq(filmStocks.userId, request.userId)))
      .returning();

    if (!row) return reply.status(404).send({ error: "Film stock not found" });
    return reply.status(204).send();
  });
}
