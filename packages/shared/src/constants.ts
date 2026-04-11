export const FILM_TYPES = ["bw", "color_negative", "color_positive", "instant"] as const;
export type FilmType = (typeof FILM_TYPES)[number];

export const FILM_FORMATS = ["35mm", "120", "4x5", "8x10", "other"] as const;
export type FilmFormat = (typeof FILM_FORMATS)[number];

export const ROLL_STATUSES = [
  "loaded",
  "shooting",
  "shot",
  "developing",
  "developed",
  "scanning",
  "complete",
  "archived",
] as const;
export type RollStatus = (typeof ROLL_STATUSES)[number];

export const NOTE_TYPES = ["text", "voice", "photo"] as const;
export type NoteType = (typeof NOTE_TYPES)[number];

export const METERING_MODES = ["incident", "spot", "average", "center"] as const;
export type MeteringMode = (typeof METERING_MODES)[number];

export const STORAGE_LOCATIONS = ["fridge", "freezer", "room_temp", "other"] as const;
export type StorageLocation = (typeof STORAGE_LOCATIONS)[number];

export const INVENTORY_FORMS = ["factory_roll", "bulk_roll", "sheet"] as const;
export type InventoryForm = (typeof INVENTORY_FORMS)[number];

export const INVENTORY_FORM_LABELS: Record<InventoryForm, string> = {
  factory_roll: "Factory Rolls",
  bulk_roll: "Bulk Roll",
  sheet: "Sheet Film",
};

/** Valid status transitions for rolls */
export const ROLL_STATUS_TRANSITIONS: Record<RollStatus, RollStatus[]> = {
  loaded: ["shooting"],
  shooting: ["shot"],
  shot: ["developing"],
  developing: ["developed"],
  developed: ["scanning", "complete"],
  scanning: ["complete"],
  complete: ["archived"],
  archived: [],
};

export const FILM_TYPE_LABELS: Record<FilmType, string> = {
  bw: "Black & White",
  color_negative: "Color Negative",
  color_positive: "Color Positive (Slide)",
  instant: "Instant",
};

export const FILM_FORMAT_LABELS: Record<FilmFormat, string> = {
  "35mm": "35mm",
  "120": "120 (Medium Format)",
  "4x5": "4x5 (Large Format)",
  "8x10": "8x10 (Large Format)",
  other: "Other",
};

/** Default frame counts by format */
export const DEFAULT_FRAME_COUNTS: Record<FilmFormat, number> = {
  "35mm": 36,
  "120": 12,
  "4x5": 1,
  "8x10": 1,
  other: 36,
};
