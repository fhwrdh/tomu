export const SHEET_FORMATS = ["4x5", "8x10"];

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

type Nullable<T> = T | null | undefined;
export interface FieldEventLike {
  capturedAt: string | Date;
  latitude?: Nullable<number | string>;
  longitude?: Nullable<number | string>;
  lensId?: Nullable<string>;
  shutterSpeed?: Nullable<string>;
  aperture?: Nullable<string>;
  compensation?: Nullable<string>;
  meteringMode?: Nullable<string>;
  subject?: Nullable<string>;
  locationName?: Nullable<string>;
}

function num(v: Nullable<number | string>): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** What a pinned event contributes to its frame. `notes` stays null: the transcript goes to a note row, not the frame. */
export function eventToFrame(e: FieldEventLike, frameNumber: number): FrameFields {
  const at = e.capturedAt instanceof Date ? e.capturedAt : new Date(e.capturedAt);
  return {
    frameNumber,
    lensId: e.lensId ?? null,
    shutterSpeed: e.shutterSpeed ?? null,
    aperture: e.aperture ?? null,
    compensation: e.compensation ?? null,
    meteringMode: e.meteringMode ?? null,
    subject: e.subject ?? null,
    locationName: e.locationName ?? null,
    notes: null,
    latitude: num(e.latitude),
    longitude: num(e.longitude),
    shotAt: at.toISOString(),
  };
}
