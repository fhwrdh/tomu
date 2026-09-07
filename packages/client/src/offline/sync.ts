/**
 * The sync worker: drains the local queue to the API and pulls parse results
 * back. Runs in the page (iOS has no Background Sync), so it only makes
 * progress while the app is open — which is why nothing here is required for
 * capture to work, and why every failure is recoverable on the next pass.
 */
import type { CaptureDb, GearCache, LocalEvent, SyncState } from "./db.js";
import { PARSED_FIELD_NAMES } from "@tomu/shared";

/** The server row shape this worker cares about. */
export interface RemoteEvent {
  id: string;
  clientId: string;
  parser: string | null;
  review: boolean;
  parseNotes?: string | null;
  [field: string]: unknown;
}

/** The network, injected so the worker can be tested without one. */
export interface SyncApi {
  createEvent(body: Record<string, unknown>): Promise<RemoteEvent>;
  uploadPhoto(serverId: string, blob: Blob, mimeType: string): Promise<unknown>;
  fetchEvents(clientIds: string[]): Promise<RemoteEvent[]>;
  deleteEvent(serverId: string): Promise<void>;
  fetchGear(): Promise<Omit<GearCache, "id" | "refreshedAt">>;
}

export interface SyncResult {
  pushed: number;
  failed: number;
  photos: number;
  pulled: number;
  deleted: number;
}

/** Tier-2 fields the server may fill in that the phone never parses itself. */
const TIER2_ONLY_FIELDS = ["subject", "locationName", "remarks"] as const;

const BASE_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 10 * 60_000;

function backoffFor(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** (attempts - 1), MAX_BACKOFF_MS);
}

/** A 4xx means the event itself is wrong; retrying an unchanged body cannot fix it. */
function isPermanent(err: unknown): boolean {
  const status = (err as { status?: number }).status;
  return status != null && status >= 400 && status < 500;
}

/** The body the API expects. `parser: "regex"` records that tier 1 produced these. */
function toCreateBody(e: LocalEvent): Record<string, unknown> {
  const body: Record<string, unknown> = {
    clientId: e.clientId,
    kind: e.kind,
    capturedAt: e.capturedAt,
    transcript: e.transcript,
    rollId: e.rollId,
    cameraId: e.cameraId,
    latitude: e.latitude,
    longitude: e.longitude,
    frameNumber: e.frameNumber,
    sheetId: e.sheetId,
    editedFields: e.editedFields,
  };
  for (const f of PARSED_FIELD_NAMES) {
    if (e[f as keyof LocalEvent] != null) body[f] = e[f as keyof LocalEvent];
  }
  if (e.kind === "voice") body.parser = "regex";
  for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
  return body;
}

/**
 * Merges a server row into the local one. The phone owns the transcript and any
 * field the user corrected; everything else the server may fill.
 */
function applyRemote(local: LocalEvent, remote: RemoteEvent): LocalEvent {
  const merged: LocalEvent = { ...local, serverId: remote.id };
  const edited = new Set(local.editedFields);

  for (const field of [...PARSED_FIELD_NAMES, ...TIER2_ONLY_FIELDS] as string[]) {
    if (edited.has(field)) continue;
    const value = remote[field];
    if (value !== undefined) (merged as unknown as Record<string, unknown>)[field] = value;
  }
  // The transcript is the source of truth and is never round-tripped back.
  merged.transcript = local.transcript;
  merged.parseNotes = remote.parseNotes ?? null;

  const parsedByModel = remote.parser?.startsWith("claude:") ?? false;
  const state: SyncState = remote.review ? "needs_review" : parsedByModel ? "parsed" : "synced";
  merged.syncState = state;
  merged.attempts = 0;
  merged.nextAttemptAt = undefined;
  merged.error = undefined;
  return merged;
}

async function recordFailure(db: CaptureDb, e: LocalEvent, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const attempts = e.attempts + 1;
  await db.events.update(e.clientId, {
    // Permanent failures stop consuming retries and surface on the card instead.
    syncState: isPermanent(err) ? "error" : "queued",
    attempts,
    nextAttemptAt: Date.now() + backoffFor(attempts),
    error: message,
  });
}

/**
 * One pass: push queued events, upload any photo whose event now exists,
 * propagate deletes, pull parse results, refresh the gear cache. Each item is
 * independent — a failure marks that item and the pass continues.
 */
export async function syncOnce(db: CaptureDb, api: SyncApi): Promise<SyncResult> {
  const result: SyncResult = { pushed: 0, failed: 0, photos: 0, pulled: 0, deleted: 0 };
  const now = Date.now();

  for (const pending of await db.deletes.toArray()) {
    try {
      await api.deleteEvent(pending.serverId);
      await db.deletes.delete(pending.serverId);
      result.deleted++;
    } catch (err) {
      // A 404 means someone else already removed it — done either way. Anything
      // else stays queued; a stale row on the server beats a stuck queue.
      if ((err as { status?: number }).status === 404) {
        await db.deletes.delete(pending.serverId);
      }
    }
  }

  const queued = (await db.events.where("syncState").equals("queued").toArray()).filter(
    (e) => (e.nextAttemptAt ?? 0) <= now,
  );

  for (const event of queued) {
    try {
      const remote = await api.createEvent(toCreateBody(event));
      const current = (await db.events.get(event.clientId)) ?? event;
      await db.events.put({
        ...current,
        serverId: remote.id,
        syncState: "synced",
        attempts: 0,
        nextAttemptAt: undefined,
        error: undefined,
      });
      result.pushed++;
    } catch (err) {
      await recordFailure(db, event, err);
      result.failed++;
    }
  }

  // Photos go up only once their event exists server-side.
  const withBlobs = await db.events.filter((e) => e.hasPendingBlob === true && !!e.serverId).toArray();
  for (const event of withBlobs) {
    const stored = await db.blobs.get(event.clientId);
    if (!stored) {
      await db.events.update(event.clientId, { hasPendingBlob: false });
      continue;
    }
    try {
      await api.uploadPhoto(event.serverId!, stored.blob, event.mimeType ?? stored.blob.type ?? "image/jpeg");
      await db.transaction("rw", db.events, db.blobs, async () => {
        await db.events.update(event.clientId, { hasPendingBlob: false });
        await db.blobs.delete(event.clientId);
      });
      result.photos++;
    } catch {
      // Keep the blob and try again next pass; the event itself is safe.
    }
  }

  // Pull tier-2 results for everything the server has but the model may not have
  // finished with. Tier 2 runs after the create returns, so this is a poll.
  const awaitingParse = await db.events
    .filter((e) => !!e.serverId && (e.syncState === "synced" || e.syncState === "queued"))
    .toArray();
  if (awaitingParse.length > 0) {
    try {
      const remotes = await api.fetchEvents(awaitingParse.map((e) => e.clientId));
      for (const remote of remotes) {
        const local = await db.events.get(remote.clientId);
        // Skip anything edited since the fetch — the phone's copy is newer.
        if (!local || local.syncState === "queued") continue;
        await db.events.put(applyRemote(local, remote));
        result.pulled++;
      }
    } catch {
      // Nothing to record: the local rows are unchanged and still correct.
    }
  }

  try {
    const gear = await api.fetchGear();
    await db.gear.put({ ...gear, id: "gear", refreshedAt: new Date().toISOString() });
  } catch {
    // Keep the cache we have; a stale gear list still parses.
  }

  return result;
}
