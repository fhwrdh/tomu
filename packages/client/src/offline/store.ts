/**
 * The write path. Everything the capture screen does goes through here, and
 * every one of these functions completes without a network round trip — the
 * point of the whole design is that a note is safe the moment it is spoken.
 */
import { nextFrameNumber, parseTranscript, type GearIndex, type ParsedFields } from "@tomu/shared";
import { db as defaultDb, type CameraState, type CaptureDb, type GearCache, type LocalEvent } from "./db.js";

export interface SaveCaptureInput {
  kind?: "voice" | "photo";
  transcript?: string;
  /** Photo bytes, held locally until the event itself has synced. */
  blob?: Blob;
  /** ISO. Defaults to now; photos pass their EXIF time. */
  capturedAt?: string;
  rollId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

/** What `deleteEvent` hands back so the undo toast can put it all back. */
export interface DeletedEvent {
  event: LocalEvent;
  blob?: Blob;
  /** Present when the server already had this event; the worker must delete it there too. */
  serverId?: string;
}

export async function saveGear(db: CaptureDb, gear: Omit<GearCache, "id" | "refreshedAt">): Promise<void> {
  await db.gear.put({ ...gear, id: "gear", refreshedAt: new Date().toISOString() });
}

export function getGear(db: CaptureDb): Promise<GearCache | undefined> {
  return db.gear.get("gear");
}

/**
 * The highest frame number noted on a roll, counting events that have not
 * synced yet — ten notes dictated on a ferry must still number themselves in
 * order, with no server involved.
 */
async function highestNoted(db: CaptureDb, rollId: string | null): Promise<number | null> {
  const gear = await getGear(db);
  const roll = rollId ? gear?.activeRolls.find((r) => r.id === rollId) : undefined;
  const local = rollId ? await db.events.where("rollId").equals(rollId).toArray() : [];
  const numbers = local.map((e) => e.frameNumber ?? 0);
  const fromRoll = roll?.framesShot ?? 0;
  return Math.max(fromRoll, ...numbers, 0) || null;
}

/** Parses the transcript with the cached gear, saves to IndexedDB, and queues for sync. */
export async function saveCapture(db: CaptureDb, input: SaveCaptureInput): Promise<LocalEvent> {
  const kind = input.kind ?? "voice";
  const gear = await getGear(db);
  const gearIndex: GearIndex | undefined = gear
    ? { cameras: gear.cameras, lenses: gear.lenses }
    : undefined;

  const parsed: { fields: ParsedFields } = kind === "voice" && input.transcript
    ? parseTranscript(input.transcript, gearIndex)
    : { fields: {} };

  const rollId = input.rollId ?? null;
  const frame = kind === "voice"
    ? nextFrameNumber({
        spoken: parsed.fields.frameNumber ?? null,
        highestNoted: await highestNoted(db, rollId),
        format: "35mm",
      })
    : { frameNumber: null, provisional: false };

  const event: LocalEvent = {
    ...parsed.fields,
    clientId: crypto.randomUUID(),
    kind,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    // Verbatim. Never trimmed, never cleaned — the ramble is the note.
    transcript: input.transcript,
    rollId,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    frameNumber: frame.frameNumber ?? undefined,
    frameProvisional: frame.frameNumber != null ? frame.provisional : undefined,
    editedFields: [],
    syncState: "queued",
    attempts: 0,
    hasPendingBlob: input.blob != null,
    mimeType: input.blob?.type || undefined,
  };

  await db.transaction("rw", db.events, db.blobs, async () => {
    await db.events.put(event);
    if (input.blob) await db.blobs.put({ clientId: event.clientId, blob: input.blob });
  });

  return event;
}

/**
 * Records a hand correction. The field joins `editedFields`, which the server
 * treats as untouchable, so neither a re-parse nor a later sync can undo it.
 */
export async function editField(
  db: CaptureDb,
  clientId: string,
  field: string,
  value: string | number | null,
): Promise<LocalEvent> {
  const event = await db.events.get(clientId);
  if (!event) throw new Error(`No local event ${clientId}`);

  const editedFields = event.editedFields.includes(field)
    ? event.editedFields
    : [...event.editedFields, field];

  const updated: LocalEvent = {
    ...event,
    [field]: value,
    editedFields,
    // A correction is new information for the server, so it goes back in the queue.
    syncState: "queued",
    attempts: 0,
    nextAttemptAt: undefined,
  };
  await db.events.put(updated);
  return updated;
}

/**
 * Marks the film in a camera as changed while offline. Notes captured for it
 * stay loose until the roll is unloaded and a new one loaded with signal.
 */
export async function markFilmChanged(db: CaptureDb, cameraId: string): Promise<void> {
  await db.cameraState.put({ cameraId, rollUnknownSince: new Date().toISOString() });
}

/** Clears the marker once the camera's roll is known again (loaded or unloaded). */
export async function clearFilmChanged(db: CaptureDb, cameraId: string): Promise<void> {
  await db.cameraState.put({ cameraId, rollUnknownSince: null });
}

export function filmChangedSince(state: CameraState | undefined): string | null {
  return state?.rollUnknownSince ?? null;
}

export async function listEvents(
  db: CaptureDb,
  opts: { day?: string } = {},
): Promise<LocalEvent[]> {
  const rows = await db.events.orderBy("capturedAt").reverse().toArray();
  if (!opts.day) return rows;
  return rows.filter((r) => r.capturedAt.slice(0, 10) === opts.day);
}

export async function deleteEvent(db: CaptureDb, clientId: string): Promise<DeletedEvent> {
  const event = await db.events.get(clientId);
  if (!event) throw new Error(`No local event ${clientId}`);
  const blob = (await db.blobs.get(clientId))?.blob;

  await db.transaction("rw", db.events, db.blobs, db.deletes, async () => {
    await db.events.delete(clientId);
    await db.blobs.delete(clientId);
    // Queue the server-side delete durably: the app may not be open again until
    // long after this note was scratched.
    if (event.serverId) {
      await db.deletes.put({ serverId: event.serverId, deletedAt: new Date().toISOString() });
    }
  });

  return { event, blob, serverId: event.serverId };
}

/** Puts back exactly what `deleteEvent` removed, for the undo toast. */
export async function undoDelete(db: CaptureDb, deleted: DeletedEvent): Promise<void> {
  await db.transaction("rw", db.events, db.blobs, db.deletes, async () => {
    await db.events.put(deleted.event);
    if (deleted.blob) await db.blobs.put({ clientId: deleted.event.clientId, blob: deleted.blob });
    // Undo beats the queue: if the delete has not gone out yet, it never should.
    if (deleted.serverId) await db.deletes.delete(deleted.serverId);
  });
}

export { defaultDb as db };
