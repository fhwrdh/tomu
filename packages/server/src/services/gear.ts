import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { cameras, lenses } from "../db/schema.js";

export interface GearIndex {
  cameras: { id: string; label: string }[];
  lenses: { id: string; label: string }[];
}

/** This user's cameras and lenses, as `{id, label}` pairs for parsing/prompt context and UI. */
export async function loadGear(userId: string): Promise<GearIndex> {
  const [cams, lens] = await Promise.all([
    db.select({ id: cameras.id, make: cameras.make, model: cameras.model }).from(cameras).where(eq(cameras.userId, userId)),
    db.select({ id: lenses.id, make: lenses.make, model: lenses.model, focalLengthMm: lenses.focalLengthMm }).from(lenses).where(eq(lenses.userId, userId)),
  ]);
  return {
    cameras: cams.map((c) => ({ id: c.id, label: `${c.make} ${c.model}` })),
    lenses: lens.map((l) => ({ id: l.id, label: `${l.make} ${l.model}${l.focalLengthMm != null ? ` ${l.focalLengthMm}mm` : ""}` })),
  };
}
