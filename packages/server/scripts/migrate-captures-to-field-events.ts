/**
 * One-shot: copy V1 `captures` into `field_events`. Idempotent (skips captures whose
 * id already appears as a field_events.client_id). A capture with a photo also
 * spawns a `photo` event carrying the file. Run with DATABASE_URL set.
 *
 *   npm run -w packages/server migrate:field-events            # copy
 *   npm run -w packages/server migrate:field-events -- --check # counts only
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { captures, fieldEvents } from "../src/db/schema.js";

const check = process.argv.includes("--check");

async function main() {
  const rows = await db.select().from(captures);
  const existing = new Set((await db.select({ c: fieldEvents.clientId }).from(fieldEvents)).map((r) => r.c));
  let voice = 0, photo = 0, skipped = 0;
  for (const c of rows) {
    if (existing.has(c.id)) { skipped++; continue; }
    if (check) { voice++; if (c.fileKey) photo++; continue; }
    await db.transaction(async (tx) => {
      const hasSettings = !!(c.shutterSpeed || c.aperture || c.compensation || c.meteringMode);
      await tx.insert(fieldEvents).values({
        clientId: c.id,
        userId: c.userId,
        kind: "voice",
        capturedAt: c.capturedAt,
        latitude: c.latitude,
        longitude: c.longitude,
        rollId: c.rollId,
        cameraId: c.cameraId,
        frameNumber: c.frameNumber,
        frameProvisional: false,
        transcript: [c.subject, c.notes].filter(Boolean).join("\n") || null,
        shutterSpeed: c.shutterSpeed,
        aperture: c.aperture,
        compensation: c.compensation,
        meteringMode: c.meteringMode,
        lensId: c.lensId,
        subject: c.subject,
        locationName: c.locationName,
        remarks: c.notes,
        sceneDescription: c.sceneDescription,
        parsedAt: hasSettings ? c.createdAt : null,
        parser: hasSettings ? "claude-app" : null,
        status: c.status === "assigned" ? "pinned" : "pending",
        frameId: c.frameId,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      });
      voice++;
      if (c.fileKey) {
        await tx.insert(fieldEvents).values({
          clientId: randomUUID(),
          userId: c.userId,
          kind: "photo",
          capturedAt: c.photoTakenAt ?? c.capturedAt,
          latitude: c.latitude,
          longitude: c.longitude,
          rollId: c.rollId,
          cameraId: c.cameraId,
          fileKey: c.fileKey,
          fileUrl: c.fileUrl,
          mimeType: c.mimeType,
          fileSizeBytes: c.fileSizeBytes,
          widthPx: c.widthPx,
          heightPx: c.heightPx,
          photoAssetId: c.photoAssetId,
          status: c.status === "assigned" ? "pinned" : "pending",
          frameId: c.frameId,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        });
        photo++;
      }
    });
  }
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(fieldEvents);
  console.log(`${check ? "would copy" : "copied"} ${voice} voice + ${photo} photo events (${skipped} already present); field_events now ${n} rows`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
