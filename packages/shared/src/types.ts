import type {
  FilmFormat,
  FilmType,
  InventoryForm,
  MeteringMode,
  NoteType,
  RollStatus,
  StorageLocation,
} from "./constants.js";

// ── Base ──

export interface Timestamps {
  createdAt: string;
  updatedAt: string;
}

// ── Gear ──

export interface Camera extends Timestamps {
  id: string;
  userId: string;
  make: string;
  model: string;
  format: FilmFormat;
  /** Default frame count for rolls loaded into this camera (36 for 35mm, 10 for 6x7, 1 for sheet, etc.) */
  frameCount?: number;
  serialNumber?: string;
  notes?: string;
  isActive: boolean;
}

export interface Lens extends Timestamps {
  id: string;
  userId: string;
  make: string;
  model: string;
  focalLengthMm?: number;
  maxAperture?: string;
  serialNumber?: string;
  notes?: string;
  isActive: boolean;
}

// ── Film ──

export interface FilmStock extends Timestamps {
  id: string;
  userId: string;
  manufacturer: string;
  name: string;
  iso: number;
  type: FilmType;
  /** Frame count when this stock is factory-loaded. Null for bulk-only stocks or when the format default is fine. */
  frameCount?: number;
  notes?: string;
  isActive: boolean;
}

export interface FilmInventoryItem extends Timestamps {
  id: string;
  userId: string;
  filmStockId: string;
  format: FilmFormat;
  form: InventoryForm;
  /** Number of rolls (factory_roll) or sheets (sheet) */
  quantity: number;
  /** Per-item frame count override (for bulk-spooled cassettes of varying length). */
  frameCount?: number;
  /** Per-item rated ISO — target shooting speed. Carried to roll.ratedIso at load. */
  ratedIso?: number;
  /** Auto-assigned stable ID like "R001" for tracked singletons. Null for fungible batch items. Carried over to roll.title at load. */
  displayId?: string;
  /** Remaining length in feet for bulk_roll */
  remainingLengthFt?: number;
  /** Original length in feet for bulk_roll */
  originalLengthFt?: number;
  expirationDate?: string;
  storageLocation: StorageLocation;
  purchaseDate?: string;
  costPerRoll?: number;
  notes?: string;
}

/** FilmStock with aggregated inventory info */
export interface FilmStockWithInventory extends FilmStock {
  inventoryItems: FilmInventoryItem[];
}

// ── Rolls ──

export interface Roll extends Timestamps {
  id: string;
  userId: string;
  cameraId?: string;
  filmStockId: string;
  format: FilmFormat;
  form: InventoryForm;
  status: RollStatus;
  loadedAt?: string;
  unloadedAt?: string;
  /** Human-readable ID assigned at unload: YYYYMMDD.N (local date, N = Nth roll unloaded that day) */
  displayId?: string;
  /** Rated ISO — the speed the film is being shot at (prescription, not history). */
  ratedIso?: number;
  pushPullStops?: number;
  frameCount: number;
  title?: string;
  description?: string;
  tags: string[];
}

export interface Frame extends Timestamps {
  id: string;
  rollId: string;
  frameNumber: number;
  lensId?: string;
  shutterSpeed?: string;
  aperture?: string;
  compensation?: string;
  meteringMode?: MeteringMode;
  subject?: string;
  notes?: string;
  latitude?: number;
  longitude?: number;
  locationName?: string;
  shotAt?: string;
  tags: string[];
  rating?: number;
  isPortfolio: boolean;
}

// ── Development ──

export interface DevelopmentLog extends Timestamps {
  id: string;
  rollId: string;
  developer: string;
  dilution?: string;
  devTimeSeconds?: number;
  temperatureC?: number;
  agitation?: string;
  stopBath?: string;
  fixer?: string;
  fixerTimeSeconds?: number;
  washMethod?: string;
  wettingAgent?: string;
  notes?: string;
  developedAt?: string;
  resultsRating?: number;
  resultsNotes?: string;
}

// ── Notes & Scans ──

export interface Note extends Timestamps {
  id: string;
  userId: string;
  rollId?: string;
  frameId?: string;
  type?: NoteType;
  content?: string;
  fileKey?: string;
  fileUrl?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  mimeType?: string;
  fileSizeBytes?: number;
  latitude?: number;
  longitude?: number;
}

export interface Scan extends Timestamps {
  id: string;
  frameId: string;
  scannerId?: string;
  fileKey: string;
  fileUrl: string;
  thumbnailUrl?: string;
  originalFilename?: string;
  mimeType?: string;
  fileSizeBytes?: number;
  widthPx?: number;
  heightPx?: number;
  dpi?: number;
  bitDepth?: number;
  colorSpace?: string;
  postProcessingNotes?: string;
  isPrimary: boolean;
}

export interface Scanner extends Timestamps {
  id: string;
  userId: string;
  make?: string;
  model?: string;
  notes?: string;
  isActive: boolean;
}

// ── API Input Types ──

export type CreateCamera = Pick<Camera, "make" | "model" | "format"> &
  Partial<Pick<Camera, "frameCount" | "serialNumber" | "notes">>;

export type UpdateCamera = Partial<CreateCamera & Pick<Camera, "isActive">>;

export type CreateLens = Pick<Lens, "make" | "model"> &
  Partial<Pick<Lens, "focalLengthMm" | "maxAperture" | "serialNumber" | "notes">>;

export type UpdateLens = Partial<CreateLens & Pick<Lens, "isActive">>;

export type CreateFilmStock = Pick<FilmStock, "manufacturer" | "name" | "iso" | "type"> &
  Partial<Pick<FilmStock, "frameCount" | "notes">>;

export type UpdateFilmStock = Partial<CreateFilmStock & Pick<FilmStock, "isActive">>;

export type CreateFilmInventoryItem = Pick<FilmInventoryItem, "filmStockId" | "format" | "form"> &
  Partial<Pick<FilmInventoryItem, "quantity" | "frameCount" | "ratedIso" | "remainingLengthFt" | "originalLengthFt" | "expirationDate" | "storageLocation" | "purchaseDate" | "costPerRoll" | "notes">>;

export type UpdateFilmInventoryItem = Partial<
  Pick<FilmInventoryItem, "quantity" | "frameCount" | "ratedIso" | "remainingLengthFt" | "expirationDate" | "storageLocation" | "costPerRoll" | "notes">
>;

/** Input for loading a roll into a camera. Server records loadedAt and decrements inventory. */
export type CreateRoll = Pick<Roll, "filmStockId" | "format"> &
  Partial<
    Pick<
      Roll,
      | "cameraId"
      | "form"
      | "frameCount"
      | "ratedIso"
      | "pushPullStops"
      | "title"
      | "description"
      | "tags"
    >
  >;

export type CreateFrame = Partial<
  Pick<
    Frame,
    | "frameNumber"
    | "lensId"
    | "shutterSpeed"
    | "aperture"
    | "compensation"
    | "meteringMode"
    | "subject"
    | "notes"
    | "latitude"
    | "longitude"
    | "locationName"
    | "tags"
  >
>;

/** Input for a note attached to a roll or a frame. Exactly one parent is set by the route. */
export type CreateNote = Pick<Note, "content"> &
  Partial<Pick<Note, "type" | "latitude" | "longitude">>;
