// ── Gear corrections ──
//
// Turning a loose "change this about that camera" into the PATCH body the API accepts,
// and saying back what actually changed. Pure, so the rules are tested without a server.
// Gear gets corrected after the fact — a camera recorded as 4x5 that is really a 35mm
// pinhole — so this accepts what a person would type and explains what it refuses.

import { FILM_FORMATS, type FilmFormat } from "@tomu/shared";

export type GearKind = "camera" | "lens";

export interface GearUpdateInput {
  make?: string;
  model?: string;
  format?: string;
  frameCount?: number;
  focalLengthMm?: number;
  maxAperture?: string;
  serialNumber?: string;
  notes?: string;
  isActive?: boolean;
}

/** Which inputs each kind of gear takes; anything else is ignored, not sent. */
const FIELDS: Record<GearKind, Array<keyof GearUpdateInput>> = {
  camera: ["make", "model", "format", "frameCount", "serialNumber", "notes", "isActive"],
  lens: ["make", "model", "focalLengthMm", "maxAperture", "serialNumber", "notes", "isActive"],
};

/** "35MM", "35 mm" and a bare "35" all mean 35mm; "4 X 5" is 4x5. Null when unknown. */
export function normalizeFormat(input: string): FilmFormat | null {
  const s = input.toLowerCase().replace(/\s+/g, "");
  if (s === "35") return "35mm";
  return (FILM_FORMATS as readonly string[]).includes(s) ? (s as FilmFormat) : null;
}

export function buildGearPatch(
  kind: GearKind,
  input: GearUpdateInput,
): { body?: Record<string, unknown>; error?: string } {
  const body: Record<string, unknown> = {};
  for (const field of FIELDS[kind]) {
    const value = input[field];
    if (value == null) continue;
    if (field === "format") {
      const format = normalizeFormat(String(value));
      if (!format) {
        return { error: `"${value}" is not a format Tomu knows. Use one of: ${FILM_FORMATS.join(", ")}.` };
      }
      body.format = format;
      continue;
    }
    body[field] = value;
  }
  if (Object.keys(body).length === 0) {
    return { error: `Nothing to change: give at least one ${kind} field to update.` };
  }
  return { body };
}

/** "format 4x5 → 35mm; notes — → pinhole", naming a sent field that was already set. */
export function describeChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: string[],
): string {
  const show = (v: unknown) => (v == null || v === "" ? "—" : String(v));
  return fields
    .map((f) => (show(before[f]) === show(after[f]) ? `${f} already ${show(after[f])}` : `${f} ${show(before[f])} → ${show(after[f])}`))
    .join("; ");
}
