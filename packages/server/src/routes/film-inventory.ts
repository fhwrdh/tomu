import { and, eq, lte } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { createFilmInventorySchema, updateFilmInventorySchema } from "@tomu/shared";
import { db } from "../db/client.js";
import { filmInventory, filmStocks } from "../db/schema.js";

export async function filmInventoryRoutes(fastify: FastifyInstance) {
  // List all inventory items (with film stock details)
  fastify.get("/", async (request) => {
    const rows = await db
      .select({
        id: filmInventory.id,
        filmStockId: filmInventory.filmStockId,
        format: filmInventory.format,
        form: filmInventory.form,
        quantity: filmInventory.quantity,
        remainingLengthFt: filmInventory.remainingLengthFt,
        originalLengthFt: filmInventory.originalLengthFt,
        expirationDate: filmInventory.expirationDate,
        storageLocation: filmInventory.storageLocation,
        purchaseDate: filmInventory.purchaseDate,
        costPerRoll: filmInventory.costPerRoll,
        notes: filmInventory.notes,
        createdAt: filmInventory.createdAt,
        updatedAt: filmInventory.updatedAt,
        manufacturer: filmStocks.manufacturer,
        stockName: filmStocks.name,
        iso: filmStocks.iso,
        filmType: filmStocks.type,
      })
      .from(filmInventory)
      .innerJoin(filmStocks, eq(filmInventory.filmStockId, filmStocks.id))
      .where(eq(filmInventory.userId, request.userId))
      .orderBy(filmStocks.manufacturer, filmStocks.name);

    return { data: rows };
  });

  // Summary
  fastify.get("/summary", async (request) => {
    const items = await db
      .select({
        id: filmInventory.id,
        filmStockId: filmInventory.filmStockId,
        format: filmInventory.format,
        form: filmInventory.form,
        quantity: filmInventory.quantity,
        remainingLengthFt: filmInventory.remainingLengthFt,
        originalLengthFt: filmInventory.originalLengthFt,
        expirationDate: filmInventory.expirationDate,
        storageLocation: filmInventory.storageLocation,
        manufacturer: filmStocks.manufacturer,
        stockName: filmStocks.name,
        iso: filmStocks.iso,
        filmType: filmStocks.type,
      })
      .from(filmInventory)
      .innerJoin(filmStocks, eq(filmInventory.filmStockId, filmStocks.id))
      .where(eq(filmInventory.userId, request.userId))
      .orderBy(filmStocks.manufacturer, filmStocks.name);

    // Expiring within 6 months
    const sixMonthsFromNow = new Date();
    sixMonthsFromNow.setMonth(sixMonthsFromNow.getMonth() + 6);
    const cutoff = sixMonthsFromNow.toISOString().split("T")[0];
    const expiringSoon = items.filter(
      (i) => i.expirationDate && i.expirationDate <= cutoff
    );

    return {
      data: {
        items,
        expiringSoon,
      },
    };
  });

  // Add inventory
  fastify.post("/", async (request, reply) => {
    const body = createFilmInventorySchema.parse(request.body);
    const { costPerRoll, remainingLengthFt, originalLengthFt, ...rest } = body;
    const [row] = await db
      .insert(filmInventory)
      .values({
        ...rest,
        userId: request.userId,
        quantity: rest.quantity ?? (rest.form === "bulk_roll" ? 0 : 1),
        ...(costPerRoll != null ? { costPerRoll: String(costPerRoll) } : {}),
        ...(remainingLengthFt != null ? { remainingLengthFt: String(remainingLengthFt) } : {}),
        ...(originalLengthFt != null ? { originalLengthFt: String(originalLengthFt) } : {}),
      })
      .returning();

    return reply.status(201).send({ data: row });
  });

  // Update inventory item
  fastify.patch<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const body = updateFilmInventorySchema.parse(request.body);
    const { costPerRoll, remainingLengthFt, ...rest } = body;
    const [row] = await db
      .update(filmInventory)
      .set({
        ...rest,
        updatedAt: new Date(),
        ...(costPerRoll != null ? { costPerRoll: String(costPerRoll) } : {}),
        ...(remainingLengthFt != null ? { remainingLengthFt: String(remainingLengthFt) } : {}),
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
