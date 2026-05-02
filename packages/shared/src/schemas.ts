import { z } from "zod";
import {
  FILM_FORMATS,
  FILM_TYPES,
  INVENTORY_FORMS,
  METERING_MODES,
  NOTE_TYPES,
  ROLL_STATUSES,
  STORAGE_LOCATIONS,
} from "./constants.js";

const uuid = z.string().uuid();

// ── Gear ──

export const createCameraSchema = z.object({
  make: z.string().min(1).max(100),
  model: z.string().min(1).max(100),
  format: z.enum(FILM_FORMATS),
  frameCount: z.number().int().positive().optional(),
  serialNumber: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
});

export const updateCameraSchema = createCameraSchema
  .partial()
  .extend({ isActive: z.boolean().optional() });

export const createLensSchema = z.object({
  make: z.string().min(1).max(100),
  model: z.string().min(1).max(100),
  focalLengthMm: z.number().int().positive().optional(),
  maxAperture: z.string().max(10).optional(),
  serialNumber: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
});

export const updateLensSchema = createLensSchema
  .partial()
  .extend({ isActive: z.boolean().optional() });

// ── Film ──

export const createFilmStockSchema = z.object({
  manufacturer: z.string().min(1).max(100),
  name: z.string().min(1).max(100),
  iso: z.number().int().positive(),
  type: z.enum(FILM_TYPES),
  frameCount: z.number().int().positive().optional(),
  notes: z.string().max(2000).optional(),
});

export const updateFilmStockSchema = createFilmStockSchema
  .partial()
  .extend({ isActive: z.boolean().optional() });

export const createFilmInventorySchema = z.object({
  filmStockId: z.string().uuid(),
  format: z.enum(FILM_FORMATS),
  form: z.enum(INVENTORY_FORMS),
  quantity: z.number().int().min(0).optional(),
  frameCount: z.number().int().positive().optional(),
  ratedIso: z.number().int().positive().optional(),
  remainingLengthFt: z.number().positive().optional(),
  originalLengthFt: z.number().positive().optional(),
  expirationDate: z.string().optional(),
  storageLocation: z.enum(STORAGE_LOCATIONS).default("fridge"),
  purchaseDate: z.string().optional(),
  costPerRoll: z.number().positive().optional(),
  notes: z.string().max(2000).optional(),
});

export const updateFilmInventorySchema = z.object({
  quantity: z.number().int().min(0).optional(),
  frameCount: z.number().int().positive().optional(),
  ratedIso: z.number().int().positive().optional(),
  remainingLengthFt: z.number().min(0).optional(),
  expirationDate: z.string().optional(),
  storageLocation: z.enum(STORAGE_LOCATIONS).optional(),
  costPerRoll: z.number().positive().optional(),
  notes: z.string().max(2000).optional(),
});

// ── Rolls ──

/** Load a roll. Server assigns loadedAt and decrements inventory. */
export const createRollSchema = z.object({
  filmStockId: uuid,
  format: z.enum(FILM_FORMATS),
  form: z.enum(INVENTORY_FORMS).optional(),
  cameraId: uuid.optional(),
  frameCount: z.number().int().positive().optional(),
  ratedIso: z.number().int().positive().optional(),
  pushPullStops: z.number().optional(),
  title: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  tags: z.array(z.string()).optional(),
});

export const updateRollSchema = z.object({
  cameraId: uuid.optional(),
  frameCount: z.number().int().positive().optional(),
  ratedIso: z.number().int().positive().optional(),
  pushPullStops: z.number().optional(),
  title: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  tags: z.array(z.string()).optional(),
});

export const rollStatusSchema = z.object({
  status: z.enum(ROLL_STATUSES),
});

/**
 * Log a roll that's already been shot — for retroactive entry of fridge-pile
 * canisters and historical inventory. Skips inventory decrement entirely.
 * If shotDate is provided, computes a YYYYMMDD.NN displayId from it.
 */
export const logShotRollSchema = z.object({
  filmStockId: uuid,
  format: z.enum(FILM_FORMATS),
  form: z.enum(INVENTORY_FORMS).optional(),
  cameraId: uuid.optional(),
  ratedIso: z.number().int().positive().optional(),
  pushPullStops: z.number().optional(),
  frameCount: z.number().int().positive().optional(),
  /** Local YYYY-MM-DD when the roll was actually shot/unloaded. */
  shotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  title: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  tags: z.array(z.string()).optional(),
  note: z.string().max(5000).optional(),
});

// ── Frames ──

/** Log a frame. Frame number is optional — server auto-increments if omitted. */
export const createFrameSchema = z.object({
  frameNumber: z.number().int().positive().optional(),
  lensId: uuid.optional(),
  shutterSpeed: z.string().max(20).optional(),
  aperture: z.string().max(10).optional(),
  compensation: z.string().max(10).optional(),
  meteringMode: z.enum(METERING_MODES).optional(),
  subject: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  locationName: z.string().max(200).optional(),
  shotAt: z.string().datetime().optional(),
  tags: z.array(z.string()).optional(),
});

/** Body for PATCH /rolls/:id/unload. localDate is the user's local YYYY-MM-DD, used to compute displayId. */
export const unloadRollSchema = z.object({
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  note: z.string().max(5000).optional(),
});

export const updateFrameSchema = createFrameSchema.partial();

// ── Development ──

/**
 * Create a dev session. Provide either `shorthand` (e.g. "B7.5", "1:50/8mins")
 * which gets parsed into `dilution` + `devTimeSeconds`, or those fields explicitly.
 * Explicit values win over the parser when both are provided.
 */
export const createDevSessionSchema = z.object({
  rollIds: z.array(uuid).min(1),
  developer: z.string().min(1).max(100),
  shorthand: z.string().max(50).optional(),
  dilution: z.string().max(50).optional(),
  devTimeSeconds: z.number().int().positive().optional(),
  temperatureC: z.number().optional(),
  agitation: z.string().max(500).optional(),
  tank: z.string().max(100).optional(),
  stopBath: z.string().max(100).optional(),
  fixer: z.string().max(100).optional(),
  fixerTimeSeconds: z.number().int().positive().optional(),
  washMethod: z.string().max(200).optional(),
  wettingAgent: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
  developedAt: z.string().optional(),
  /** Local YYYY-MM-DD used to compute the session displayId. */
  localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const completeDevSessionSchema = z.object({
  resultsRating: z.number().int().min(1).max(5).optional(),
  resultsNotes: z.string().max(2000).optional(),
});

// ── Notes ──

/** Input for a note attached to a roll or a frame. Parent ID comes from the route path. */
export const createNoteSchema = z.object({
  content: z.string().max(5000),
  type: z.enum(NOTE_TYPES).optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});
