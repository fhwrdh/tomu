import { useState } from "react";
import { Camera, Check, CloudOff, Loader2, Sparkles, Trash2, TriangleAlert } from "lucide-react";
import { cn } from "../../lib/utils.js";
import type { GearCache, LocalEvent, SyncState } from "../../offline/db.js";
import { chipsFor, FieldChips, storeField, type Chip } from "./FieldChips.js";

/**
 * What each state means to someone standing in a field, which is not the same
 * as what it means to the queue. "Waiting for signal" is the honest phrasing:
 * on iOS nothing syncs while the app is closed.
 */
const STATE_LABEL: Record<SyncState, string> = {
  queued: "waiting for signal",
  synced: "saved",
  parsed: "read by Claude",
  needs_review: "needs a look",
  error: "could not save",
};

function StateIcon({ state }: { state: SyncState }) {
  switch (state) {
    case "queued": return <CloudOff className="h-3.5 w-3.5" />;
    case "synced": return <Check className="h-3.5 w-3.5 text-success" />;
    case "parsed": return <Sparkles className="h-3.5 w-3.5 text-primary" />;
    case "needs_review": return <TriangleAlert className="h-3.5 w-3.5 text-warning" />;
    case "error": return <TriangleAlert className="h-3.5 w-3.5 text-danger" />;
  }
}

function time(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export interface EventStreamProps {
  events: LocalEvent[];
  gear?: GearCache;
  /** Local photo previews by clientId, for events whose blob has not gone up yet. */
  previews: Record<string, string>;
  onClear: (event: LocalEvent, chip: Chip) => void;
  onDelete: (event: LocalEvent) => void;
  syncing: boolean;
}

/** Today's captures, newest first. Transcript first, fields second — always. */
export function EventStream({ events, gear, previews, onClear, onDelete, syncing }: EventStreamProps) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (events.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Nothing captured yet today.
      </p>
    );
  }

  return (
    <div className="space-y-2" data-testid="event-stream">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Today · {events.length}
        </h2>
        {syncing && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>

      {events.map((event) => {
        const open = openId === event.clientId;
        const preview = previews[event.clientId] ?? event.fileUrl;
        return (
          <div
            key={event.clientId}
            data-testid={`event-${event.clientId}`}
            className="overflow-hidden rounded-md border border-border bg-card"
          >
            <button
              type="button"
              onClick={() => setOpenId(open ? null : event.clientId)}
              className="flex w-full items-start gap-3 p-3 text-left"
            >
              {event.kind === "photo" ? (
                preview ? (
                  <img src={preview} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />
                ) : (
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-secondary">
                    <Camera className="h-5 w-5 text-muted-foreground" />
                  </span>
                )
              ) : null}

              <span className="min-w-0 flex-1">
                <span className="mb-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                  {time(event.capturedAt)}
                  <span className="flex items-center gap-1" data-testid={`state-${event.clientId}`}>
                    <StateIcon state={event.syncState} />
                    {STATE_LABEL[event.syncState]}
                  </span>
                  {event.frameNumber != null && (
                    <span>· frame {event.frameNumber}{event.frameProvisional ? "?" : ""}</span>
                  )}
                </span>
                <span className={cn("block text-sm text-foreground", !open && "line-clamp-2")}>
                  {event.transcript ?? (event.kind === "photo" ? "Photo" : "")}
                </span>
              </span>
            </button>

            {open && (
              <div className="space-y-3 border-t border-border px-3 pb-3 pt-2">
                <FieldChips
                  chips={chipsFor(event, gear)}
                  editedFields={event.editedFields}
                  onClear={(chip) => onClear(event, chip)}
                />
                {event.subject && (
                  <p className="text-xs text-muted-foreground">
                    <span className="text-foreground">{event.subject}</span>
                    {event.locationName ? ` · ${event.locationName}` : ""}
                  </p>
                )}
                {event.remarks && <p className="text-xs text-muted-foreground">{event.remarks}</p>}
                {event.parseNotes && (
                  <p className="text-xs text-warning" data-testid="parse-note">{event.parseNotes}</p>
                )}
                {event.error && <p className="text-xs text-danger">{event.error}</p>}
                <button
                  type="button"
                  onClick={() => onDelete(event)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export { storeField };
