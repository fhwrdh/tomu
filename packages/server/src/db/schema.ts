import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

// ── Users ──

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name"),
  ...timestamps,
});

// ── Gear ──

export const cameras = pgTable("cameras", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  make: text("make").notNull(),
  model: text("model").notNull(),
  format: text("format").notNull(),
  serialNumber: text("serial_number"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
});

export const lenses = pgTable("lenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  make: text("make").notNull(),
  model: text("model").notNull(),
  focalLengthMm: integer("focal_length_mm"),
  maxAperture: text("max_aperture"),
  serialNumber: text("serial_number"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
});

export const cameraLenses = pgTable(
  "camera_lenses",
  {
    cameraId: uuid("camera_id").notNull().references(() => cameras.id, { onDelete: "cascade" }),
    lensId: uuid("lens_id").notNull().references(() => lenses.id, { onDelete: "cascade" }),
  },
  (t) => [unique().on(t.cameraId, t.lensId)]
);

// ── Film ──

export const filmStocks = pgTable("film_stocks", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  manufacturer: text("manufacturer").notNull(),
  name: text("name").notNull(),
  iso: integer("iso").notNull(),
  type: text("type").notNull(),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
});

export const filmInventory = pgTable("film_inventory", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  filmStockId: uuid("film_stock_id").notNull().references(() => filmStocks.id, { onDelete: "cascade" }),
  format: text("format").notNull(),
  form: text("form").notNull().default("factory_roll"),
  quantity: integer("quantity").notNull().default(0),
  remainingLengthFt: numeric("remaining_length_ft", { precision: 8, scale: 1 }),
  originalLengthFt: numeric("original_length_ft", { precision: 8, scale: 1 }),
  expirationDate: text("expiration_date"),
  storageLocation: text("storage_location").notNull().default("fridge"),
  purchaseDate: text("purchase_date"),
  costPerRoll: numeric("cost_per_roll", { precision: 8, scale: 2 }),
  notes: text("notes"),
  ...timestamps,
});

// ── Rolls ──

export const rolls = pgTable("rolls", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  cameraId: uuid("camera_id").references(() => cameras.id),
  filmStockId: uuid("film_stock_id").notNull().references(() => filmStocks.id),
  rollNumber: integer("roll_number").notNull(),
  status: text("status").notNull().default("loaded"),
  loadedAt: timestamp("loaded_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  isoShotAt: integer("iso_shot_at"),
  pushPullStops: numeric("push_pull_stops", { precision: 3, scale: 1 }),
  frameCount: integer("frame_count").notNull().default(36),
  title: text("title"),
  description: text("description"),
  tags: text("tags").array().notNull().default([]),
  ...timestamps,
});

// ── Frames ──

export const frames = pgTable(
  "frames",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rollId: uuid("roll_id").notNull().references(() => rolls.id, { onDelete: "cascade" }),
    frameNumber: integer("frame_number").notNull(),
    lensId: uuid("lens_id").references(() => lenses.id),
    shutterSpeed: text("shutter_speed"),
    aperture: text("aperture"),
    compensation: text("compensation"),
    meteringMode: text("metering_mode"),
    subject: text("subject"),
    notes: text("notes"),
    latitude: numeric("latitude", { precision: 10, scale: 7 }),
    longitude: numeric("longitude", { precision: 10, scale: 7 }),
    locationName: text("location_name"),
    shotAt: timestamp("shot_at", { withTimezone: true }),
    tags: text("tags").array().notNull().default([]),
    rating: integer("rating"),
    isPortfolio: boolean("is_portfolio").notNull().default(false),
    ...timestamps,
  },
  (t) => [unique().on(t.rollId, t.frameNumber)]
);

// ── Development ──

export const developmentLogs = pgTable("development_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  rollId: uuid("roll_id").notNull().unique().references(() => rolls.id, { onDelete: "cascade" }),
  developer: text("developer").notNull(),
  dilution: text("dilution"),
  devTimeSeconds: integer("dev_time_seconds"),
  temperatureC: numeric("temperature_c", { precision: 4, scale: 1 }),
  agitation: text("agitation"),
  stopBath: text("stop_bath"),
  fixer: text("fixer"),
  fixerTimeSeconds: integer("fixer_time_seconds"),
  washMethod: text("wash_method"),
  wettingAgent: text("wetting_agent"),
  notes: text("notes"),
  developedAt: timestamp("developed_at", { withTimezone: true }),
  resultsRating: integer("results_rating"),
  resultsNotes: text("results_notes"),
  ...timestamps,
});

// ── Notes ──

export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    rollId: uuid("roll_id").references(() => rolls.id, { onDelete: "cascade" }),
    frameId: uuid("frame_id").references(() => frames.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    content: text("content"),
    fileKey: text("file_key"),
    fileUrl: text("file_url"),
    thumbnailUrl: text("thumbnail_url"),
    durationSeconds: integer("duration_seconds"),
    mimeType: text("mime_type"),
    fileSizeBytes: integer("file_size_bytes"),
    latitude: numeric("latitude", { precision: 10, scale: 7 }),
    longitude: numeric("longitude", { precision: 10, scale: 7 }),
    ...timestamps,
  },
  (t) => [check("note_parent_check", sql`${t.rollId} IS NOT NULL OR ${t.frameId} IS NOT NULL`)]
);

// ── Scans ──

export const scanners = pgTable("scanners", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  make: text("make"),
  model: text("model"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
});

export const scans = pgTable("scans", {
  id: uuid("id").primaryKey().defaultRandom(),
  frameId: uuid("frame_id").notNull().references(() => frames.id, { onDelete: "cascade" }),
  scannerId: uuid("scanner_id").references(() => scanners.id),
  fileKey: text("file_key").notNull(),
  fileUrl: text("file_url").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  originalFilename: text("original_filename"),
  mimeType: text("mime_type"),
  fileSizeBytes: integer("file_size_bytes"),
  widthPx: integer("width_px"),
  heightPx: integer("height_px"),
  dpi: integer("dpi"),
  bitDepth: integer("bit_depth"),
  colorSpace: text("color_space"),
  postProcessingNotes: text("post_processing_notes"),
  isPrimary: boolean("is_primary").notNull().default(false),
  ...timestamps,
});
