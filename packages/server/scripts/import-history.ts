/**
 * One-shot import of pre-Tomu development history (Dev Ids 0001–0716).
 *
 * Sources (staged in data/history/):
 *   - sheet_rows.json — parsed rows of the pre-Tomu Google Sheet dev log
 *     (Dev Ids 0367–0716 with film/camera/developer/dates/field ids)
 *   - lr_profiles.json — per-seq Lightroom keyword profiles
 *     (Dev Ids 0001–0735, image counts + co-keywords: film, camera, dev, format)
 *
 * Sheet wins where both exist; LR fills the pre-sheet era and enriches
 * frame counts. The seq is the identifier — dates are context (LR dates are
 * import-to-LR dates, accepted as close enough; decided 2026-06-07).
 *
 * Dry-run by default: prints a full report, writes data/history/import-report.json.
 * Pass --write to insert (take a DB backup first — see db-backups/ convention).
 *
 * Usage: cd packages/server && npx tsx scripts/import-history.ts [--write]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { and, eq, isNotNull } from "drizzle-orm";
import { parseDevShorthand } from "@tomu/shared";
import { db, pool } from "../src/db/client.js";
import { cameras, devSessions, filmStocks, rolls } from "../src/db/schema.js";

const WRITE = process.argv.includes("--write");
const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, "../../../data/history");
const IMPORT_TAG = "pre-tomu-import";

// ── Source data ──────────────────────────────────────────────────────────

interface SheetRow {
  row: number;
  section: string;
  status: string;
  devId: string;
  fieldId: string;
  film: string;
  iso: string;
  camera: string;
  locations: string;
  fieldNotes: string;
  dev: string;
  devParams: string;
  devNotes: string;
  results: string;
}

interface LrProfile {
  kw: string;
  date: string;
  images: number;
  co: Record<string, number>;
  lrDupes?: string[];
}

const sheetRows: SheetRow[] = JSON.parse(readFileSync(join(DATA, "sheet_rows.json"), "utf8"));
const lrProfiles: Record<string, LrProfile> = JSON.parse(
  readFileSync(join(DATA, "lr_profiles.json"), "utf8"),
);

// ── Conflict decision table ──────────────────────────────────────────────
// Historical double-assignments, adjudicated against LR scans 2026-07-07.
// Key: `${devIdRaw}|${fieldId}`. seq:null = roll imports without a Dev Id
// (the label lives on in the note); LR scan-truth keeps the number.

const DECISIONS: Record<string, { seq: number | null; note: string }> = {
  "20230422.0421|20230422.3": {
    seq: null,
    note: "Dev id 0421 double-assigned in sheet; 20230424.0421 (LR-confirmed) keeps it. This roll was dev'd 2023-04-22 (batch with 0420).",
  },
  "20230517.0443|20230503.1": {
    seq: null,
    note: "Dev id 0443 double-assigned: 2023-05-15 batch (0442–0444) owns it. LR keyword for this roll: 20230517.0443 (36 images).",
  },
  "20230517.0444a|20230516.1": {
    seq: null,
    note: "Sheet dev id '20230517.0444a' — 0444 was already taken by the 2023-05-15 batch. LR keyword: 20230517.0444a (21 images).",
  },
  "20240817.0624|20240803.2": {
    seq: null,
    note: "Dev id 0624 double-assigned to both 20240803.1 and 20240803.2 (same Arista batch). First keeps it; neither appears in LR.",
  },
  "20250204.0674|20250115.1": {
    seq: null,
    note: "Dev id 0674 double-assigned; 20250426.0674 (LR-confirmed) keeps it. This roll dev'd 2025-02-04 (batch 0666–0671; likely really 0668 or 0670, unconfirmed).",
  },
};

// Rows that cannot be imported as dev records (junk / unresolvable ids).
const SKIP_DEV_IDS = new Set(["20230802.A01"]);

// Illegible sheet dates, resolved to a best-effort date + explanatory note.
const FUZZY_DATES: Record<string, { date: string; note: string }> = {
  "202310??.0515": {
    date: "2023-10-31",
    note: "Sheet dev date illegible (202310??); dev'd between 2023-10-22 (shot) and 2023-11-08 (Dev Id 0516). Recorded as 2023-10-31, day unknown.",
  },
};

// ── Resolvers ────────────────────────────────────────────────────────────

/** film-string / LR-keyword → [manufacturer, name]. Lowercased key. */
const FILM_MAP: Record<string, [string, string]> = {
  hp5: ["Ilford", "HP5 Plus"],
  "hp5+": ["Ilford", "HP5 Plus"],
  fp4: ["Ilford", "FP4 Plus"],
  "fp4+": ["Ilford", "FP4 Plus"],
  panf: ["Ilford", "Pan F Plus"],
  "pan f": ["Ilford", "Pan F Plus"],
  "delta 100": ["Ilford", "Delta 100"],
  delta100: ["Ilford", "Delta 100"],
  "delta 400": ["Ilford", "Delta 400"],
  delta400: ["Ilford", "Delta 400"],
  "delta 3200": ["Ilford", "Delta 3200"],
  delta3200: ["Ilford", "Delta 3200"],
  xp2: ["Ilford", "XP2 Super"],
  "ortho plus": ["Ilford", "Ortho Plus"],
  ortho: ["Ilford", "Ortho Plus"],
  trix: ["Kodak", "Tri-X 400"],
  "tri-x": ["Kodak", "Tri-X 400"],
  "tri-x400": ["Kodak", "Tri-X 400"],
  "tri-x 400": ["Kodak", "Tri-X 400"],
  tmax100: ["Kodak", "T-Max 100"],
  "tmax 100": ["Kodak", "T-Max 100"],
  tmax400: ["Kodak", "T-Max 400"],
  "tmax 400": ["Kodak", "T-Max 400"],
  "tmax 3200": ["Kodak", "T-Max P3200"],
  tmax3200: ["Kodak", "T-Max P3200"],
  p3200: ["Kodak", "T-Max P3200"],
  ektapan: ["Kodak", "Ektapan"],
  "double-x": ["Kodak", "Double-X 5222"],
  xx: ["Kodak", "Double-X 5222"],
  kodak5222: ["Kodak", "Double-X 5222"],
  "5222": ["Kodak", "Double-X 5222"],
  portra: ["Kodak", "Portra 400"],
  "portra 400": ["Kodak", "Portra 400"],
  "portra 800": ["Kodak", "Portra 800"],
  ektar: ["Kodak", "Ektar 100"],
  "tech pan": ["Kodak", "Technical Pan"],
  acros: ["Fujifilm", "Acros II 100"],
  acros100: ["Fujifilm", "Acros II 100"],
  "acros ii": ["Fujifilm", "Acros II 100"],
  "kentmere 100": ["Kentmere", "Pan 100"],
  kentmere100: ["Kentmere", "Pan 100"],
  "kentmere 200": ["Kentmere", "Pan 200"],
  "kentmere 400": ["Kentmere", "Kentmere Pan 400"],
  "cat 320": ["CatLABS", "X Film 320 Pro"],
  cat320: ["CatLABS", "X Film 320 Pro"],
  catlabs: ["CatLABS", "X Film 320 Pro"],
  no5: ["NoColorStudio", "no.5"],
  "no. 5": ["NoColorStudio", "no.5"],
  "no.5": ["NoColorStudio", "no.5"],
  "no.10": ["NoColorStudio", "No.10"],
  no10: ["NoColorStudio", "No.10"],
  "no.25": ["NoColorStudio", "no.25 Gamma"],
  "arista edu 100": ["Arista", "EDU Ultra 100"],
  "arista 100": ["Arista", "EDU Ultra 100"],
  "arista edu 400": ["Arista", "EDU 400 DX"],
  "arista 400": ["Arista", "EDU 400 DX"],
  orto: ["Ferrania", "Orto"],
  p30: ["Ferrania", "P30"],
  p33: ["Ferrania", "P33"],
  streetpan: ["Japan Camera Hunter", "StreetPan 400"],
  washi: ["Film Washi", "F"],
  "washi f": ["Film Washi", "F"],
  fomapan: ["Foma", "Fomapan 400"],
  "fomapan 400": ["Foma", "Fomapan 400"],
  "foma 400": ["Foma", "Fomapan 400"],
  gp3: ["Shanghai", "GP3 100"],
  shanghai: ["Shanghai", "GP3 100"],
  rpx25: ["Rollei", "RPX 25"],
  "rpx 25": ["Rollei", "RPX 25"],
  "retro 400s": ["Rollei", "Retro 400S"],
  phoenix: ["Harman", "Phoenix 200"],
  koji: ["Atlanta Film Co", "Koji 125T"],
  moodys: ["Moody's", "400T"],
  "moody's": ["Moody's", "400T"],
  // sheet shorthands
  xx250: ["Kodak", "Double-X 5222"],
  "atl bwxx": ["Kodak", "Double-X 5222"],
  "cs bwxx": ["Kodak", "Double-X 5222"],
  bwxx: ["Kodak", "Double-X 5222"],
  d400: ["Ilford", "Delta 400"],
  d100: ["Ilford", "Delta 100"],
  d3200: ["Ilford", "Delta 3200"],
  kentmere400: ["Kentmere", "Kentmere Pan 400"],
  kentemere400: ["Kentmere", "Kentmere Pan 400"],
  kent200: ["Kentmere", "Pan 200"],
  k100: ["Kentmere", "Pan 100"],
  panf50: ["Ilford", "Pan F Plus"],
  jch: ["Japan Camera Hunter", "StreetPan 400"],
  jch400: ["Japan Camera Hunter", "StreetPan 400"],
  ortho80: ["Ilford", "Ortho Plus"],
  orta50: ["Ferrania", "Orto"],
  orto50: ["Ferrania", "Orto"],
  techpan: ["Kodak", "Technical Pan"],
  tp: ["Kodak", "Technical Pan"],
  "nocolour gamma 25": ["NoColorStudio", "no.25 Gamma"],
  "gamma 25": ["NoColorStudio", "no.25 Gamma"],
  rpx25o: ["Rollei", "RPX 25"],
};

/** New stocks the history references that don't exist yet. Created on --write. */
const NEW_STOCKS: Record<string, { manufacturer: string; name: string; iso: number; type: string }> = {
  "rollei 100": { manufacturer: "Rollei", name: "RPX 100", iso: 100, type: "bw" },
  rpx100: { manufacturer: "Rollei", name: "RPX 100", iso: 100, type: "bw" },
  txp220: { manufacturer: "Kodak", name: "Tri-X Pan 320", iso: 320, type: "bw" },
  "foma 100": { manufacturer: "Foma", name: "Fomapan 100", iso: 100, type: "bw" },
  foma100: { manufacturer: "Foma", name: "Fomapan 100", iso: 100, type: "bw" },
  "foma 200": { manufacturer: "Foma", name: "Fomapan 200", iso: 200, type: "bw" },
  foma200: { manufacturer: "Foma", name: "Fomapan 200", iso: 200, type: "bw" },
  "plusx 125": { manufacturer: "Kodak", name: "Plus-X Pan 125", iso: 125, type: "bw" },
  "plus x-pan 125": { manufacturer: "Kodak", name: "Plus-X Pan 125", iso: 125, type: "bw" },
  "plus-x pan": { manufacturer: "Kodak", name: "Plus-X Pan 125", iso: 125, type: "bw" },
  plusx: { manufacturer: "Kodak", name: "Plus-X Pan 125", iso: 125, type: "bw" },
  "verichrome pan 125": { manufacturer: "Kodak", name: "Verichrome Pan", iso: 125, type: "bw" },
  "verichrome pan": { manufacturer: "Kodak", name: "Verichrome Pan", iso: 125, type: "bw" },
  "rollei blackbird": { manufacturer: "Rollei", name: "Blackbird", iso: 64, type: "bw" },
  blackbird: { manufacturer: "Rollei", name: "Blackbird", iso: 64, type: "bw" },
  "earl grey 100": { manufacturer: "Unknown", name: "Earl Grey 100", iso: 100, type: "bw" },
  santarae1000: { manufacturer: "Santa Rae", name: "1000", iso: 1000, type: "bw" },
};

/** camera string / LR keyword → [make, model] as they appear in the cameras table. */
const CAMERA_MAP: Record<string, [string, string]> = {
  m6: ["Leica", "M6"],
  leicam6: ["Leica", "M6"],
  leica: ["Leica", "M6"],
  mm7: ["Mamiya", "7"],
  mamiya7: ["Mamiya", "7"],
  mamiya7ii: ["Mamiya", "7"],
  "mamiya 7": ["Mamiya", "7"],
  p67: ["Pentax", "67"],
  pentax67: ["Pentax", "67"],
  "pentax 67": ["Pentax", "67"],
  f3: ["Nikon", "F3"],
  "nikon f3": ["Nikon", "F3"],
  nikonos: ["Nikon", "Nikonos V"],
  nikonosv: ["Nikon", "Nikonos V"],
  "nikonos v": ["Nikon", "Nikonos V"],
  xa: ["Olympus", "XA"],
  "xa(ii)": ["Olympus", "XA"],
  "olympus xa": ["Olympus", "XA"],
  "pen ft": ["Olympus", "Pen FT"],
  penft: ["Olympus", "Pen FT"],
  crown: ["Graflex", "Crown Graphic 4x5"],
  cg: ["Graflex", "Crown Graphic 4x5"],
  graflex: ["Graflex", "Crown Graphic 4x5"],
  intrepid: ["Intrepid", "4x5"],
};

/** Historical gear that predates Tomu — created as isActive:false on --write. */
const NEW_CAMERAS: Record<string, { make: string; model: string; format: string }> = {
  "canon f-1": { make: "Canon", model: "F-1", format: "35mm" },
  cf1: { make: "Canon", model: "F-1", format: "35mm" },
  "cf-1": { make: "Canon", model: "F-1", format: "35mm" },
  "canon ae-1": { make: "Canon", model: "AE-1", format: "35mm" },
  ae1: { make: "Canon", model: "AE-1", format: "35mm" },
  "canonet ql17": { make: "Canon", model: "Canonet QL17", format: "35mm" },
  canonet: { make: "Canon", model: "Canonet QL17", format: "35mm" },
  iiia: { make: "Leica", model: "IIIa", format: "35mm" },
  "rollei 35": { make: "Rollei", model: "35", format: "35mm" },
  r35: { make: "Rollei", model: "35", format: "35mm" },
  ftn2: { make: "Nikon", model: "FTn2", format: "35mm" },
  samurai3: { make: "Yashica", model: "Samurai X3.0", format: "35mm" },
  "samurai 3": { make: "Yashica", model: "Samurai X3.0", format: "35mm" },
  samurai: { make: "Yashica", model: "Samurai X3.0", format: "35mm" },
  x700: { make: "Minolta", model: "X-700", format: "35mm" },
  holga135: { make: "Holga", model: "135", format: "35mm" },
  tlrholga: { make: "Holga", model: "120 TLR", format: "120" },
  electro: { make: "Yashica", model: "Electro 35", format: "35mm" },
  "jiffy 620": { make: "Kodak", model: "Jiffy Six-20", format: "120" },
  jiffy: { make: "Kodak", model: "Jiffy Six-20", format: "120" },
  "chroma cube": { make: "Chroma", model: "Cube", format: "4x5" },
  holgon: { make: "Holga", model: "120N", format: "120" },
};

/** LR developer keywords → [developer, dilution]. */
const LR_DEV_MAP: Record<string, [string, string | null]> = {
  hc110: ["HC-110", null],
  hc110b: ["HC-110", "B"],
  hc11b: ["HC-110", "B"],
  hc110e: ["HC-110", "E"],
  hc110f: ["HC-110", "F"],
  hc110h: ["HC-110", "H"],
  hc110dh: ["HC-110", "H"],
  "510pyro": ["510 Pyro", null],
  "d76.1:1": ["D-76", "1:1"],
  d76: ["D-76", null],
  rodinal: ["Rodinal", null],
  "rodinal 1:50": ["Rodinal", "1:50"],
};

function normFieldId(fid: string): string | null {
  const m = fid.trim().match(/^(\d{8})\.0*(\d+)$/);
  if (!m) return null;
  return `${m[1]}.${String(Number(m[2])).padStart(2, "0")}`;
}

/** Pull "@800" / "[@400]" rated-iso markers out of a film string. */
function extractRatedIso(s: string): { cleaned: string; ratedIso: number | null } {
  const m = s.match(/\[?@\s*(\d+(?:\.\d+)?)\s*\]?/);
  if (!m) return { cleaned: s.trim(), ratedIso: null };
  return {
    cleaned: s.replace(m[0], "").replace(/\s{2,}/g, " ").trim(),
    ratedIso: Math.round(Number(m[1])) || null,
  };
}

// ── Record assembly ──────────────────────────────────────────────────────

interface ImportRecord {
  seq: number | null;
  devDate: string;
  fieldId: string | null;
  displayId: string | null; // normalized field id, nulled on collision
  source: "sheet" | "sheet+lr" | "lr";
  filmRaw: string | null;
  stockKey: string | null; // resolved "Manufacturer|Name"
  ratedIso: number | null;
  cameraRaw: string | null;
  cameraKey: string | null;
  format: string;
  frameCount: number;
  developer: string | null;
  dilution: string | null;
  dilutionRaw: string | null;
  devTimeSeconds: number | null;
  lrKeyword: string | null;
  lrImages: number | null;
  notes: string[];
  anomalies: string[];
}

const records: ImportRecord[] = [];
const report = {
  skipped: [] as string[],
  unmappedFilm: new Map<string, number>(),
  unmappedCamera: new Map<string, number>(),
  displayIdCollisions: [] as string[],
};

const seenSheetKeys = new Set<string>();
const sheetBySeq = new Map<number, ImportRecord>();

for (const row of sheetRows) {
  if (row.section !== "DEV" && row.section !== "SCAN") continue;
  const devIdRaw = row.devId.trim();
  if (SKIP_DEV_IDS.has(devIdRaw)) {
    report.skipped.push(`sheet row ${row.row}: unresolvable dev id "${devIdRaw}"`);
    continue;
  }

  // "202310??.0515" — date unknown, seq good; LR supplies the date below.
  const fuzzy = devIdRaw.match(/^\d{4}[\d?]{2,4}\.(\d{3,4})$/);
  const strict = devIdRaw.match(/^(\d{4})(\d{2})(\d{2})\.(\d{3,4})(?:\s*\*)?(a)?$/);
  if (!strict && !fuzzy) {
    if (/\d{8}\./.test(devIdRaw)) report.skipped.push(`sheet row ${row.row}: unparsed dev id "${devIdRaw}"`);
    continue;
  }

  const key = `${devIdRaw}|${row.fieldId}`;
  if (seenSheetKeys.has(key)) continue; // literal duplicate row (0372)
  seenSheetKeys.add(key);

  let seq: number | null = strict ? Number(strict[4]) : Number(fuzzy![1]);
  let devDate: string;
  const notes: string[] = [];
  const anomalies: string[] = [];

  const decision = DECISIONS[key];
  if (decision) {
    seq = decision.seq;
    notes.push(decision.note);
  }
  if (strict) {
    devDate = `${strict[1]}-${strict[2]}-${strict[3]}`;
    if (strict[0].includes("*")) notes.push(`Sheet dev id was starred: "${devIdRaw}".`);
    if (strict[5] === "a") seq = decision ? seq : null; // 0444a handled via DECISIONS
  } else {
    const fixed = FUZZY_DATES[devIdRaw];
    const lr = seq != null ? lrProfiles[String(seq)] : undefined;
    devDate = fixed?.date ?? lr?.date ?? "";
    notes.push(fixed?.note ?? `Sheet dev id "${devIdRaw}" had an unreadable date; used LR keyword date.`);
    if (!devDate) {
      report.skipped.push(`sheet row ${row.row}: "${devIdRaw}" — no date recoverable (not in LR either)`);
      continue;
    }
  }

  const { cleaned: filmCleaned, ratedIso: filmIso } = extractRatedIso(row.film);
  // "HP5[@1600]           24" — trailing bare number is a frame count note
  const fc = filmCleaned.match(/^(.*?)\s{2,}(\d{1,3})$/);
  const filmName = (fc ? fc[1] : filmCleaned).trim();
  const isoCol = Number(row.iso);
  const ratedIso = filmIso ?? (Number.isFinite(isoCol) && isoCol > 0 ? isoCol : null);

  const parsed = row.devParams ? parseDevShorthand(row.devParams) : null;
  // Letter-code params imply HC-110 (standing convention)
  const developer =
    row.dev ||
    (parsed?.dilution && /^[A-H]$/.test(parsed.dilution) ? "HC-110" : null);

  records.push({
    seq,
    devDate,
    fieldId: row.fieldId || null,
    displayId: null, // assigned after collision check
    source: "sheet",
    filmRaw: row.film || null,
    stockKey: null,
    ratedIso,
    cameraRaw: row.camera || null,
    cameraKey: null,
    format: "", // resolved below
    frameCount: 0,
    developer: developer === "HC110" ? "HC-110" : developer,
    dilution: parsed?.dilution ?? null,
    dilutionRaw: row.devParams || null,
    devTimeSeconds: parsed?.devTimeSeconds ?? null,
    lrKeyword: null,
    lrImages: null,
    notes: [
      ...notes,
      ...(row.locations ? [`Locations: ${row.locations}`] : []),
      ...(row.fieldNotes ? [`Field notes: ${row.fieldNotes}`] : []),
      ...(row.devNotes ? [`Dev notes: ${row.devNotes}`] : []),
      ...(row.results ? [`Results: ${row.results}`] : []),
      ...(row.status ? [`Sheet status/scan-order: ${row.status}`] : []),
      ...(filmName ? [] : ["Film not recorded in sheet."]),
      `Imported ${new Date().toISOString().slice(0, 10)} from pre-Tomu dev log sheet (row ${row.row}).`,
    ],
    anomalies,
  });
  const rec = records[records.length - 1];
  rec.filmRaw = filmName || row.film || null;
  if (seq != null) sheetBySeq.set(seq, rec);
}

// LR-only seqs (pre-sheet era + sheet gaps). Skip 717+ (already in Tomu).
for (const [seqStr, p] of Object.entries(lrProfiles)) {
  const seq = Number(seqStr);
  if (seq >= 717 || sheetBySeq.has(seq)) continue;
  records.push({
    seq,
    devDate: p.date,
    fieldId: null,
    displayId: null,
    source: "lr",
    filmRaw: null,
    stockKey: null,
    ratedIso: null,
    cameraRaw: null,
    cameraKey: null,
    format: "",
    frameCount: 0,
    developer: null,
    dilution: null,
    dilutionRaw: null,
    devTimeSeconds: null,
    lrKeyword: p.kw,
    lrImages: p.images,
    notes: [
      `Imported ${new Date().toISOString().slice(0, 10)} from Lightroom catalog keyword ${p.kw} (${p.images} images). Date is LR-import date, not true dev date.`,
      ...(p.lrDupes?.length ? [`LR also has duplicate keyword(s): ${p.lrDupes.join(", ")}.`] : []),
    ],
    anomalies: [],
  });
}

// Enrich sheet records with their LR profile; resolve film/camera/format for all.
const timeKw = (co: Record<string, number>) => {
  for (const k of Object.keys(co)) {
    const m = k.match(/^@(\d+(?:\.\d+)?)mins$/);
    if (m) return Math.round(Number(m[1]) * 60);
  }
  return null;
};

for (const rec of records) {
  const lr = rec.seq != null ? lrProfiles[String(rec.seq)] : undefined;
  if (lr && rec.source === "sheet") {
    rec.source = "sheet+lr";
    rec.lrKeyword = lr.kw;
    rec.lrImages = lr.images;
    if (lr.date !== rec.devDate) {
      rec.notes.push(`LR keyword date ${lr.date} differs from sheet dev date ${rec.devDate}; sheet wins.`);
    }
  }
  const co = lr?.co ?? {};
  const coKeys = Object.keys(co).map((k) => k.toLowerCase());

  // Film: sheet string first, then LR keywords
  if (rec.filmRaw) {
    const cleanFilm = (s: string) =>
      s
        .toLowerCase()
        .replace(/\s*\/\s*(19|20)\d\d.*$/, "") // "/ 1976" expiry
        .replace(/\((19|20)\d\d\)/, "") // "(1976)"
        .replace(/\(\+[^)]*\)/, "") // "(+Red25)" filter notes
        .replace(/@\?\d+/, "") // "@?400"
        .replace(/(\d)\s*x\s*\d+\s*\??\??$/, "$1") // "HP5x10" / "FP4x4??" multi-roll marker (digit before x, so RPX25 survives)
        .replace(/\s*\biso\b\s*$/, "")
        .replace(/^(kodak|ilford|ferrania|rollei|foma|fujifilm|fuji)\s+/, "")
        .replace(/\s{2,}/g, " ")
        .trim();
    const filmLower = cleanFilm(rec.filmRaw);
    const lookup = (key: string): string | null => {
      const hit = FILM_MAP[key] ?? Object.entries(FILM_MAP).find(([k]) => key === k || key.startsWith(k + " "))?.[1];
      if (hit) return hit.join("|");
      const ns = NEW_STOCKS[key];
      return ns ? `${ns.manufacturer}|${ns.name}` : null;
    };
    rec.stockKey = lookup(rec.filmRaw.toLowerCase().trim()) ?? lookup(filmLower);
    if (!rec.stockKey) {
      report.unmappedFilm.set(rec.filmRaw, (report.unmappedFilm.get(rec.filmRaw) ?? 0) + 1);
      rec.notes.push(`Film string: "${rec.filmRaw}" (unresolved — placeholder stock used).`);
    } else if (cleanFilm(rec.filmRaw) !== rec.filmRaw.toLowerCase().trim()) {
      rec.notes.push(`Film string: "${rec.filmRaw}".`);
    }
  }
  if (!rec.stockKey) {
    for (const k of coKeys) {
      const { cleaned, ratedIso } = extractRatedIso(k); // "hp5@800"
      const hit = FILM_MAP[cleaned];
      if (hit) {
        rec.stockKey = hit.join("|");
        if (ratedIso && rec.ratedIso == null) rec.ratedIso = ratedIso;
        if (!rec.filmRaw) rec.filmRaw = k;
        break;
      }
    }
  }

  // Camera: existing gear, then historical gear (created on --write)
  let newCamFormat: string | null = null;
  const resolveCam = (key: string): boolean => {
    const hit = CAMERA_MAP[key];
    if (hit) {
      rec.cameraKey = hit.join("|");
      return true;
    }
    const nc = NEW_CAMERAS[key];
    if (nc) {
      rec.cameraKey = `${nc.make}|${nc.model}`;
      newCamFormat = nc.format;
      return true;
    }
    return false;
  };
  const camRaw = rec.cameraRaw?.toLowerCase().split("/")[0].trim();
  if (camRaw && !resolveCam(camRaw)) {
    report.unmappedCamera.set(rec.cameraRaw!, (report.unmappedCamera.get(rec.cameraRaw!) ?? 0) + 1);
    rec.notes.push(`Camera string: "${rec.cameraRaw}" (unresolved).`);
  }
  if (!rec.cameraKey) {
    for (const k of coKeys) {
      if (resolveCam(k)) {
        if (!rec.cameraRaw) rec.cameraRaw = k;
        break;
      }
    }
  }

  // Format: camera format > LR format keywords > default 35mm
  const camFormat = rec.cameraKey
    ? newCamFormat ??
      { "Mamiya|7": "120", "Pentax|67": "120", "Graflex|Crown Graphic 4x5": "4x5", "Intrepid|4x5": "4x5" }[rec.cameraKey] ??
      "35mm"
    : null;
  rec.format =
    camFormat ??
    (coKeys.some((k) => ["120", "6x7", "6x6", "645", "medium format"].includes(k))
      ? "120"
      : coKeys.some((k) => k === "4x5" || k === "large format")
        ? "4x5"
        : "35mm");

  // Frame count: LR images when plausible, else format default
  const fmtDefault = rec.format === "120" ? 10 : rec.format === "4x5" ? 1 : 36;
  rec.frameCount = rec.lrImages && rec.lrImages > 0 ? rec.lrImages : fmtDefault;

  // Developer from LR when sheet had none
  if (!rec.developer) {
    for (const k of coKeys) {
      const hit = LR_DEV_MAP[k];
      if (hit) {
        rec.developer = hit[0];
        if (!rec.dilution) rec.dilution = hit[1];
        break;
      }
    }
    if (rec.devTimeSeconds == null && lr) rec.devTimeSeconds = timeKw(co);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const [user] = await db.select().from(rolls).limit(1);
  const userId = user?.userId;
  if (!userId) throw new Error("No rolls in DB to infer user from");

  const stocks = await db.select().from(filmStocks);
  const stockIdByKey = new Map(stocks.map((s) => [`${s.manufacturer}|${s.name}`, s.id]));
  const cams = await db.select().from(cameras);
  const camIdByKey = new Map(cams.map((c) => [`${c.make}|${c.model}`, c.id])); // dupes: last wins

  const existingRolls = await db
    .select({ displayId: rolls.displayId, devSeq: rolls.devSeq })
    .from(rolls)
    .where(eq(rolls.userId, userId));
  const takenDisplayIds = new Set(existingRolls.map((r) => r.displayId).filter(Boolean) as string[]);
  const takenSeqs = new Set(existingRolls.map((r) => r.devSeq).filter((s) => s != null) as number[]);

  const existingSessions = await db
    .select({ displayId: devSessions.displayId })
    .from(devSessions)
    .where(and(eq(devSessions.userId, userId), isNotNull(devSessions.displayId)));
  const takenSessionIds = new Set(existingSessions.map((s) => s.displayId) as string[]);

  // Guard: never import a seq Tomu already has
  for (const rec of records) {
    if (rec.seq != null && takenSeqs.has(rec.seq)) {
      rec.anomalies.push(`seq ${rec.seq} already exists in Tomu — importing without seq`);
      rec.seq = null;
    }
  }

  // Display ids: normalized field id, first-come-first-served, collisions → null
  for (const rec of records.slice().sort((a, b) => (a.seq ?? 99999) - (b.seq ?? 99999))) {
    if (!rec.fieldId) continue;
    const norm = normFieldId(rec.fieldId);
    if (!norm) {
      rec.notes.push(`Field id "${rec.fieldId}" unparseable; kept in note only.`);
      continue;
    }
    if (takenDisplayIds.has(norm)) {
      rec.notes.push(`Field id ${rec.fieldId} collides with existing display id ${norm}; left unset.`);
      report.displayIdCollisions.push(`${norm} (seq ${rec.seq ?? "—"})`);
    } else {
      rec.displayId = norm;
      takenDisplayIds.add(norm);
    }
  }

  // Dev sessions: group by (devDate, developer, dilutionRaw-or-dilution, time)
  const sessionKey = (r: ImportRecord) =>
    r.developer ? `${r.devDate}|${r.developer}|${r.dilutionRaw ?? r.dilution ?? ""}|${r.devTimeSeconds ?? ""}` : null;
  const sessionGroups = new Map<string, ImportRecord[]>();
  for (const rec of records) {
    const k = sessionKey(rec);
    if (!k) continue;
    if (!sessionGroups.has(k)) sessionGroups.set(k, []);
    sessionGroups.get(k)!.push(rec);
  }

  // ── Report ──
  const bySource = { sheet: 0, "sheet+lr": 0, lr: 0 };
  let noSeq = 0,
    noStock = 0,
    noCamera = 0;
  for (const r of records) {
    bySource[r.source]++;
    if (r.seq == null) noSeq++;
    if (!r.stockKey) noStock++;
    if (!r.cameraKey) noCamera++;
  }
  console.log(`\n=== Pre-Tomu history import ${WRITE ? "(WRITE)" : "(dry run)"} ===`);
  console.log(`records: ${records.length}  (sheet+lr ${bySource["sheet+lr"]}, sheet-only ${bySource.sheet}, lr-only ${bySource.lr})`);
  const seqs = records.map((r) => r.seq).filter((s) => s != null) as number[];
  console.log(`seq coverage: ${Math.min(...seqs)}–${Math.max(...seqs)} (${seqs.length} with seq, ${noSeq} without)`);
  console.log(`film resolved: ${records.length - noStock}/${records.length}; camera resolved: ${records.length - noCamera}/${records.length}`);
  console.log(`dev sessions to create: ${sessionGroups.size}`);
  console.log(`\nunmapped film strings:`);
  for (const [k, v] of [...report.unmappedFilm].sort((a, b) => b[1] - a[1])) console.log(`  ${v}× ${JSON.stringify(k)}`);
  console.log(`unmapped cameras:`);
  for (const [k, v] of [...report.unmappedCamera].sort((a, b) => b[1] - a[1])) console.log(`  ${v}× ${JSON.stringify(k)}`);
  console.log(`display id collisions: ${report.displayIdCollisions.length}`);
  for (const c of report.displayIdCollisions) console.log(`  ${c}`);
  console.log(`skipped rows:`);
  for (const s of report.skipped) console.log(`  ${s}`);
  const anomalous = records.filter((r) => r.anomalies.length);
  if (anomalous.length) {
    console.log(`anomalies:`);
    for (const r of anomalous) console.log(`  seq ${r.seq}: ${r.anomalies.join("; ")}`);
  }

  writeFileSync(
    join(DATA, "import-report.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        write: WRITE,
        counts: { records: records.length, bySource, noSeq, noStock, noCamera, sessions: sessionGroups.size },
        unmappedFilm: Object.fromEntries(report.unmappedFilm),
        unmappedCamera: Object.fromEntries(report.unmappedCamera),
        displayIdCollisions: report.displayIdCollisions,
        skipped: report.skipped,
        records,
      },
      null,
      1,
    ),
  );
  console.log(`\nfull report → data/history/import-report.json`);

  if (!WRITE) {
    console.log("\nDry run — nothing written. Re-run with --write to import.");
    await pool.end();
    return;
  }

  // ── Write ──
  await db.transaction(async (tx) => {
    // Placeholder + new stocks
    const ensureStock = async (manufacturer: string, name: string, iso: number, type: string) => {
      const key = `${manufacturer}|${name}`;
      if (stockIdByKey.has(key)) return stockIdByKey.get(key)!;
      const [row] = await tx
        .insert(filmStocks)
        .values({ userId, manufacturer, name, iso, type, notes: `Created by pre-Tomu history import ${new Date().toISOString().slice(0, 10)}.` })
        .returning({ id: filmStocks.id });
      stockIdByKey.set(key, row.id);
      return row.id;
    };
    for (const ns of Object.values(NEW_STOCKS)) await ensureStock(ns.manufacturer, ns.name, ns.iso, ns.type);
    const unknownStockId = await ensureStock("Unknown", "Pre-Tomu unidentified", 400, "bw");

    // Historical cameras (retired gear) — created inactive
    const neededCams = new Set(records.map((r) => r.cameraKey).filter(Boolean) as string[]);
    for (const nc of Object.values(NEW_CAMERAS)) {
      const key = `${nc.make}|${nc.model}`;
      if (!neededCams.has(key) || camIdByKey.has(key)) continue;
      const [row] = await tx
        .insert(cameras)
        .values({
          userId,
          make: nc.make,
          model: nc.model,
          format: nc.format,
          isActive: false,
          notes: `Created by pre-Tomu history import ${new Date().toISOString().slice(0, 10)} (retired gear referenced by historical rolls).`,
        })
        .returning({ id: cameras.id });
      camIdByKey.set(key, row.id);
    }

    // Sessions first
    const sessionIdByKey = new Map<string, string>();
    const sessionSeqByDate = new Map<string, number>();
    for (const [key, group] of sessionGroups) {
      const r = group[0];
      const ymd = r.devDate.replace(/-/g, "");
      let n = sessionSeqByDate.get(ymd) ?? 0;
      let display: string;
      do {
        n++;
        display = `${ymd}.${String(n).padStart(2, "0")}`;
      } while (takenSessionIds.has(display));
      sessionSeqByDate.set(ymd, n);
      takenSessionIds.add(display);
      const [row] = await tx
        .insert(devSessions)
        .values({
          userId,
          displayId: display,
          developer: r.developer!,
          dilution: r.dilution,
          dilutionRaw: r.dilutionRaw,
          devTimeSeconds: r.devTimeSeconds,
          developedAt: new Date(`${r.devDate}T12:00:00`),
          completedAt: new Date(`${r.devDate}T12:00:00`),
          notes: `Pre-Tomu history import (${group.length} roll${group.length === 1 ? "" : "s"}).`,
        })
        .returning({ id: devSessions.id });
      sessionIdByKey.set(key, row.id);
    }

    for (const rec of records) {
      const stockId = rec.stockKey ? stockIdByKey.get(rec.stockKey)! : unknownStockId;
      const cameraId = rec.cameraKey ? camIdByKey.get(rec.cameraKey) ?? null : null;
      const sKey = sessionKey(rec);
      await tx.insert(rolls).values({
        userId,
        cameraId,
        filmStockId: stockId,
        format: rec.format,
        form: rec.format === "4x5" ? "sheet" : "factory_roll",
        status: "archived",
        displayId: rec.displayId,
        ratedIso: rec.ratedIso,
        frameCount: rec.frameCount,
        tags: [IMPORT_TAG],
        devSessionId: sKey ? sessionIdByKey.get(sKey) ?? null : null,
        intendedDeveloper: rec.developer,
        intendedDilution: rec.dilution,
        intendedDilutionRaw: rec.dilutionRaw,
        intendedDevTimeSeconds: rec.devTimeSeconds,
        devDate: rec.devDate,
        devSeq: rec.seq,
        description: rec.notes.join("\n"),
        unloadedAt: new Date(`${rec.devDate}T12:00:00`),
      });
    }
  });

  console.log(`\nWrote ${records.length} rolls + ${sessionGroups.size} dev sessions.`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
