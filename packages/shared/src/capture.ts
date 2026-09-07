/**
 * Field captures — id formatting and the capture → frame mapping.
 *
 * A capture id is `C<seq>`: a per-user monotonic integer, no padding.
 * Captures are pending until assigned a frame number; the mapping here is
 * the single place that decides which capture fields become frame fields.
 */

export function formatCaptureId(seq: number): string {
  return `C${seq}`;
}

/** Accepts "C412", "c412", "412" (with surrounding whitespace). Null otherwise. */
export function parseCaptureId(input: string): number | null {
  const m = input.trim().match(/^[Cc]?(\d{1,7})$/);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 ? n : null;
}

type Nullable<T> = T | null | undefined;

/** The subset of a capture that the mapping reads. Loose so DB rows and API objects both fit. */
export interface CaptureLike {
  lensId?: Nullable<string>;
  shutterSpeed?: Nullable<string>;
  aperture?: Nullable<string>;
  compensation?: Nullable<string>;
  meteringMode?: Nullable<string>;
  subject?: Nullable<string>;
  locationName?: Nullable<string>;
  notes?: Nullable<string>;
  capturedAt: string | Date;
  photoTakenAt?: Nullable<string | Date>;
  latitude?: Nullable<number | string>;
  longitude?: Nullable<number | string>;
}

export interface FrameFields {
  frameNumber: number;
  lensId: string | null;
  shutterSpeed: string | null;
  aperture: string | null;
  compensation: string | null;
  meteringMode: string | null;
  subject: string | null;
  locationName: string | null;
  notes: string | null;
  latitude: number | null;
  longitude: number | null;
  /** ISO string. Photo EXIF time when known, else when the settings were spoken. */
  shotAt: string;
}

function iso(v: string | Date): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function num(v: Nullable<number | string>): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function captureToFrame(c: CaptureLike, frameNumber: number): FrameFields {
  return {
    frameNumber,
    lensId: c.lensId ?? null,
    shutterSpeed: c.shutterSpeed ?? null,
    aperture: c.aperture ?? null,
    compensation: c.compensation ?? null,
    meteringMode: c.meteringMode ?? null,
    subject: c.subject ?? null,
    locationName: c.locationName ?? null,
    notes: c.notes ?? null,
    latitude: num(c.latitude),
    longitude: num(c.longitude),
    shotAt: c.photoTakenAt ? iso(c.photoTakenAt) : iso(c.capturedAt),
  };
}
