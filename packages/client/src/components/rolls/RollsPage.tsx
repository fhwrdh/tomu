import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Disc, Camera as CameraIcon, StickyNote, Square, ChevronRight, Undo2 } from "lucide-react";
import { FILM_FORMATS, FILM_FORMAT_LABELS } from "@tomu/shared";
import type { CreateRoll, CreateFrame, CreateNote } from "@tomu/shared";
import { cameras, fieldEvents, filmStocks, rolls, type RollListItem, type RollDetail } from "../../services/api.js";
import { cn } from "../../lib/utils.js";
import { Button } from "../ui/button.js";
import { Badge } from "../ui/badge.js";
import { Input } from "../ui/input.js";
import { Select } from "../ui/select.js";
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "../ui/dialog.js";
import { Field, LoadRollDialog, UnloadDialog, localDate } from "./RollDialogs.js";

const STATUS_FILTERS = [
  { value: "active", label: "Active" },
  { value: "unloaded", label: "Unloaded" },
  { value: "all", label: "All" },
];

export function RollsPage() {
  const [status, setStatus] = useState("active");
  const [format, setFormat] = useState<string>("all");
  const [loadOpen, setLoadOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ["rolls", status],
    queryFn: () => rolls.list(status),
  });

  const all = listQuery.data?.data ?? [];
  // Only offer formats actually present, and only when there is more than one:
  // a filter row that cannot change anything is just noise.
  const formats = FILM_FORMATS.filter((f) => all.some((r) => r.format === f));
  const items = format === "all" ? all : all.filter((r) => r.format === format);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Rolls</h2>
        <Button size="sm" onClick={() => setLoadOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> Load Roll
        </Button>
      </div>

      {/* Status filter */}
      <div className="flex gap-1.5">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setStatus(f.value)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              status === f.value
                ? "bg-primary text-primary-foreground"
                : "bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Format filter — a dozen 4x5 sheets should not bury the roll in the camera. */}
      {formats.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {["all", ...formats].map((f) => (
            <button
              key={f}
              onClick={() => setFormat(f)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                format === f
                  ? "bg-secondary text-foreground"
                  : "bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {f === "all" ? "All formats" : f}
            </button>
          ))}
        </div>
      )}

      {/* Roll list */}
      {items.length === 0 && !listQuery.isLoading && (
        <div className="rounded-md border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          {status === "active" ? "No active rolls. Load one to start shooting." : "No rolls found."}
        </div>
      )}

      <div className="space-y-2">
        {items.map((r) => (
          <RollCard
            key={r.id}
            roll={r}
            expanded={expandedId === r.id}
            onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)}
          />
        ))}
      </div>

      <LoadRollDialog open={loadOpen} onClose={() => setLoadOpen(false)} />
    </div>
  );
}

// ── Roll card ────────────────────────────────────────────────────────

function RollCard({
  roll,
  expanded,
  onToggle,
}: {
  roll: RollListItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  const isActive = roll.status === "loaded" || roll.status === "shooting";
  const cam = roll.cameraMake ? `${roll.cameraMake} ${roll.cameraModel}` : "no camera";

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-card/80"
      >
        <Disc className={`h-5 w-5 ${isActive ? "text-success" : "text-muted-foreground"}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm truncate">
              {roll.displayId ?? `${roll.manufacturer} ${roll.stockName}`}
            </span>
            {roll.displayId && (
              <span className="truncate text-xs text-muted-foreground">
                {roll.manufacturer} {roll.stockName}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Badge variant="secondary">{FILM_FORMAT_LABELS[roll.format as keyof typeof FILM_FORMAT_LABELS] ?? roll.format}</Badge>
            <span>·</span>
            <span>
              {roll.ratedIso != null && roll.ratedIso !== roll.iso
                ? <>box {roll.iso} · <span className="text-warning font-medium">rated {roll.ratedIso}</span></>
                : `ISO ${roll.iso}`}
            </span>
            <span>·</span>
            <span className="truncate">{cam}</span>
            <span>·</span>
            <span>{roll.framesShot}/{roll.frameCount}</span>
          </div>
        </div>
        <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} />
      </button>

      {expanded && <RollDetailView rollId={roll.id} active={isActive} />}
    </div>
  );
}

// ── Detail (frames + notes timeline + action buttons) ───────────────

function RollDetailView({ rollId, active }: { rollId: string; active: boolean }) {
  const [frameOpen, setFrameOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [unloadOpen, setUnloadOpen] = useState(false);
  const [undoOpen, setUndoOpen] = useState(false);

  const detailQuery = useQuery({
    queryKey: ["rolls", rollId, "detail"],
    queryFn: () => rolls.get(rollId),
  });

  const detail = detailQuery.data?.data;
  if (!detail) {
    return <div className="border-t border-border px-3 py-3 text-xs text-muted-foreground">Loading…</div>;
  }

  // Merge frames and notes into a single timeline, ordered by time
  const timeline = buildTimeline(detail);

  return (
    <div className="border-t border-border px-3 py-3 space-y-3">
      {active && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setFrameOpen(true)}>
            <Square className="h-3.5 w-3.5" /> Add Frame
          </Button>
          <Button size="sm" variant="outline" onClick={() => setNoteOpen(true)}>
            <StickyNote className="h-3.5 w-3.5" /> Add Note
          </Button>
          <Button size="sm" onClick={() => setUnloadOpen(true)}>
            Unload
          </Button>
          <Button size="sm" variant="outline" onClick={() => setUndoOpen(true)}>
            <Undo2 className="h-3.5 w-3.5" /> Undo Load
          </Button>
        </div>
      )}

      {timeline.length === 0 ? (
        // A field note is not a frame until it is pinned, so a roll can honestly
        // have zero frames while notes wait below. Saying only "nothing here"
        // above a list of three notes reads as a bug rather than a state.
        <div className="text-xs text-muted-foreground">
          {detail.unpinnedEvents.length > 0
            ? `No frames yet — ${detail.unpinnedEvents.length} field ${detail.unpinnedEvents.length === 1 ? "note" : "notes"} below, waiting to be pinned.`
            : "No frames or notes yet."}
        </div>
      ) : (
        <ul className="space-y-1.5 text-xs">
          {timeline.map((entry) => (
            <li key={entry.key} className="flex gap-2">
              <span className="w-14 shrink-0 text-muted-foreground tabular-nums">{entry.time}</span>
              <div className="flex-1">
                {entry.kind === "frame" ? (
                  <div>
                    <span className="font-medium">Frame {entry.frameNumber}</span>
                    {entry.settings && <span className="ml-1 text-muted-foreground">{entry.settings}</span>}
                    {entry.subject && <div className="text-foreground">{entry.subject}</div>}
                    {entry.notes && <div className="text-muted-foreground italic">{entry.notes}</div>}
                  </div>
                ) : (
                  <div>
                    {entry.frameNumber != null && (
                      <span className="mr-1 text-muted-foreground">[frame {entry.frameNumber}]</span>
                    )}
                    <span className="italic text-foreground">"{entry.content}"</span>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {detail.unpinnedEvents.length > 0 && (
        <div className="space-y-2">
          <div className="space-y-0.5">
            <div className="text-xs font-medium text-foreground">
              Field notes ({detail.unpinnedEvents.length}) · not yet pinned
            </div>
            <div className="text-[11px] text-muted-foreground">
              Pinning turns a note into a frame with its settings. Ask Claude to “pin my field
              notes to frames”, or use <code>tomu_pin_event</code>.
            </div>
          </div>
          <ul className="space-y-2 text-xs">
            {/* A roll can sit in a camera for weeks, so a bare time says nothing.
                The day is stated once per group rather than on every note. */}
            {groupByDay(detail.unpinnedEvents).map((group) => (
              <li key={group.day} className="space-y-2">
                <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {group.heading}
                </div>
                <ul className="space-y-2">
                  {group.events.map((e) => (
                    <FieldNoteRow key={e.id} event={e} rollId={rollId} />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}

      <AddFrameDialog open={frameOpen} onClose={() => setFrameOpen(false)} rollId={rollId} nextFrameNumber={detail.frames.length + 1} />
      <AddNoteDialog open={noteOpen} onClose={() => setNoteOpen(false)} rollId={rollId} />
      <UnloadDialog open={unloadOpen} onClose={() => setUnloadOpen(false)} rollId={rollId} />
      <UndoLoadDialog
        open={undoOpen}
        onClose={() => setUndoOpen(false)}
        rollId={rollId}
        framesLogged={detail.frames.length}
      />
    </div>
  );
}

// Timeline entry shape
type TimelineEntry =
  | { key: string; kind: "frame"; time: string; frameNumber: number; settings: string; subject: string | null; notes: string | null; at: number }
  | { key: string; kind: "note"; time: string; content: string; frameNumber: number | null; at: number };

function buildTimeline(detail: RollDetail): TimelineEntry[] {
  const frameNumberById = new Map(detail.frames.map((f) => [f.id, f.frameNumber]));

  const entries: TimelineEntry[] = [];

  for (const f of detail.frames) {
    const settings = [f.shutterSpeed, f.aperture].filter(Boolean).join(" ");
    const ts = f.shotAt ?? f.createdAt;
    entries.push({
      key: `f-${f.id}`,
      kind: "frame",
      time: formatTime(ts),
      at: new Date(ts).getTime(),
      frameNumber: f.frameNumber,
      settings,
      subject: f.subject ?? null,
      notes: f.notes ?? null,
    });
  }
  for (const n of detail.notes) {
    entries.push({
      key: `n-${n.id}`,
      kind: "note",
      time: formatTime(n.createdAt),
      at: new Date(n.createdAt).getTime(),
      content: n.content ?? "",
      frameNumber: null,
    });
  }
  for (const n of detail.frameNotes) {
    entries.push({
      key: `fn-${n.id}`,
      kind: "note",
      time: formatTime(n.createdAt),
      at: new Date(n.createdAt).getTime(),
      content: n.content ?? "",
      frameNumber: n.frameId ? frameNumberById.get(n.frameId) ?? null : null,
    });
  }
  return entries.sort((a, b) => a.at - b.at);
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Local calendar day, for grouping. */
function localDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "Today", "Yesterday", else a dated heading — with the year once it is not this one. */
function dayHeading(iso: string): string {
  const day = localDay(iso);
  const today = localDay(new Date().toISOString());
  if (day === today) return "Today";
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (day === localDay(y.toISOString())) return "Yesterday";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
  });
}

/** Consecutive notes from the same local day, in the order given. */
function groupByDay<T extends { capturedAt: string }>(events: T[]): Array<{ day: string; heading: string; events: T[] }> {
  const groups: Array<{ day: string; heading: string; events: T[] }> = [];
  for (const e of events) {
    const day = localDay(e.capturedAt);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.events.push(e);
    else groups.push({ day, heading: dayHeading(e.capturedAt), events: [e] });
  }
  return groups;
}

/**
 * One unpinned field note. The transcript leads, clamped until tapped — a real
 * field note is a ramble, and ten of them at full length bury the frames above.
 */
function FieldNoteRow({ event: e, rollId }: { event: RollDetail["unpinnedEvents"][number]; rollId: string }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [pinOpen, setPinOpen] = useState(false);
  const [imageBroken, setImageBroken] = useState(false);

  const settings = [e.shutterSpeed, e.aperture, e.compensation, e.meteringMode].filter(Boolean).join(" · ");
  const frame = e.frameNumber != null ? `frame ${e.frameNumber}${e.frameProvisional ? "?" : ""}` : e.sheetId ? `sheet ${e.sheetId}` : null;

  const remove = useMutation({
    mutationFn: () => fieldEvents.remove(e.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["roll", rollId] }),
  });

  // Not everything belongs to a frame. A thought about the light, a phone snap
  // of something never shot on film — the roll is the right home for those, and
  // forcing a frame number on them would be a lie.
  const attach = useMutation({
    mutationFn: () => fieldEvents.rollLevel(e.id, { rollId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["roll", rollId] }),
  });

  return (
    // Two rows, not two columns: the actions are a footer for the whole note, so
    // they sit in the same place whether the note is a paragraph or a bare photo.
    // Hanging them off the content column made them drift up beside the
    // timestamp when there was nothing to say.
    <li className="space-y-1" data-testid={`note-${e.id}`}>
      <div className="flex gap-2">
        <div className="w-14 shrink-0 space-y-1">
          <div className="tabular-nums text-muted-foreground">{formatTime(e.capturedAt)}</div>
          {e.kind === "photo" &&
            (e.fileUrl && !imageBroken ? (
              <img
                src={e.fileUrl}
                alt=""
                loading="lazy"
                onError={() => setImageBroken(true)}
                className="h-14 w-14 rounded object-cover"
              />
            ) : (
              // A missing file is worth saying out loud: the note is still real,
              // the bytes are not there.
              <div className="flex h-14 w-14 items-center justify-center rounded border border-dashed border-border text-[10px] text-muted-foreground">
                {e.fileUrl ? "photo missing" : "no photo yet"}
              </div>
            ))}
        </div>

        <div className="flex-1 space-y-0.5">
          {e.transcript && (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className={cn("block w-full text-left text-foreground", !expanded && "line-clamp-2")}
            >
              {e.transcript}
            </button>
          )}
          <div className="text-muted-foreground">
            {[frame, settings, e.review ? "needs review" : null].filter(Boolean).join(" · ")}
          </div>
          {e.parseNotes && <div className="italic text-muted-foreground">{e.parseNotes}</div>}
        </div>
      </div>

      {/* pl-16 lines the actions up with the text column above (w-14 + gap-2). */}
      <div className="flex gap-3 pl-16">
        <button type="button" onClick={() => setPinOpen(true)} className="text-primary">
          Pin to frame
        </button>
        <button
          type="button"
          onClick={() => attach.mutate()}
          disabled={attach.isPending}
          className="text-primary"
        >
          {attach.isPending ? "Attaching…" : "Attach to roll"}
        </button>
        <button
          type="button"
          onClick={() => remove.mutate()}
          disabled={remove.isPending}
          className="text-muted-foreground hover:text-danger"
        >
          {remove.isPending ? "Deleting…" : "Delete"}
        </button>
      </div>

      {pinOpen && (
        <PinNoteDialog
          open
          onClose={() => setPinOpen(false)}
          eventId={e.id}
          rollId={rollId}
          suggested={e.frameNumber ?? null}
          provisional={e.frameProvisional === true}
        />
      )}
    </li>
  );
}

/**
 * Pinning asks for the frame number rather than assuming the note's own. A
 * provisional number is a guess the app made — committing it silently is how a
 * roll ends up with two frame 1s.
 */
function PinNoteDialog({
  open, onClose, eventId, rollId, suggested, provisional,
}: {
  open: boolean; onClose: () => void; eventId: string; rollId: string;
  suggested: number | null; provisional: boolean;
}) {
  const queryClient = useQueryClient();
  const [frameNumber, setFrameNumber] = useState(suggested != null ? String(suggested) : "");

  const mutation = useMutation({
    mutationFn: () => fieldEvents.pin(eventId, { frameNumber: Number(frameNumber), rollId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roll", rollId] });
      queryClient.invalidateQueries({ queryKey: ["rolls"] });
      onClose();
    },
  });

  const n = Number(frameNumber);
  const valid = Number.isInteger(n) && n > 0;

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Pin to frame</DialogTitle>
      </DialogHeader>
      <DialogContent className="space-y-3">
        <div className="text-xs text-muted-foreground">
          Creates the frame from this note — settings, time and place — and attaches the
          transcript to it.
          {provisional && " This number was assigned by the app, not spoken; check it."}
        </div>
        <Field label="Frame number" required>
          <Input
            type="number"
            min={1}
            value={frameNumber}
            autoFocus
            onChange={(ev) => setFrameNumber(ev.target.value)}
          />
        </Field>
        {mutation.isError && (
          <div className="text-xs text-danger">{(mutation.error as Error).message}</div>
        )}
      </DialogContent>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => mutation.mutate()} disabled={!valid || mutation.isPending}>
          {mutation.isPending ? "Pinning…" : "Pin"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

// ── Dialogs ──────────────────────────────────────────────────────────

function AddFrameDialog({
  open,
  onClose,
  rollId,
  nextFrameNumber,
}: {
  open: boolean;
  onClose: () => void;
  rollId: string;
  nextFrameNumber: number;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<{
    frameNumber: number;
    shutterSpeed: string;
    aperture: string;
    subject: string;
    notes: string;
  }>({ frameNumber: nextFrameNumber, shutterSpeed: "", aperture: "", subject: "", notes: "" });

  const mutation = useMutation({
    mutationFn: (body: CreateFrame) => rolls.addFrame(rollId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rolls"] });
      onClose();
      setForm({ frameNumber: nextFrameNumber + 1, shutterSpeed: "", aperture: "", subject: "", notes: "" });
    },
  });

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Add Frame</DialogTitle>
      </DialogHeader>
      <DialogContent className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Frame #" required>
            <Input
              type="number"
              value={form.frameNumber}
              onChange={(e) => setForm({ ...form, frameNumber: Number(e.target.value) || 1 })}
              min={1}
            />
          </Field>
          <Field label="Shutter">
            <Input
              placeholder="1/250"
              value={form.shutterSpeed}
              onChange={(e) => setForm({ ...form, shutterSpeed: e.target.value })}
            />
          </Field>
          <Field label="Aperture">
            <Input
              placeholder="f/8"
              value={form.aperture}
              onChange={(e) => setForm({ ...form, aperture: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Subject">
          <Input
            placeholder="Short description"
            value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
          />
        </Field>
        <Field label="Notes">
          <Input
            placeholder="Anything else"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </Field>
      </DialogContent>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => mutation.mutate(form)} disabled={mutation.isPending}>
          {mutation.isPending ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function AddNoteDialog({ open, onClose, rollId }: { open: boolean; onClose: () => void; rollId: string }) {
  const queryClient = useQueryClient();
  const [content, setContent] = useState("");
  const [frameNumber, setFrameNumber] = useState<string>("");

  const mutation = useMutation({
    mutationFn: (body: CreateNote) => {
      const fn = frameNumber ? Number(frameNumber) : null;
      return fn ? rolls.addFrameNote(rollId, fn, body) : rolls.addNote(rollId, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rolls"] });
      onClose();
      setContent("");
      setFrameNumber("");
    },
  });

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Add Note</DialogTitle>
      </DialogHeader>
      <DialogContent className="space-y-3">
        <Field label="Attach to frame # (optional)">
          <Input
            type="number"
            placeholder="Leave blank for a roll note"
            value={frameNumber}
            onChange={(e) => setFrameNumber(e.target.value)}
            min={1}
          />
        </Field>
        <Field label="Note" required>
          <Input
            placeholder="What do you want to remember?"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </Field>
      </DialogContent>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => mutation.mutate({ content })} disabled={!content || mutation.isPending}>
          {mutation.isPending ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function UndoLoadDialog({
  open,
  onClose,
  rollId,
  framesLogged,
}: {
  open: boolean;
  onClose: () => void;
  rollId: string;
  framesLogged: number;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => rolls.undoLoad(rollId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rolls"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      onClose();
    },
  });

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Undo Load</DialogTitle>
      </DialogHeader>
      <DialogContent className="space-y-3">
        <div className="text-xs text-muted-foreground">
          This treats the load as a mistake: the roll is deleted and its film is credited back
          to inventory. Use <span className="font-medium text-foreground">Unload</span> instead
          if you actually finished shooting this roll.
        </div>
        {framesLogged > 0 && (
          <div className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
            Warning: {framesLogged} frame{framesLogged === 1 ? "" : "s"} already logged on this
            roll. They will be permanently deleted along with the roll.
          </div>
        )}
      </DialogContent>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? "Undoing…" : "Undo Load"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
