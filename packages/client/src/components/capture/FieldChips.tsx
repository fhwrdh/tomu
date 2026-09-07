import { X } from "lucide-react";
import { cn } from "../../lib/utils.js";
import type { GearCache, LocalEvent } from "../../offline/db.js";

/**
 * The four fields a frame is expected to carry always render, dashed when the
 * parser has not found them — an empty slot you can see is a prompt to say the
 * missing thing, where a hidden one is a silent omission you discover months
 * later at the scanner.
 */
const EXPECTED = ["camera", "frame", "shutter", "aperture"] as const;

export interface Chip {
  /** Stable key, also the store field name where one exists. */
  key: string;
  label: string;
  value: string | null;
  /** Renders as uncertain — a provisional frame number. */
  provisional?: boolean;
}

export function chipsFor(event: Partial<LocalEvent>, gear?: GearCache): Chip[] {
  const camera = gear?.cameras.find((c) => c.id === event.cameraId);
  const lens = gear?.lenses.find((l) => l.id === event.lensId);

  const chips: Chip[] = [
    { key: "camera", label: "camera", value: camera?.label ?? null },
    {
      key: "frame",
      label: "frame",
      value: event.frameNumber != null ? String(event.frameNumber) : null,
      provisional: event.frameProvisional === true,
    },
    { key: "shutter", label: "shutter", value: event.shutterSpeed ?? null },
    { key: "aperture", label: "aperture", value: event.aperture ?? null },
    { key: "compensation", label: "comp", value: event.compensation ?? null },
    { key: "metering", label: "metering", value: event.meteringMode ?? null },
    { key: "lens", label: "lens", value: lens?.label ?? null },
  ];

  // Expected chips always show; the rest only once they have something to say.
  return chips.filter((c) => c.value != null || EXPECTED.includes(c.key as (typeof EXPECTED)[number]));
}

interface FieldChipsProps {
  chips: Chip[];
  /** Marked as hand-corrected; shown so a correction is visibly sticky. */
  editedFields?: string[];
  onClear?: (chip: Chip) => void;
}

export function FieldChips({ chips, editedFields = [], onClear }: FieldChipsProps) {
  return (
    <div className="flex flex-wrap gap-1.5" data-testid="field-chips">
      {chips.map((chip) => {
        const empty = chip.value == null;
        const edited = editedFields.includes(storeField(chip.key));
        return (
          <span
            key={chip.key}
            data-testid={`chip-${chip.key}`}
            data-empty={empty ? "true" : "false"}
            data-provisional={chip.provisional ? "true" : undefined}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
              empty
                ? "border-dashed border-border text-muted-foreground"
                : "border-border bg-secondary text-foreground",
              edited && "border-primary/60 text-primary",
            )}
          >
            <span className="text-muted-foreground">{chip.label}</span>
            <span className="font-medium">
              {chip.value ?? "—"}
              {chip.provisional && "?"}
            </span>
            {!empty && onClear && (
              <button
                type="button"
                aria-label={`Clear ${chip.label}`}
                onClick={() => onClear(chip)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}

/** Chip keys are display names; these are the fields the store actually holds. */
export function storeField(chipKey: string): string {
  switch (chipKey) {
    case "camera": return "cameraId";
    case "frame": return "frameNumber";
    case "shutter": return "shutterSpeed";
    case "metering": return "meteringMode";
    case "lens": return "lensId";
    default: return chipKey;
  }
}
