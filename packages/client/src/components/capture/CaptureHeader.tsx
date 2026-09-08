import { Camera as CameraIcon } from "lucide-react";
import { Button } from "../ui/button.js";
import type { CameraState, GearCache } from "../../offline/db.js";

export interface CaptureHeaderProps {
  gear?: GearCache;
  cameraId: string | null;
  onCameraChange: (cameraId: string) => void;
  cameraState?: CameraState;
  online: boolean;
  onLoad: () => void;
  onUnload: () => void;
  onFilmChanged: () => void;
}

/**
 * Camera first, because that is the order the real thing happens in: you pick up
 * a body, and what is in it follows. The roll shown is whatever Tomu believes is
 * loaded in that camera — and when the phone knows it cannot know (film changed
 * with no signal), it says so instead of naming a roll that is no longer there.
 */
export function CaptureHeader({
  gear, cameraId, onCameraChange, cameraState, online, onLoad, onUnload, onFilmChanged,
}: CaptureHeaderProps) {
  const cameras = gear?.cameras ?? [];
  const camera = cameras.find((c) => c.id === cameraId);
  const roll = gear?.activeRolls.find((r) => r.cameraId === cameraId);
  const filmChanged = cameraState?.rollUnknownSince != null;

  return (
    <div className="space-y-2 rounded-md border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <CameraIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
        {cameras.length > 0 ? (
          <select
            value={cameraId ?? ""}
            onChange={(e) => onCameraChange(e.target.value)}
            aria-label="Camera"
            className="min-w-0 flex-1 truncate bg-transparent text-sm font-medium text-foreground outline-none"
          >
            {cameras.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        ) : (
          <span className="flex-1 text-sm text-muted-foreground">No cameras cached yet</span>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 text-sm">
        {filmChanged ? (
          // The honest state: something is in there, Tomu does not know what.
          <span className="text-warning" data-testid="roll-state">
            Film changed — notes save loose
          </span>
        ) : roll ? (
          <span className="truncate text-foreground" data-testid="roll-state">
            {roll.label} · {roll.framesShot}/{roll.frameCount}
          </span>
        ) : (
          <span className="text-muted-foreground" data-testid="roll-state">
            {camera ? `No roll in the ${camera.label}` : "No roll — notes save loose"}
          </span>
        )}

        <div className="flex shrink-0 gap-1.5">
          {roll && !filmChanged ? (
            <Button size="sm" variant="outline" disabled={!online} onClick={onUnload}>
              Unload
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled={!online || !camera} onClick={onLoad}>
              Load
            </Button>
          )}
          {/* Always available, online or not: it is the one control that keeps a
              film swap in a dead zone from silently mis-filing every next note. */}
          {roll && !filmChanged && (
            <Button size="sm" variant="ghost" onClick={onFilmChanged}>
              Film changed
            </Button>
          )}
        </div>
      </div>

      {!online && (
        <p className="text-xs text-muted-foreground">
          Offline — loading and unloading need signal. Tap “Film changed” if you swap film;
          notes will save loose and can be attached to the roll later.
        </p>
      )}
    </div>
  );
}
