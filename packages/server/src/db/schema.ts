import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
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
  /** Default frame count for rolls loaded into this camera (e.g. 36 for 35mm, 10 for Mamiya 7 6x7, 1 for sheet). */
  frameCount: integer("frame_count"),
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
  /** Frame count for factory-loaded rolls of this stock (e.g. 29 for NoColorStudio no.5). Null = use format default. */
  frameCount: integer("frame_count"),
  /** Alternate names the fuzzy matcher should accept (e.g. ["NCS"] for NoColorStudio). */
  aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),
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
  /** Per-item frame count override. Used for bulk-spooled cassettes of varying length. Null falls back to stock/camera/format. */
  frameCount: integer("frame_count"),
  /** Per-item rated ISO — the target speed for shooting (e.g. expired stock the user wants to down-rate). Null = use stock box ISO at load. */
  ratedIso: integer("rated_iso"),
  /** Auto-assigned stable ID like "R001" for physically-tracked singletons. Unique per user when set. Copied to roll.title at load. */
  displayId: text("display_id"),
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

export const rolls = pgTable(
  "rolls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    cameraId: uuid("camera_id").references(() => cameras.id),
    filmStockId: uuid("film_stock_id").notNull().references(() => filmStocks.id),
    format: text("format").notNull(),
    form: text("form").notNull().default("factory_roll"),
    status: text("status").notNull().default("loaded"),
    loadedAt: timestamp("loaded_at", { withTimezone: true }),
    unloadedAt: timestamp("unloaded_at", { withTimezone: true }),
    /** Human-readable ID assigned at unload time, format: YYYYMMDD.N (local date, N = Nth roll unloaded that day). */
    displayId: text("display_id"),
    ratedIso: integer("rated_iso"),
    pushPullStops: numeric("push_pull_stops", { precision: 3, scale: 1 }),
    frameCount: integer("frame_count").notNull().default(36),
    title: text("title"),
    description: text("description"),
    tags: text("tags").array().notNull().default([]),
    devSessionId: uuid("dev_session_id").references((): any => devSessions.id, { onDelete: "set null" }),
    /** Intended dev recipe — captured from physical bag/canister labels or pre-planned ahead of session. */
    intendedDeveloper: text("intended_developer"),
    intendedDilution: text("intended_dilution"),
    intendedDilutionRaw: text("intended_dilution_raw"),
    intendedDevTimeSeconds: integer("intended_dev_time_seconds"),
    /** Date the roll was developed (local). Pairs with devSeq to form the Dev Id (YYYYMMDD.NNNN). */
    devDate: date("dev_date"),
    /** Cumulative lifetime dev sequence number. Never resets. Unique per user. */
    devSeq: integer("dev_seq"),
    ...timestamps,
  },
  (t) => [unique().on(t.userId, t.devSeq)]
);

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
//
// A dev_session represents one tank's worth of rolls developed together.
// Multiple rolls can share a session (same developer/dilution/time/temp).
// Per-session display IDs are assigned at create time, format YYYYMMDD.NN.

export const devSessions = pgTable("dev_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  displayId: text("display_id"),
  developer: text("developer").notNull(),
  /** Parsed dilution: "B", "1:50", "1:100", etc. */
  dilution: text("dilution"),
  /** Original shorthand the user entered, preserved for round-tripping: "B7.5", "1:50/8mins". */
  dilutionRaw: text("dilution_raw"),
  devTimeSeconds: integer("dev_time_seconds"),
  temperatureC: numeric("temperature_c", { precision: 4, scale: 1 }),
  agitation: text("agitation"),
  /** Free text: "MOD54", "Paterson 2-reel", "Jobo CPP-2". */
  tank: text("tank"),
  stopBath: text("stop_bath"),
  fixer: text("fixer"),
  fixerTimeSeconds: integer("fixer_time_seconds"),
  washMethod: text("wash_method"),
  wettingAgent: text("wetting_agent"),
  notes: text("notes"),
  developedAt: timestamp("developed_at", { withTimezone: true }),
  /** Set when status flips to completed; null while in progress. */
  completedAt: timestamp("completed_at", { withTimezone: true }),
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
    type: text("type"),
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

// ── Dev recipes (Massive Dev Chart) ──
//
// Tabular dev times scraped from MDC for the developers in the user's kit.
// filmStockId is resolved via fuzzy match during import; null means we couldn't
// find a matching stock in the user's collection (still kept for completeness).

export const devRecipes = pgTable("dev_recipes", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** The film name as it appears on MDC, e.g. "Ilford HP5+", "Eastman Double-X (5222)". */
  filmName: text("film_name").notNull(),
  /** Resolved film stock when the MDC name maps cleanly to a user's stock. */
  filmStockId: uuid("film_stock_id").references(() => filmStocks.id, { onDelete: "set null" }),
  developer: text("developer").notNull(),
  dilution: text("dilution").notNull(),
  asaIso: integer("asa_iso").notNull(),
  /** Times in seconds. Each format is independent; null when MDC didn't list one. */
  time35mmSec: integer("time_35mm_sec"),
  time120Sec: integer("time_120_sec"),
  timeSheetSec: integer("time_sheet_sec"),
  temperatureC: numeric("temperature_c", { precision: 4, scale: 1 }),
  /** True if the MDC row had [notes]. We don't ingest the actual note text. */
  hasNotes: boolean("has_notes").notNull().default(false),
  source: text("source").notNull(),
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
