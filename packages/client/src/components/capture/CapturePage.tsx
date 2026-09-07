import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState } from "react";
import { Check, Disc, RefreshCw } from "lucide-react";
import { parseTranscript } from "@tomu/shared";
import { Button } from "../ui/button.js";
import { cn } from "../../lib/utils.js";
import { db } from "../../offline/db.js";
import { editField, listEvents, saveCapture } from "../../offline/store.js";
import { useSyncWorker } from "../../hooks/useSyncWorker.js";
import { chipsFor, FieldChips, storeField, type Chip } from "./FieldChips.js";

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
  const [rollId, setRollId] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const { syncNow, syncing } = useSyncWorker();

  const gear = useLiveQuery(() => db.gear.get("gear"), []);
  const today = useLiveQuery(() => listEvents(db, { day: new Date().toISOString().slice(0, 10) }), []);
  const activeRolls = gear?.activeRolls ?? [];
  const roll = activeRolls.find((r) => r.id === rollId) ?? activeRolls[0];

  useEffect(() => {
    if (rollId == null && activeRolls.length > 0) setRollId(activeRolls[0].id);
  }, [activeRolls, rollId]);

  // Live tier-1 parse of what is being dictated right now. Pure and synchronous,
  // so the chips move with the words instead of after them.
  const draft = text.trim()
    ? parseTranscript(text, gear ? { cameras: gear.cameras, lenses: gear.lenses } : undefined).fields
    : {};
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

  async function clearChip(chip: Chip) {
    // Only a saved event has fields to correct; a draft chip clears by editing
    // the words, which is what the transcript is for.
    if (!justSaved) return;
    await editField(db, justSaved, storeField(chip.key), null);
  }

  const savedEvent = today?.find((e) => e.clientId === justSaved);
  const savedChips = savedEvent ? chipsFor(savedEvent, gear) : [];

  return (
    <div className="space-y-4">
      {/* Header: what this note will attach to. */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <Disc className="h-4 w-4 shrink-0 text-muted-foreground" />
          {roll ? (
            <select
              value={roll.id}
              onChange={(e) => setRollId(e.target.value)}
              aria-label="Active roll"
              className="min-w-0 truncate bg-transparent font-medium text-foreground outline-none"
            >
              {activeRolls.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label} · {r.framesShot}/{r.frameCount}
                </option>
              ))}
            </select>
          ) : (
            // Never a blocker: a loose note is still a note.
            <span className="text-muted-foreground">No active roll — notes save loose</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void syncNow()}
          aria-label="Sync now"
          className="text-muted-foreground hover:text-foreground"
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

      <Button className="h-12 w-full text-base" onClick={() => void save()} disabled={!text.trim()}>
        Done
      </Button>

      {savedEvent && (
        <div className="rounded-md border border-border bg-card p-3" data-testid="last-saved">
          <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Check className="h-3.5 w-3.5 text-success" />
            Saved{savedEvent.syncState === "queued" ? " · waiting for signal" : ""}
          </div>
          <p className="mb-2 whitespace-pre-wrap text-sm text-foreground">{savedEvent.transcript}</p>
          <FieldChips chips={savedChips} editedFields={savedEvent.editedFields} onClear={clearChip} />
        </div>
      )}
    </div>
  );
}
