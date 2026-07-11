/**
 * One-time seed of the developing-tank fleet (owner-confirmed 2026-07-11,
 * "fine for now — fine-tune later"). Idempotent: refuses to run if the user
 * already has tanks; edit via PATCH /tanks or tomu_tanks after that.
 *
 * Run: npx tsx scripts/seed-tanks.ts
 */
import { desc, eq, sql } from "drizzle-orm";
import { db, pool } from "../src/db/client.js";
import { rolls, tanks, users } from "../src/db/schema.js";

const FLEET = [
  {
    name: "Paterson 3-reel",
    kind: "roll",
    volumeMl: 1000,
    reelUnits: "3.0",
    quantity: 1,
    agitation: "inversion",
    notes: "Super System 4. 3×35mm, 2×120, or 1×120 + 1×35mm.",
  },
  {
    name: "Paterson 2-reel",
    kind: "roll",
    volumeMl: 500,
    reelUnits: "2.0",
    quantity: 4,
    agitation: "inversion",
    notes: "Super System 4. 2×35mm or 1×120 (120 = 1.5 units, no room to mix).",
  },
  {
    name: "Paterson 1-reel",
    kind: "roll",
    volumeMl: 290,
    reelUnits: "1.0",
    quantity: 1,
    agitation: "inversion",
    notes: "Single 35mm only — a 120 reel (1.5 units) does not fit.",
  },
  {
    name: "Jobo 1520",
    kind: "roll",
    volumeMl: 500,
    reelUnits: "2.0",
    quantity: 1,
    agitation: "inversion",
    notes: "Inversion use. Standing Rodinal convention: 10 ml / 500 ml.",
  },
  {
    name: "Stearman SP-445",
    kind: "sheet",
    volumeMl: 475,
    sheetCapacity: 4,
    quantity: 1,
    agitation: "inversion",
    notes: "4x5 only.",
  },
  {
    name: "MOD54 (Paterson Universal)",
    kind: "sheet",
    volumeMl: 1000,
    sheetCapacity: 6,
    quantity: 1,
    agitation: "inversion",
    notes: "4x5 only, in the Paterson 3-reel universal body.",
  },
] as const;

// The user who actually owns the data (there's a stale second account in dev).
const [user] = await db
  .select({ id: rolls.userId, n: sql<number>`count(*)` })
  .from(rolls)
  .groupBy(rolls.userId)
  .orderBy(desc(sql`count(*)`))
  .limit(1);
if (!user) {
  console.error("no user with rolls found");
  process.exit(1);
}

const existing = await db.select({ id: tanks.id }).from(tanks).where(eq(tanks.userId, user.id));
if (existing.length) {
  console.error(`user already has ${existing.length} tanks — edit via API, not reseed`);
  process.exit(1);
}

for (const t of FLEET) {
  await db.insert(tanks).values({ userId: user.id, ...t });
  console.log(`seeded: ${t.name} ×${t.quantity}`);
}

await pool.end();
