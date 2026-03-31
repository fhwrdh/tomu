import { and, eq, sql, lte } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { createFilmInventorySchema, updateFilmInventorySchema } from "@filmlog/shared";
import { db } from "../db/client.js";
import { filmInventory, filmStocks } from "../db/schema.js";

export async function filmInventoryRoutes(fastify: FastifyInstance) {
  // List all inventory items (with film stock details)
  fastify.get("/", async (request) => {
    const rows = await db
      .select({
        id: filmInventory.id,
        filmStockId: filmInventory.filmStockId,
        quantity: filmInventory.quantity,
        expirationDate: filmInventory.expirationDate,
        storageLocation: filmInventory.storageLocation,
        purchaseDate: filmInventory.purchaseDate,
        costPerRoll: filmInventory.costPerRoll,
        notes: filmInventory.notes,
        createdAt: filmInventory.createdAt,
        updatedAt: filmInventory.updatedAt,
        // Film stock details
        manufacturer: filmStocks.manufacturer,
        stockName: filmStocks.name,
        iso: filmStocks.iso,
        filmType: filmStocks.type,
        format: filmStocks.format,
      })
      .from(filmInventory)
      .innerJoin(filmStocks, eq(filmInventory.filmStockId, filmStocks.id))
      .where(eq(filmInventory.userId, request.userId))
      .orderBy(filmStocks.manufacturer, filmStocks.name);

    return { data: rows };
  });

  // Summary: total rolls by stock, expiring soon, low stock
  fastify.get("/summary", async (request) => {
    // Rolls by stock
    const byStock = await db
      .select({
        filmStockId: filmInventory.filmStockId,
        manufacturer: filmStocks.manufacturer,
        stockName: filmStocks.name,
        iso: filmStocks.iso,
        filmType: filmStocks.type,
        format: filmStocks.format,
        totalRolls: sql<number>`sum(${filmInventory.quantity})::int`,
      })
      .from(filmInventory)
      .innerJoin(filmStocks, eq(filmInventory.filmStockId, filmStocks.id))
      .where(eq(filmInventory.userId, request.userId))
      .groupBy(
        filmInventory.filmStockId,
        filmStocks.manufacturer,
        filmStocks.name,
        filmStocks.iso,
        filmStocks.type,
        filmStocks.format
      )
      .orderBy(filmStocks.manufacturer, filmStocks.name);

    // Expiring within 6 months
    const sixMonthsFromNow = new Date();
    sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);
    const expiringSoon = await db
      .select({
        id: filmInventory.id,
        manufacturer: filmStocks.manufacturer,
        stockName: filmStocks.name,
        format: filmStocks.format,
        quantity: filmInventory.quantity,
        expirationDate: filmInventory.expirationDate,
        storageLocation: filmInventory.storageLocation,
      })
      .from(filmInventory)
      .innerJoin(filmStocks, eq(filmInventory.filmStockId, filmStocks.id))
      .where(
        and(
          eq(filmInventory.userId, request.userId),
          lte(filmInventory.expirationDate, sixMonthsFromNow.toISOString().split("T")[0])
        )
      )
      .orderBy(filmInventory.expirationDate);

    const totalRolls = byStock.reduce((sum, s) => sum + s.totalRolls, 0);

    return {
      data: {
        totalRolls,
        byStock,
        expiringSoon,
      },
    };
  });

  // Add inventory
  fastify.post("/", async (request, reply) => {
    const body = createFilmInventorySchema.parse(request.body);
    const { costPerRoll, ...rest } = body;
    const [row] = await db
      .insert(filmInventory)
      .values({
        ...rest,
        userId: request.userId,
        ...(costPerRoll != null ? { costPerRoll: String(costPerRoll) } : {}),
      })
      .returning();

    return reply.status(201).send({ data: row });
  });

  // Update inventory item
  fastify.patch<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const body = updateFilmInventorySchema.parse(request.body);
    const { costPerRoll, ...rest } = body;
    const [row] = await db
      .update(filmInventory)
      .set({
        ...rest,
        updatedAt: new Date(),
        ...(costPerRoll != null ? { costPerRoll: String(costPerRoll) } : {}),
      })
      .where(and(eq(filmInventory.id, request.params.id), eq(filmInventory.userId, request.userId)))
      .returning();

    if (!row) return reply.status(404).send({ error: "Inventory item not found" });
    return { data: row };
  });

  // Delete inventory item
  fastify.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const [row] = await db
      .delete(filmInventory)
      .where(and(eq(filmInventory.id, request.params.id), eq(filmInventory.userId, request.userId)))
      .returning();

    if (!row) return reply.status(404).send({ error: "Inventory item not found" });
    return reply.status(204).send();
  });
}
