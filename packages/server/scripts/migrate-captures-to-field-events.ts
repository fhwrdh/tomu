/**
 * One-shot: copy V1 `captures` into `field_events`. Idempotent (skips captures whose
 * id already appears as a field_events.client_id). A capture with a photo also
 * spawns a `photo` event carrying the file. Run with DATABASE_URL set.
 *
 * `captures` is read via raw SQL, not the Drizzle schema — the table (and its schema.ts
 * export) is retired once V1 is removed, but the table itself still exists in the
 * database until the subsequent `db:push` drops it, so `--check` still works right up
 * to that point.
 *
 *   npm run -w packages/server migrate:field-events            # copy
 *   npm run -w packages/server migrate:field-events -- --check # counts only
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { fieldEvents } from "../src/db/schema.js";

const check = process.argv.includes("--check");

interface CaptureRow {
  id: string;
  userId: string;
  status: string;
  rollId: string | null;
  cameraId: string | null;
  lensId: string | null;
  frameNumber: number | null;
  capturedAt: Date;
  shutterSpeed: string | null;
  aperture: string | null;
  compensation: string | null;
  meteringMode: string | null;
  subject: string | null;
  locationName: string | null;
  notes: string | null;
  sceneDescription: string | null;
  fileKey: string | null;
  fileUrl: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  widthPx: number | null;
  heightPx: number | null;
  photoTakenAt: Date | null;
  latitude: string | null;
  longitude: string | null;
  photoAssetId: string | null;
  frameId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

async function main() {
  let result;
  try {
    result = await db.execute<CaptureRow>(sql`
      select
        id, user_id as "userId", status, roll_id as "rollId", camera_id as "cameraId", lens_id as "lensId",
        frame_number as "frameNumber", captured_at as "capturedAt", shutter_speed as "shutterSpeed", aperture,
        compensation, metering_mode as "meteringMode", subject, location_name as "locationName", notes,
        scene_description as "sceneDescription", file_key as "fileKey", file_url as "fileUrl", mime_type as "mimeType",
        file_size_bytes as "fileSizeBytes", width_px as "widthPx", height_px as "heightPx",
        photo_taken_at as "photoTakenAt", latitude, longitude, photo_asset_id as "photoAssetId",
        frame_id as "frameId", created_at as "createdAt", updated_at as "updatedAt"
      from captures
    `);
  } catch (e) {
    if ((e as { code?: string }).code === "42P01") {
      console.log("captures table does not exist (already dropped); nothing to copy");
      process.exit(0);
    }
    throw e;
  }
  const rows = result.rows;
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
        // "claude-app" (not "regex") so the tier-2 sweep skips migrated rows; they were
        // already interpreted by Claude in the V1 flow.
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
