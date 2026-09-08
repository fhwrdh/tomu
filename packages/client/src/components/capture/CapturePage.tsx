import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState } from "react";
import { Camera, RefreshCw, Undo2 } from "lucide-react";
import { parseTranscript } from "@tomu/shared";
import { Button } from "../ui/button.js";
import { cn } from "../../lib/utils.js";
import { db } from "../../offline/db.js";
import {
  clearFilmChanged, deleteEvent, editField, listEvents, markFilmChanged, saveCapture, undoDelete,
  type DeletedEvent,
} from "../../offline/store.js";
import { useSyncWorker } from "../../hooks/useSyncWorker.js";
import { useOnline } from "../../hooks/useOnline.js";
import { LoadRollDialog, UnloadDialog } from "../rolls/RollDialogs.js";
import { CaptureHeader } from "./CaptureHeader.js";
import { chipsFor, FieldChips, storeField, type Chip } from "./FieldChips.js";
import { EventStream } from "./EventStream.js";
import type { LocalEvent } from "../../offline/db.js";

/** The camera stays put between visits — you carry the same body all day. */
const CAMERA_KEY = "tomu_capture_camera";

/** Best-effort location. Never blocks a save, never prompts twice in a row. */
function currentPosition(): Promise<{ latitude: number; longitude: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: 3000, maximumAge: 120_000 },
    );
  });
}

export function CapturePage() {
  const [text, setText] = useState("");
  const [cameraId, setCameraId] = useState<string | null>(
    () => (typeof localStorage === "undefined" ? null : localStorage.getItem(CAMERA_KEY)),
  );
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const [loadOpen, setLoadOpen] = useState(false);
  const [unloadOpen, setUnloadOpen] = useState(false);
  const [undoable, setUndoable] = useState<DeletedEvent | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const photoInput = useRef<HTMLInputElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const { syncNow, syncing } = useSyncWorker();
  const online = useOnline();

  const gear = useLiveQuery(() => db.gear.get("gear"), []);
  const today = useLiveQuery(() => listEvents(db, { day: new Date().toISOString().slice(0, 10) }), []);
  const cameraState = useLiveQuery(
    async () => (cameraId ? await db.cameraState.get(cameraId) : undefined),
    [cameraId],
  );

  const cameras = gear?.cameras ?? [];
  useEffect(() => {
    // Fall back to the first cached camera, but never overwrite a real choice.
    if (cameraId == null && cameras.length > 0) selectCamera(cameras[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameras, cameraId]);

  function selectCamera(id: string) {
    setCameraId(id);
    try { localStorage.setItem(CAMERA_KEY, id); } catch { /* private mode; the choice just will not stick */ }
  }

  const pendingBlobs = useLiveQuery(async () => await db.blobs.toArray(), []);
  useEffect(() => {
    if (!pendingBlobs) return;
    const urls: Record<string, string> = {};
    for (const row of pendingBlobs) {
      // A preview is a nicety; never let a value storage handed back that is not
      // a usable Blob take the screen down with it.
      if (!(row.blob instanceof Blob)) continue;
      try {
        urls[row.clientId] = URL.createObjectURL(row.blob);
      } catch { /* no preview for this one */ }
    }
    setPreviews(urls);
    // Object URLs leak until revoked, and a day of photos is a lot of them.
    return () => Object.values(urls).forEach((u) => URL.revokeObjectURL(u));
  }, [pendingBlobs]);

  const filmChanged = cameraState?.rollUnknownSince != null;
  const cameraRoll = gear?.activeRolls.find((r) => r.cameraId === cameraId);
  // A roll Tomu cannot vouch for is worse than no roll: after an offline film
  // change, notes save loose until the swap is reconciled with signal.
  const roll = filmChanged ? undefined : cameraRoll;

  // Live tier-1 parse of what is being dictated right now. Pure and synchronous,
  // so the chips move with the words instead of after them.
  const draft = text.trim()
    ? parseTranscript(text, gear ? { cameras: gear.cameras, lenses: gear.lenses } : undefined).fields
    : {};

  // Saying "on the M6" moves the header there — the right thing happening
  // because it was said out loud, rather than needing a second gesture.
  useEffect(() => {
    if (draft.cameraId && draft.cameraId !== cameraId) selectCamera(draft.cameraId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.cameraId]);
  const chips: Chip[] = chipsFor(draft, gear);

  async function save() {
    const transcript = text;
    if (!transcript.trim()) return;
    // Clear immediately: the note is safe once saveCapture resolves, and the
    // field must be ready for the next thing said.
    setText("");
    const position = await currentPosition();
    const event = await saveCapture(db, {
      transcript,
      rollId: roll?.id ?? null,
      latitude: position?.latitude ?? null,
      longitude: position?.longitude ?? null,
    });
    setJustSaved(event.clientId);
    void syncNow();
  }

  /**
   * A photo is its own event, not a field on a note: one reference shot often
   * covers several frames, and the two are taken seconds apart at best.
   */
  async function takePhoto(file: File) {
    const position = await currentPosition();
    await saveCapture(db, {
      kind: "photo",
      blob: file,
      // EXIF time would be better, but a file picked from the camera is "now"
      // to within seconds, and a wrong-but-confident time is worse than none.
      capturedAt: new Date(file.lastModified || Date.now()).toISOString(),
      rollId: roll?.id ?? null,
      latitude: position?.latitude ?? null,
      longitude: position?.longitude ?? null,
    });
    void syncNow();
  }

  async function clearChip(event: LocalEvent, chip: Chip) {
    await editField(db, event.clientId, storeField(chip.key), null);
  }

  async function removeEvent(event: LocalEvent) {
    setUndoable(await deleteEvent(db, event.clientId));
    void syncNow();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <CaptureHeader
            gear={gear}
            cameraId={cameraId}
            onCameraChange={selectCamera}
            cameraState={cameraState}
            online={online}
            onLoad={() => setLoadOpen(true)}
            onUnload={() => setUnloadOpen(true)}
            onFilmChanged={() => cameraId && void markFilmChanged(db, cameraId)}
          />
        </div>
        <button
          type="button"
          onClick={() => void syncNow()}
          aria-label="Sync now"
          className="mt-3 text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
        </button>
      </div>

      <textarea
        ref={textarea}
        value={text}
        onChange={(e) => setText(e.target.value)}
        // Saving on blur too: a half-typed note that loses focus must not vanish.
        onBlur={() => void save()}
        rows={4}
        placeholder="Tap, then talk. Frame, shutter, aperture — and whatever else the moment was."
        aria-label="Field note"
        className="w-full resize-none rounded-md border border-border bg-card p-3 text-base text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
      />

      <FieldChips chips={chips} />

      <div className="flex gap-2">
        <Button className="h-12 flex-1 text-base" onClick={() => void save()} disabled={!text.trim()}>
          Done
        </Button>
        <Button
          variant="outline"
          className="h-12 w-14"
          aria-label="Take a photo"
          onClick={() => photoInput.current?.click()}
        >
          <Camera className="h-5 w-5" />
        </Button>
        <input
          ref={photoInput}
          type="file"
          accept="image/*"
          // Opens the camera directly on a phone, the library on a desktop.
          capture="environment"
          className="hidden"
          data-testid="photo-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void takePhoto(file);
          }}
        />
      </div>

      {undoable && (
        <div className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm">
          <span className="text-muted-foreground">Note deleted</span>
          <button
            type="button"
            className="flex items-center gap-1.5 text-primary"
            onClick={async () => {
              await undoDelete(db, undoable);
              setUndoable(null);
            }}
          >
            <Undo2 className="h-3.5 w-3.5" /> Undo
          </button>
        </div>
      )}

      <EventStream
        events={today ?? []}
        gear={gear}
        previews={previews}
        onClear={clearChip}
        onDelete={removeEvent}
        syncing={syncing}
      />

      {loadOpen && (
        <LoadRollDialog
          open
          cameraId={cameraId ?? undefined}
          onClose={() => {
            setLoadOpen(false);
            // The camera's roll is known again, and the gear cache needs the new one.
            if (cameraId) void clearFilmChanged(db, cameraId);
            void syncNow();
          }}
        />
      )}
      {unloadOpen && cameraRoll && (
        <UnloadDialog
          open
          rollId={cameraRoll.id}
          onClose={() => {
            setUnloadOpen(false);
            if (cameraId) void clearFilmChanged(db, cameraId);
            void syncNow();
          }}
        />
      )}
    </div>
  );
}
