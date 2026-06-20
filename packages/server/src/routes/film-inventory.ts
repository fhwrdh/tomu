import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { createFilmInventorySchema, updateFilmInventorySchema } from "@tomu/shared";
import { db } from "../db/client.js";
import { filmInventory, filmStocks } from "../db/schema.js";

/** Generate the next R-prefixed inventory display ID for a user (R001, R002, ...). */
async function nextInventoryDisplayId(userId: string): Promise<string> {
  const rows = await db
    .select({ displayId: filmInventory.displayId })
    .from(filmInventory)
    .where(and(eq(filmInventory.userId, userId), isNotNull(filmInventory.displayId)));
  let max = 0;
  for (const r of rows) {
    const m = r.displayId?.match(/^R(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `R${String(max + 1).padStart(3, "0")}`;
}

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
        frameCount: filmInventory.frameCount,
        ratedIso: filmInventory.ratedIso,
        displayId: filmInventory.displayId,
        remainingLengthFt: filmInventory.remainingLengthFt,
        originalLengthFt: filmInventory.originalLengthFt,
        expirationDate: filmInventory.expirationDate,
        storageLocation: filmInventory.storageLocation,
        purchaseDate: filmInventory.purchaseDate,
        costPerRoll: filmInventory.costPerRoll,
        source: filmInventory.source,
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
        frameCount: filmInventory.frameCount,
        ratedIso: filmInventory.ratedIso,
        displayId: filmInventory.displayId,
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

  // Claim: give a specific physical item a stable display ID (Rxxx).
  // - If the source row has qty > 1, splits one copy off into a new qty=1 row and assigns the ID there.
  // - If the source row is already qty 1, assigns the ID in place.
  // - Errors if the source row is already claimed.
  // Bulk rolls cannot be claimed (they're continuous; their cassettes get claimed instead).
  fastify.post<{ Params: { id: string } }>("/:id/claim", async (request, reply) => {
    const [source] = await db
      .select()
      .from(filmInventory)
      .where(and(eq(filmInventory.id, request.params.id), eq(filmInventory.userId, request.userId)))
      .limit(1);
    if (!source) return reply.status(404).send({ error: "Inventory item not found" });

    if (source.form === "bulk_roll") {
      return reply.status(400).send({ error: "Bulk rolls cannot be claimed directly. Spool a cassette from the bulk first." });
    }
    if (source.displayId) {
      return reply.status(409).send({ error: `Already claimed as ${source.displayId}.` });
    }
    if (source.quantity < 1) {
      return reply.status(409).send({ error: "Nothing to claim — quantity is zero." });
    }

    const displayId = await nextInventoryDisplayId(request.userId);

    if (source.quantity === 1) {
      // Assign in place.
      const [row] = await db
        .update(filmInventory)
        .set({ displayId, updatedAt: new Date() })
        .where(eq(filmInventory.id, source.id))
        .returning();
      return reply.status(200).send({ data: row });
    }

    // Split: decrement source by 1, create a new qty=1 row carrying over stock + format + form + other attrs.
    await db
      .update(filmInventory)
      .set({ quantity: source.quantity - 1, updatedAt: new Date() })
      .where(eq(filmInventory.id, source.id));

    const [row] = await db
      .insert(filmInventory)
      .values({
        userId: request.userId,
        filmStockId: source.filmStockId,
        format: source.format,
        form: source.form,
        quantity: 1,
        frameCount: source.frameCount,
        ratedIso: source.ratedIso,
        displayId,
        expirationDate: source.expirationDate,
        storageLocation: source.storageLocation,
        purchaseDate: source.purchaseDate,
        costPerRoll: source.costPerRoll,
        notes: source.notes,
      })
      .returning();

    return reply.status(201).send({ data: row });
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
