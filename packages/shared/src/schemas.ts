import { z } from "zod";
import {
  FILM_FORMATS,
  FILM_TYPES,
  METERING_MODES,
  NOTE_TYPES,
  ROLL_STATUSES,
  STORAGE_LOCATIONS,
} from "./constants.js";

// ── Gear ──

export const createCameraSchema = z.object({
  make: z.string().min(1).max(100),
  model: z.string().min(1).max(100),
  format: z.enum(FILM_FORMATS),
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
  format: z.enum(FILM_FORMATS),
  notes: z.string().max(2000).optional(),
});

export const updateFilmStockSchema = createFilmStockSchema
  .partial()
  .extend({ isActive: z.boolean().optional() });

export const createFilmInventorySchema = z.object({
  filmStockId: z.string().uuid(),
  quantity: z.number().int().positive(),
  expirationDate: z.string().optional(),
  storageLocation: z.enum(STORAGE_LOCATIONS).default("fridge"),
  purchaseDate: z.string().optional(),
  costPerRoll: z.number().positive().optional(),
  notes: z.string().max(2000).optional(),
});

export const updateFilmInventorySchema = z.object({
  quantity: z.number().int().min(0).optional(),
  expirationDate: z.string().optional(),
  storageLocation: z.enum(STORAGE_LOCATIONS).optional(),
  costPerRoll: z.number().positive().optional(),
  notes: z.string().max(2000).optional(),
});

// ── Rolls ──

export const createRollSchema = z.object({
  filmStockId: z.string().uuid(),
  cameraId: z.string().uuid().optional(),
  title: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  isoShotAt: z.number().int().positive().optional(),
  pushPullStops: z.number().optional(),
  frameCount: z.number().int().positive().optional(),
  tags: z.array(z.string()).optional(),
});

export const updateRollSchema = createRollSchema.partial();

export const rollStatusSchema = z.object({
  status: z.enum(ROLL_STATUSES),
});

// ── Frames ──

export const createFrameSchema = z.object({
  frameNumber: z.number().int().positive(),
  lensId: z.string().uuid().optional(),
  shutterSpeed: z.string().max(20).optional(),
  aperture: z.string().max(10).optional(),
  compensation: z.string().max(10).optional(),
  meteringMode: z.enum(METERING_MODES).optional(),
  subject: z.string().max(500).optional(),
  notes: z.string().max(2000).optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  locationName: z.string().max(200).optional(),
  tags: z.array(z.string()).optional(),
});

export const updateFrameSchema = createFrameSchema.partial();

// ── Development ──

export const createDevelopmentLogSchema = z.object({
  developer: z.string().min(1).max(100),
  dilution: z.string().max(50).optional(),
  devTimeSeconds: z.number().int().positive().optional(),
  temperatureC: z.number().optional(),
  agitation: z.string().max(500).optional(),
  stopBath: z.string().max(100).optional(),
  fixer: z.string().max(100).optional(),
  fixerTimeSeconds: z.number().int().positive().optional(),
  washMethod: z.string().max(200).optional(),
  wettingAgent: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
  developedAt: z.string().optional(),
  resultsRating: z.number().int().min(1).max(5).optional(),
  resultsNotes: z.string().max(2000).optional(),
});

// ── Notes ──

export const createNoteSchema = z.object({
  rollId: z.string().uuid().optional(),
  frameId: z.string().uuid().optional(),
  type: z.enum(NOTE_TYPES),
  content: z.string().max(5000).optional(),
});
