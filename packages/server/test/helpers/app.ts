import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { buildApp } from "../../src/app.js";
import { db, pool } from "../../src/db/client.js";
import { cameras, filmStocks, lenses, rolls, users } from "../../src/db/schema.js";

export interface Fixture {
  app: FastifyInstance;
  userId: string;
  token: string;
  auth: { authorization: string };
  cameraId: string;
  lensId: string;
  rollId: string;
}

/**
 * Wipes every table so each test starts from a known empty database. Discovered
 * from the catalog rather than hardcoded, so a new table never silently leaks
 * rows between tests.
 */
export async function resetDb(): Promise<void> {
  const { rows } = await pool.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public'",
  );
  if (rows.length === 0) return;
  const list = rows.map((r) => `"${r.tablename}"`).join(", ");
  await pool.query(`truncate table ${list} restart identity cascade`);
}

/**
 * A running app plus the minimum gear a field event can refer to: one user
 * (with a signed token), one camera, one lens, and one loaded roll.
 */
export async function makeFixture(): Promise<Fixture> {
  const app = await buildApp();
  await app.ready();

  const [user] = await db
    .insert(users)
    .values({ email: `test-${randomUUID()}@example.com`, passwordHash: "x", displayName: "Test" })
    .returning();

  const [camera] = await db
    .insert(cameras)
    .values({ userId: user.id, make: "Leica", model: "M6", format: "35mm", frameCount: 36 })
    .returning();

  const [lens] = await db
    .insert(lenses)
    .values({ userId: user.id, make: "Leica", model: "Summicron", focalLengthMm: 35 })
    .returning();

  const [stock] = await db
    .insert(filmStocks)
    .values({ userId: user.id, manufacturer: "Ilford", name: "HP5 Plus", iso: 400, type: "bw" })
    .returning();

  const [roll] = await db
    .insert(rolls)
    .values({
      userId: user.id,
      cameraId: camera.id,
      filmStockId: stock.id,
      format: "35mm",
      status: "loaded",
      frameCount: 36,
      loadedAt: new Date(),
    })
    .returning();

  const token = app.jwt.sign({ sub: user.id });

  return {
    app,
    userId: user.id,
    token,
    auth: { authorization: `Bearer ${token}` },
    cameraId: camera.id,
    lensId: lens.id,
    rollId: roll.id,
  };
}
