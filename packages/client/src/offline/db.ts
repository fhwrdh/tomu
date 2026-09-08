/**
 * The field-capture offline store.
 *
 * Everything the capture screen writes lands here first and is read back from
 * here — the UI never reads the network. The sync worker drains this to the API
 * when there is signal. On a ferry, in a darkroom, on a rural road, the app is
 * fully functional and simply has a queue.
 */
import Dexie, { type EntityTable } from "dexie";
import type { GearIndex, ParsedFields } from "@tomu/shared";

/**
 * How far along a capture is. `queued` and `error` are local-only states;
 * `synced` means the server has the row; `parsed` and `needs_review` reflect
 * what tier 2 did with it afterwards (it runs after the create returns, so the
 * worker pulls these back rather than assuming them).
 */
export type SyncState = "queued" | "synced" | "parsed" | "needs_review" | "error";

export interface LocalEvent extends ParsedFields {
  /** Minted on the phone. The identity of this capture everywhere, and the server's idempotency key. */
  clientId: string;
  kind: "voice" | "photo";
  /** ISO. Phone clock at save, or the photo's EXIF time. */
  capturedAt: string;
  transcript?: string;
  rollId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  /** True when the frame number was inferred rather than spoken. */
  frameProvisional?: boolean;
  /** Fields the user corrected by hand; the server never re-parses these. */
  editedFields: string[];

  syncState: SyncState;
  /** Set once the server has accepted the event. */
  serverId?: string;
  /** Failed sync attempts, for backoff. Reset on success. */
  attempts: number;
  /** Epoch ms; the worker skips this item until now passes it. */
  nextAttemptAt?: number;
  /** Last sync failure, shown on the card. */
  error?: string;
  /** True when a photo blob is waiting to be uploaded for this event. */
  hasPendingBlob?: boolean;
  /** The photo's type, kept here because a Blob's own `type` can be lost in storage. */
  mimeType?: string;
  /** Where the server serves the photo once uploaded; the local blob is dropped then. */
  fileUrl?: string | null;
  /** Tier-2 output, pulled back after parsing. */
  subject?: string | null;
  locationName?: string | null;
  remarks?: string | null;
  /** Why the model asked for a look. */
  parseNotes?: string | null;
}

export interface LocalBlob {
  clientId: string;
  blob: Blob;
}

/**
 * An event deleted locally that the server still has. Kept as its own row so a
 * "scratch that" made in a dead zone still reaches the server after the app is
 * closed and reopened.
 */
export interface PendingDelete {
  serverId: string;
  deletedAt: string;
}

/**
 * What the phone knows about a camera that the server cannot: that the film in
 * it was changed while offline. Until the change is reconciled, notes for that
 * camera save loose rather than being attached to a roll that is no longer in
 * the body — a wrong roll is worse than no roll.
 */
export interface CameraState {
  cameraId: string;
  /** ISO time the film was changed offline, or null once reconciled. */
  rollUnknownSince: string | null;
}

/** One row, id `"gear"` — the cameras, lenses and active rolls the parser and header need offline. */
export interface GearCache extends GearIndex {
  id: "gear";
  activeRolls: Array<{
    id: string;
    cameraId: string | null;
    /** Which camera it is in — the thing that says whether this is the right roll. */
    cameraLabel: string | null;
    label: string;
    framesShot: number;
    frameCount: number;
  }>;
  refreshedAt: string;
}

export class CaptureDb extends Dexie {
  events!: EntityTable<LocalEvent, "clientId">;
  blobs!: EntityTable<LocalBlob, "clientId">;
  gear!: EntityTable<GearCache, "id">;
  deletes!: EntityTable<PendingDelete, "serverId">;
  cameraState!: EntityTable<CameraState, "cameraId">;

  constructor(name = "tomu-capture") {
    super(name);
    this.version(1).stores({
      // Indexed: primary key, then the fields the UI and worker query on.
      events: "clientId, capturedAt, syncState, rollId",
      blobs: "clientId",
      gear: "id",
      deletes: "serverId",
    });
    this.version(2).stores({ cameraState: "cameraId" });
  }
}

export const db = new CaptureDb();
