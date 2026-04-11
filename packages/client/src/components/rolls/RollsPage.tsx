import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Disc, Camera as CameraIcon, StickyNote, Square, ChevronRight, Undo2 } from "lucide-react";
import { FILM_FORMATS, FILM_FORMAT_LABELS } from "@tomu/shared";
import type { CreateRoll, CreateFrame, CreateNote } from "@tomu/shared";
import { cameras, filmStocks, rolls, type RollListItem, type RollDetail } from "../../services/api.js";
import { Button } from "../ui/button.js";
import { Badge } from "../ui/badge.js";
import { Input } from "../ui/input.js";
import { Select } from "../ui/select.js";
import { Dialog, DialogHeader, DialogTitle, DialogContent, DialogFooter } from "../ui/dialog.js";

const STATUS_FILTERS = [
  { value: "active", label: "Active" },
  { value: "unloaded", label: "Unloaded" },
  { value: "all", label: "All" },
];

function localDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function RollsPage() {
  const [status, setStatus] = useState("active");
  const [loadOpen, setLoadOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ["rolls", status],
    queryFn: () => rolls.list(status),
  });

  const items = listQuery.data?.data ?? [];

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
        <div className="text-xs text-muted-foreground">No frames or notes yet.</div>
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

// ── Dialogs ──────────────────────────────────────────────────────────

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-foreground">
        {label}
        {required && <span className="text-danger"> *</span>}
      </label>
      {children}
    </div>
  );
}

function LoadRollDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const stocksQuery = useQuery({ queryKey: ["film-stocks"], queryFn: () => filmStocks.list() });
  const camerasQuery = useQuery({ queryKey: ["cameras"], queryFn: () => cameras.list() });

  const [form, setForm] = useState({
    filmStockId: "",
    cameraId: "",
    format: "35mm" as (typeof FILM_FORMATS)[number],
  });

  const mutation = useMutation({
    mutationFn: (body: CreateRoll) => rolls.load(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rolls"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      onClose();
      setForm({ filmStockId: "", cameraId: "", format: "35mm" });
    },
  });

  const stocks = stocksQuery.data?.data ?? [];
  const cams = camerasQuery.data?.data ?? [];

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Load Roll</DialogTitle>
      </DialogHeader>
      <DialogContent className="space-y-3">
        <Field label="Film Stock" required>
          <Select value={form.filmStockId} onChange={(e) => setForm({ ...form, filmStockId: e.target.value })}>
            <option value="">Select film stock</option>
            {stocks.map((s) => (
              <option key={s.id} value={s.id}>
                {s.manufacturer} {s.name} (ISO {s.iso})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Camera" required>
          <Select value={form.cameraId} onChange={(e) => setForm({ ...form, cameraId: e.target.value })}>
            <option value="">Select camera</option>
            {cams.map((c) => (
              <option key={c.id} value={c.id}>
                {c.make} {c.model}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Format" required>
          <Select value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value as typeof form.format })}>
            {FILM_FORMATS.map((f) => (
              <option key={f} value={f}>
                {FILM_FORMAT_LABELS[f]}
              </option>
            ))}
          </Select>
        </Field>
        {mutation.isError && (
          <div className="text-xs text-danger">{(mutation.error as Error).message}</div>
        )}
      </DialogContent>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={() => mutation.mutate(form)}
          disabled={!form.filmStockId || !form.cameraId || mutation.isPending}
        >
          {mutation.isPending ? "Loading…" : "Load"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

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

function UnloadDialog({ open, onClose, rollId }: { open: boolean; onClose: () => void; rollId: string }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");

  const mutation = useMutation({
    mutationFn: () => rolls.unload(rollId, { localDate: localDate(), note: note || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rolls"] });
      onClose();
      setNote("");
    },
  });

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Unload Roll</DialogTitle>
      </DialogHeader>
      <DialogContent className="space-y-3">
        <div className="text-xs text-muted-foreground">
          Assigns a display ID based on today's local date. The roll can no longer be shot after this.
        </div>
        <Field label="Final note (optional)">
          <Input
            placeholder="e.g. pulled early, light leak suspected"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
      </DialogContent>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? "Unloading…" : "Unload"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
