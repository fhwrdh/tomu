# Field Captures V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store spoken exposure settings from the field as pending "captures", attach the matching iPhone photo later by timestamp, and turn each capture into a real frame on a roll after development.

**Architecture:** A new `captures` table and `/api/v1/captures` routes on the Fastify server; three MCP tools for the phone workflow; a laptop script that matches Photos-library images to captures by time (via `osxphotos`) and uploads them to the droplet's disk; a read-only pending list in the roll detail UI. All pure logic (id formatting, photo matching, capture→frame mapping) lives in `packages/shared` so it sits inside the existing Vitest coverage gate.

**Tech Stack:** TypeScript, Fastify 5, Drizzle ORM + Postgres 16, Zod, `@fastify/multipart`, `@fastify/static`, `image-size`, MCP SDK, React 18 + TanStack Query, Vitest, `osxphotos` (Python CLI, laptop only).

**Spec:** `docs/superpowers/specs/2026-09-06-field-captures-design.md`

## Global Constraints

- Postgres 16, Node 22 LTS in prod; local dev may run newer Node.
- All API responses wrapped in `{ data: ... }`; Zod `.parse()` in routes, the global error handler maps `ZodError` to 400.
- Every route is JWT-protected by the existing `authPlugin`; `request.userId` is the caller.
- Shared types come from `@tomu/shared`; run `npm run build:shared` after changing it before server/client/mcp will see the change.
- Capture id display format is `C` + integer, no padding: `C412`. Parsing accepts `C412`, `c412`, `412`.
- Photo match window: `[captured_at − 10 min, captured_at + 2 min]`; nearest wins, ties prefer *before*; ambiguity when the two nearest candidates are within 30 s of each other.
- Uploads root: env `UPLOADS_DIR`, default `<repo>/uploads`; capture files at `captures/<captureId>.jpg`; public URL `/uploads/captures/<captureId>.jpg`. Max upload 25 MB, JPEG only.
- Never touch the droplet (nginx, `db:push` on prod) without owner approval; that step is called out and gated.
- Before any local `db:push`, snapshot the dev DB into `db-backups/` with a timestamped name (never overwrite `scripts/dev-snapshot.sql`).
- Commit messages: conventional prefix, end with the `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01Q6jMVz9nSKsnyFxZP939Xi` trailers. Work on branch `feat/field-captures` (already exists, holds the spec commit).
- Metering mode is stored as free text on captures (`max 30`) — the field path is liberal; `frames.metering_mode` stays whatever the capture said (it is a text column).

## File map

| Path | Responsibility |
|---|---|
| `packages/shared/src/capture.ts` | `formatCaptureId`, `parseCaptureId`, `captureToFrame` — pure |
| `packages/shared/src/photo-match.ts` | `matchPhotos` — pure time matcher used by the laptop script |
| `packages/shared/src/types.ts` | `Capture`, `CaptureStatus` types (append) |
| `packages/shared/src/schemas.ts` | `createCaptureSchema`, `updateCaptureSchema`, `assignCaptureSchema`, `capturePhotoMetaSchema` (append) |
| `packages/shared/src/index.ts` | export the two new modules |
| `packages/shared/test/capture.test.ts`, `packages/shared/test/photo-match.test.ts` | Vitest |
| `packages/server/src/db/schema.ts` | `captures` table (append) |
| `packages/server/src/config.ts` | `UPLOADS_DIR` |
| `packages/server/src/routes/captures.ts` | all `/captures` routes incl. photo upload and assign |
| `packages/server/src/routes/rolls.ts` | `pendingCaptures` on `GET /rolls/:id` |
| `packages/server/src/index.ts` | register static + captures routes |
| `packages/mcp/src/server.ts` | `tomu_capture`, `tomu_captures`, `tomu_edit_capture`, `tomu_assign_capture` + `resolveRollHandle` helper |
| `scripts/photos-sync.ts` | laptop sync CLI |
| `packages/client/src/services/api.ts` | `Capture` on `RollDetail` |
| `packages/client/src/components/rolls/RollsPage.tsx` | Pending captures section |
| `deploy/nginx/tomu.conf`, `scripts/deploy.sh`, `.gitignore`, `RESTORE.md`, `ROADMAP.md`, `CLAUDE.md`, `docs/SELF-HOSTING.md`, `vitest.config.ts`, `package.json` | wiring + docs |

---

### Task 1: Capture id + capture→frame mapping (shared, pure)

**Files:**
- Create: `packages/shared/src/capture.ts`
- Create: `packages/shared/test/capture.test.ts`
- Modify: `packages/shared/src/types.ts` (append after the `Frame` interface, ~line 145)
- Modify: `packages/shared/src/schemas.ts` (append at end)
- Modify: `packages/shared/src/index.ts`
- Modify: `vitest.config.ts` (coverage include)

**Interfaces:**
- Produces: `formatCaptureId(seq: number): string`, `parseCaptureId(input: string): number | null`, `captureToFrame(c: CaptureLike): FrameFields`, types `Capture`, `CaptureStatus`, Zod schemas `createCaptureSchema`, `updateCaptureSchema`, `assignCaptureSchema`, `capturePhotoMetaSchema`.

- [ ] **Step 1: Add types to `packages/shared/src/types.ts`** (append right after the `Frame` interface):

```ts
// ── Field captures ──

export type CaptureStatus = "pending" | "assigned";

/** A field capture: spoken settings + (later) the phone photo, before it is a frame. */
export interface Capture extends Timestamps {
  id: string;
  userId: string;
  /** Per-user monotonic counter; shown as `C412`. */
  seq: number;
  status: CaptureStatus;
  rollId?: string;
  cameraId?: string;
  lensId?: string;
  frameNumber?: number;
  /** When the settings were spoken (server time unless the caller overrides). ISO string. */
  capturedAt: string;
  shutterSpeed?: string;
  aperture?: string;
  compensation?: string;
  meteringMode?: string;
  subject?: string;
  locationName?: string;
  notes?: string;
  /** What Claude saw in the phone photo. */
  sceneDescription?: string;
  fileKey?: string;
  fileUrl?: string;
  mimeType?: string;
  fileSizeBytes?: number;
  widthPx?: number;
  heightPx?: number;
  /** From the phone photo's EXIF, set by the laptop sync. ISO string. */
  photoTakenAt?: string;
  latitude?: number;
  longitude?: number;
  /** Photos-library asset UUID; makes re-syncs idempotent. */
  photoAssetId?: string;
  frameId?: string;
}
```

- [ ] **Step 2: Add schemas to `packages/shared/src/schemas.ts`** (append at end of file):

```ts
// ── Field captures ──

export const createCaptureSchema = z.object({
  rollId: uuid.optional(),
  cameraId: uuid.optional(),
  lensId: uuid.optional(),
  frameNumber: z.number().int().positive().optional(),
  capturedAt: z.string().datetime().optional(),
  shutterSpeed: z.string().max(20).optional(),
  aperture: z.string().max(10).optional(),
  compensation: z.string().max(10).optional(),
  meteringMode: z.string().max(30).optional(),
  subject: z.string().max(500).optional(),
  locationName: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  sceneDescription: z.string().max(2000).optional(),
});

export const updateCaptureSchema = createCaptureSchema.partial();

/** Body for POST /captures/:id/assign. rollId required only when the capture is loose. */
export const assignCaptureSchema = z.object({
  rollId: uuid.optional(),
  frameNumber: z.number().int().positive(),
});

/** Multipart text fields that ride along with the photo on POST /captures/:id/photo. */
export const capturePhotoMetaSchema = z.object({
  photoTakenAt: z.string().datetime().optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  photoAssetId: z.string().max(100).optional(),
});
```

(`uuid` is the existing `z.string().uuid()` helper already used in this file; confirm the identifier name with `grep -n "const uuid" packages/shared/src/schemas.ts` and reuse it.)

- [ ] **Step 3: Write the failing tests** in `packages/shared/test/capture.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { captureToFrame, formatCaptureId, parseCaptureId } from "../src/capture.js";

describe("formatCaptureId", () => {
  it("prefixes with C and no padding", () => {
    expect(formatCaptureId(412)).toBe("C412");
    expect(formatCaptureId(1)).toBe("C1");
  });
});

describe("parseCaptureId", () => {
  it("accepts C412, c412, 412, and whitespace", () => {
    expect(parseCaptureId("C412")).toBe(412);
    expect(parseCaptureId("c412")).toBe(412);
    expect(parseCaptureId("412")).toBe(412);
    expect(parseCaptureId("  C412 ")).toBe(412);
  });
  it("rejects anything else", () => {
    expect(parseCaptureId("")).toBeNull();
    expect(parseCaptureId("C")).toBeNull();
    expect(parseCaptureId("C-412")).toBeNull();
    expect(parseCaptureId("20260906.1")).toBeNull();
    expect(parseCaptureId("0")).toBeNull();
  });
});

describe("captureToFrame", () => {
  const base = {
    lensId: "11111111-1111-1111-1111-111111111111",
    shutterSpeed: "1/250",
    aperture: "f/8",
    compensation: "+1",
    meteringMode: "spot",
    subject: "courtyard",
    locationName: "Kyoto",
    notes: "hazy",
    sceneDescription: "stone lantern by a pond",
    capturedAt: "2026-09-06T10:00:00.000Z",
    photoTakenAt: "2026-09-06T09:58:30.000Z",
    latitude: 35.0116,
    longitude: 135.7681,
  };

  it("copies settings and uses the photo time as shotAt", () => {
    const f = captureToFrame(base, 7);
    expect(f).toEqual({
      frameNumber: 7,
      lensId: base.lensId,
      shutterSpeed: "1/250",
      aperture: "f/8",
      compensation: "+1",
      meteringMode: "spot",
      subject: "courtyard",
      locationName: "Kyoto",
      notes: "hazy",
      latitude: 35.0116,
      longitude: 135.7681,
      shotAt: "2026-09-06T09:58:30.000Z",
    });
  });

  it("falls back to capturedAt when there is no photo time", () => {
    const f = captureToFrame({ ...base, photoTakenAt: undefined }, 7);
    expect(f.shotAt).toBe("2026-09-06T10:00:00.000Z");
  });

  it("maps null and undefined fields to null", () => {
    const f = captureToFrame({ capturedAt: base.capturedAt, shutterSpeed: null }, 1);
    expect(f.shutterSpeed).toBeNull();
    expect(f.lensId).toBeNull();
    expect(f.latitude).toBeNull();
  });
});
```

- [ ] **Step 4: Run to see it fail**

Run: `npx vitest run packages/shared/test/capture.test.ts`
Expected: FAIL — cannot resolve `../src/capture.js`.

- [ ] **Step 5: Implement `packages/shared/src/capture.ts`**

```ts
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
```

- [ ] **Step 6: Export it** — in `packages/shared/src/index.ts` add:

```ts
export * from "./capture.js";
```

- [ ] **Step 7: Add to coverage include** in `vitest.config.ts` after the `dev-shorthand.ts` line:

```ts
        "packages/shared/src/capture.ts",
        "packages/shared/src/photo-match.ts",
```

(`photo-match.ts` arrives in Task 2; vitest tolerates a listed file that does not exist yet, but if coverage complains, add that line in Task 2 instead.)

- [ ] **Step 8: Run tests and build shared**

Run: `npx vitest run packages/shared/test/capture.test.ts && npm run build:shared`
Expected: PASS, build clean.

- [ ] **Step 9: Commit**

```bash
git add packages/shared vitest.config.ts
git commit -m "feat(shared): capture id + capture->frame mapping" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01Q6jMVz9nSKsnyFxZP939Xi"
```

---

### Task 2: Photo time matcher (shared, pure)

**Files:**
- Create: `packages/shared/src/photo-match.ts`
- Create: `packages/shared/test/photo-match.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `matchPhotos(captures, photos, opts?) => MatchResult[]` with the types below. Consumed by `scripts/photos-sync.ts` (Task 8).

- [ ] **Step 1: Write the failing tests** in `packages/shared/test/photo-match.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { matchPhotos, type CandidatePhoto, type MatchCapture } from "../src/photo-match.js";

const T0 = Date.parse("2026-09-06T10:00:00Z");
const min = (m: number) => m * 60_000;
const sec = (s: number) => s * 1000;

function cap(id: string, offsetMs = 0, extra: Partial<MatchCapture> = {}): MatchCapture {
  return { id, capturedAt: new Date(T0 + offsetMs).toISOString(), ...extra };
}
function photo(uuid: string, offsetMs: number): CandidatePhoto {
  return { uuid, takenAt: new Date(T0 + offsetMs).toISOString() };
}

describe("matchPhotos", () => {
  it("matches the single photo inside the window", () => {
    const r = matchPhotos([cap("a")], [photo("p1", -min(3))]);
    expect(r).toEqual([{ captureId: "a", status: "matched", photoUuid: "p1", deltaSeconds: -180 }]);
  });

  it("ignores photos outside [-10 min, +2 min]", () => {
    const r = matchPhotos([cap("a")], [photo("p1", -min(11)), photo("p2", min(3))]);
    expect(r[0].status).toBe("none");
  });

  it("accepts the window edges inclusively", () => {
    const r = matchPhotos([cap("a")], [photo("p1", -min(10))]);
    expect(r[0].status).toBe("matched");
    const r2 = matchPhotos([cap("b")], [photo("p2", min(2))]);
    expect(r2[0].status).toBe("matched");
  });

  it("picks the nearest photo, preferring before on a tie", () => {
    const r = matchPhotos([cap("a")], [photo("before", -sec(40)), photo("after", sec(40))]);
    expect(r[0]).toMatchObject({ status: "matched", photoUuid: "before" });
  });

  it("is ambiguous when the two nearest are within 30 s of each other", () => {
    const r = matchPhotos([cap("a")], [photo("p1", -sec(60)), photo("p2", -sec(80))]);
    expect(r[0]).toMatchObject({ status: "ambiguous" });
    expect(r[0].candidates?.map((c) => c.uuid)).toEqual(["p1", "p2"]);
  });

  it("is not ambiguous when the runner-up is more than 30 s further away", () => {
    const r = matchPhotos([cap("a")], [photo("p1", -sec(60)), photo("p2", -sec(100))]);
    expect(r[0]).toMatchObject({ status: "matched", photoUuid: "p1" });
  });

  it("skips photos already attached to another capture", () => {
    const r = matchPhotos([cap("a")], [photo("p1", -min(1))], { usedAssetIds: new Set(["p1"]) });
    expect(r[0].status).toBe("none");
  });

  it("never gives one photo to two captures — both become ambiguous", () => {
    const r = matchPhotos([cap("a"), cap("b", sec(30))], [photo("p1", -sec(10))]);
    expect(r.map((x) => x.status)).toEqual(["ambiguous", "ambiguous"]);
  });

  it("assigns distinct photos to distinct captures in order", () => {
    const r = matchPhotos([cap("a"), cap("b", min(5))], [photo("p1", -sec(20)), photo("p2", min(5) - sec(20))]);
    expect(r.map((x) => [x.captureId, x.photoUuid])).toEqual([["a", "p1"], ["b", "p2"]]);
  });

  it("honours a forced pairing regardless of time", () => {
    const r = matchPhotos([cap("a")], [photo("far", min(60))], { forced: new Map([["a", "far"]]) });
    expect(r[0]).toMatchObject({ status: "matched", photoUuid: "far", forced: true });
  });

  it("respects custom window sizes", () => {
    const r = matchPhotos([cap("a")], [photo("p1", -min(20))], { windowBeforeMin: 30, windowAfterMin: 0 });
    expect(r[0].status).toBe("matched");
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run packages/shared/test/photo-match.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/shared/src/photo-match.ts`**

```ts
/**
 * Match phone photos to field captures by time.
 *
 * The photographer takes the phone photo, then speaks the settings, so the
 * photo is normally a little *before* the capture's timestamp. Window is
 * [capturedAt − 10 min, capturedAt + 2 min]; nearest wins; on an exact tie the
 * earlier photo wins; if the two nearest candidates are within 30 s of each
 * other the match is ambiguous and left for a human. A photo is given to at
 * most one capture per run.
 */

export interface MatchCapture {
  id: string;
  /** ISO timestamp. */
  capturedAt: string;
}

export interface CandidatePhoto {
  uuid: string;
  /** ISO timestamp (UTC). */
  takenAt: string;
}

export interface MatchOptions {
  windowBeforeMin?: number;
  windowAfterMin?: number;
  /** Two nearest candidates closer than this (seconds) → ambiguous. */
  ambiguitySeconds?: number;
  /** Asset ids already attached to some capture — never candidates. */
  usedAssetIds?: Set<string>;
  /** captureId → photo uuid, decided by a human; bypasses the window. */
  forced?: Map<string, string>;
}

export interface MatchResult {
  captureId: string;
  status: "matched" | "ambiguous" | "none";
  photoUuid?: string;
  /** photo time − capture time, in seconds (negative = photo taken first). */
  deltaSeconds?: number;
  forced?: boolean;
  /** For ambiguous results: the nearest candidates, nearest first. */
  candidates?: Array<{ uuid: string; deltaSeconds: number }>;
}

const DEFAULTS = { windowBeforeMin: 10, windowAfterMin: 2, ambiguitySeconds: 30 };

export function matchPhotos(
  captures: MatchCapture[],
  photos: CandidatePhoto[],
  opts: MatchOptions = {},
): MatchResult[] {
  const o = { ...DEFAULTS, ...opts };
  const used = new Set(o.usedAssetIds ?? []);
  const byUuid = new Map(photos.map((p) => [p.uuid, p]));

  // Pass 1: each capture's ranked candidates (forced pairings resolved first).
  type Ranked = { uuid: string; deltaSeconds: number };
  const ranked = new Map<string, Ranked[]>();
  const results = new Map<string, MatchResult>();

  for (const c of captures) {
    const forcedUuid = o.forced?.get(c.id);
    if (forcedUuid && byUuid.has(forcedUuid)) {
      const t = Date.parse(byUuid.get(forcedUuid)!.takenAt) - Date.parse(c.capturedAt);
      results.set(c.id, { captureId: c.id, status: "matched", photoUuid: forcedUuid, deltaSeconds: Math.round(t / 1000), forced: true });
      used.add(forcedUuid);
      continue;
    }
    const t0 = Date.parse(c.capturedAt);
    const lo = t0 - o.windowBeforeMin * 60_000;
    const hi = t0 + o.windowAfterMin * 60_000;
    const cands: Ranked[] = [];
    for (const p of photos) {
      if (used.has(p.uuid)) continue;
      const tp = Date.parse(p.takenAt);
      if (tp < lo || tp > hi) continue;
      cands.push({ uuid: p.uuid, deltaSeconds: Math.round((tp - t0) / 1000) });
    }
    cands.sort((a, b) => {
      const da = Math.abs(a.deltaSeconds);
      const db = Math.abs(b.deltaSeconds);
      if (da !== db) return da - db;
      return a.deltaSeconds - b.deltaSeconds; // tie → earlier (more negative) first
    });
    ranked.set(c.id, cands);
  }

  // Pass 2: detect photos wanted by more than one capture.
  const claims = new Map<string, string[]>();
  for (const [cid, cands] of ranked) {
    const top = cands[0];
    if (!top) continue;
    claims.set(top.uuid, [...(claims.get(top.uuid) ?? []), cid]);
  }

  for (const c of captures) {
    if (results.has(c.id)) continue;
    const cands = ranked.get(c.id) ?? [];
    const top = cands[0];
    if (!top) {
      results.set(c.id, { captureId: c.id, status: "none" });
      continue;
    }
    const contested = (claims.get(top.uuid)?.length ?? 0) > 1;
    const runnerUp = cands[1];
    const tooClose = runnerUp != null && Math.abs(runnerUp.deltaSeconds - top.deltaSeconds) <= o.ambiguitySeconds;
    if (contested || tooClose) {
      results.set(c.id, { captureId: c.id, status: "ambiguous", candidates: cands.slice(0, 3) });
      continue;
    }
    results.set(c.id, { captureId: c.id, status: "matched", photoUuid: top.uuid, deltaSeconds: top.deltaSeconds });
  }

  return captures.map((c) => results.get(c.id)!);
}
```

Note on the "never gives one photo to two captures" test: both captures rank `p1` first, so both go ambiguous. A human resolves with `--force`.

- [ ] **Step 4: Export** in `packages/shared/src/index.ts`:

```ts
export * from "./photo-match.js";
```

- [ ] **Step 5: Run tests, then the whole suite with coverage**

Run: `npx vitest run packages/shared/test/photo-match.test.ts && npm run test:coverage`
Expected: all PASS; coverage thresholds hold (lines ≥ 90, branches ≥ 85). If a branch in `matchPhotos` is uncovered, add a test rather than lowering thresholds.

- [ ] **Step 6: Build shared and commit**

```bash
npm run build:shared
git add packages/shared vitest.config.ts
git commit -m "feat(shared): photo-to-capture time matcher" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01Q6jMVz9nSKsnyFxZP939Xi"
```

---

### Task 3: `captures` table, config, deps, DB push

**Files:**
- Modify: `packages/server/src/db/schema.ts` (append after `frames`, before `// ── Tanks ──`)
- Modify: `packages/server/src/config.ts`
- Modify: `packages/server/package.json` (deps)
- Modify: `.gitignore`

**Interfaces:**
- Produces: Drizzle table `captures` with columns named exactly as in the spec §1; `config.UPLOADS_DIR: string`.

- [ ] **Step 1: Add the table** to `packages/server/src/db/schema.ts`, after the `frames` table:

```ts
// ── Field captures ──
//
// Spoken settings + (later) the phone photo, recorded in the field before the
// frame number is known. `seq` is a per-user counter shown as `C412`. A
// capture becomes a real `frames` row at assign time (POST /captures/:id/assign)
// and keeps `frame_id` as the link.

export const captures = pgTable(
  "captures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id),
    seq: integer("seq").notNull(),
    status: text("status").notNull().default("pending"),
    rollId: uuid("roll_id").references(() => rolls.id, { onDelete: "set null" }),
    cameraId: uuid("camera_id").references(() => cameras.id),
    lensId: uuid("lens_id").references(() => lenses.id),
    frameNumber: integer("frame_number"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    shutterSpeed: text("shutter_speed"),
    aperture: text("aperture"),
    compensation: text("compensation"),
    meteringMode: text("metering_mode"),
    subject: text("subject"),
    locationName: text("location_name"),
    notes: text("notes"),
    sceneDescription: text("scene_description"),
    fileKey: text("file_key"),
    fileUrl: text("file_url"),
    mimeType: text("mime_type"),
    fileSizeBytes: integer("file_size_bytes"),
    widthPx: integer("width_px"),
    heightPx: integer("height_px"),
    photoTakenAt: timestamp("photo_taken_at", { withTimezone: true }),
    latitude: numeric("latitude", { precision: 10, scale: 7 }),
    longitude: numeric("longitude", { precision: 10, scale: 7 }),
    photoAssetId: text("photo_asset_id"),
    frameId: uuid("frame_id").references(() => frames.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("captures_user_id_seq_unique").on(t.userId, t.seq)]
);
```

`uniqueIndex`, `numeric`, `integer`, `timestamp`, `text`, `uuid` are already imported at the top of the file (the `rolls` table uses `uniqueIndex`); verify with `sed -n 1,14p packages/server/src/db/schema.ts`.

- [ ] **Step 2: Config** — in `packages/server/src/config.ts` add to `envSchema`:

```ts
  /** Root for uploaded files (capture photos). Served at /uploads by fastify-static in dev and nginx in prod. */
  UPLOADS_DIR: z.string().default(new URL("../../../uploads", import.meta.url).pathname),
```

(`config.ts` compiles to `packages/server/dist/config.js`; `../../../uploads` from there is `<repo>/uploads`. From `src/` under `tsx` it resolves the same because both are three levels deep. Verify after Task 5 by logging `config.UPLOADS_DIR` once.)

- [ ] **Step 3: Dependencies**

Run: `npm install -w packages/server @fastify/static@^8 image-size@^2`
Expected: `packages/server/package.json` gains both; lockfile updated.

- [ ] **Step 4: Ignore uploads** — append to `.gitignore`:

```
uploads/
```

- [ ] **Step 5: Snapshot the dev DB, then push**

```bash
pg_dump --host=localhost --username=filmlog --dbname=filmlog --clean --if-exists --no-owner --no-privileges > db-backups/pre-captures-table-$(date +%Y%m%d-%H%M%S).sql
ls -la db-backups | tail -2
npm run -w packages/server db:push
```

Expected: dump file present and non-trivial (> 1 MB); `db:push` reports creating table `captures` and its unique index, no prompts.

- [ ] **Step 6: Verify and commit**

Run: `psql postgres://filmlog:filmlog@localhost:5432/filmlog -c '\d captures' | head -40`
Expected: all columns above.

```bash
git add packages/server/src/db/schema.ts packages/server/src/config.ts packages/server/package.json package-lock.json .gitignore db-backups/pre-captures-table-*.sql
git commit -m "feat(server): captures table, UPLOADS_DIR config, static+image-size deps" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01Q6jMVz9nSKsnyFxZP939Xi"
```

---

### Task 4: `/captures` CRUD routes

**Files:**
- Create: `packages/server/src/routes/captures.ts`
- Modify: `packages/server/src/index.ts`

**Interfaces:**
- Consumes: `createCaptureSchema`, `updateCaptureSchema`, `parseCaptureId`, `formatCaptureId` from `@tomu/shared`; `captures` table.
- Produces: `POST /api/v1/captures`, `GET /api/v1/captures`, `GET /api/v1/captures/:id`, `PATCH /api/v1/captures/:id`, `DELETE /api/v1/captures/:id`; every response row carries `captureId: "C412"`. Exported helper `findCapture(userId, handle)` reused by Tasks 5 and 6 in the same file.

- [ ] **Step 1: Write `packages/server/src/routes/captures.ts`**

```ts
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  createCaptureSchema,
  formatCaptureId,
  parseCaptureId,
  updateCaptureSchema,
} from "@tomu/shared";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { captures } from "../db/schema.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type CaptureRow = typeof captures.$inferSelect;

/** API shape: DB row + the display id. Numeric strings from `numeric` columns are left as-is (client parses). */
export function presentCapture(row: CaptureRow) {
  return { ...row, captureId: formatCaptureId(row.seq) };
}

/** Find one of the user's captures by uuid or by "C412"/"412". */
export async function findCapture(userId: string, handle: string): Promise<CaptureRow | undefined> {
  const seq = parseCaptureId(handle);
  const where = UUID_RE.test(handle)
    ? and(eq(captures.userId, userId), eq(captures.id, handle))
    : seq != null
      ? and(eq(captures.userId, userId), eq(captures.seq, seq))
      : undefined;
  if (!where) return undefined;
  const [row] = await db.select().from(captures).where(where).limit(1);
  return row;
}

export function captureFilePath(captureId: string): { key: string; url: string; abs: string } {
  const key = `captures/${captureId}.jpg`;
  return { key, url: `/uploads/${key}`, abs: join(config.UPLOADS_DIR, key) };
}

export async function capturesRoutes(fastify: FastifyInstance) {
  await mkdir(join(config.UPLOADS_DIR, "captures"), { recursive: true });

  // ── Create ──────────────────────────────────────────────────────────
  fastify.post("/", async (request, reply) => {
    const body = createCaptureSchema.parse(request.body);
    const values = {
      userId: request.userId,
      rollId: body.rollId ?? null,
      cameraId: body.cameraId ?? null,
      lensId: body.lensId ?? null,
      frameNumber: body.frameNumber ?? null,
      capturedAt: body.capturedAt ? new Date(body.capturedAt) : new Date(),
      shutterSpeed: body.shutterSpeed ?? null,
      aperture: body.aperture ?? null,
      compensation: body.compensation ?? null,
      meteringMode: body.meteringMode ?? null,
      subject: body.subject ?? null,
      locationName: body.locationName ?? null,
      notes: body.notes ?? null,
      sceneDescription: body.sceneDescription ?? null,
    };
    // seq = max(seq)+1 for this user, computed inside the insert. The unique
    // index catches a concurrent insert; retry once.
    const nextSeq = sql<number>`(select coalesce(max(${captures.seq}), 0) + 1 from ${captures} where ${captures.userId} = ${request.userId})`;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const [row] = await db.insert(captures).values({ ...values, seq: nextSeq }).returning();
        return reply.status(201).send({ data: presentCapture(row) });
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code !== "23505" || attempt === 1) throw err;
      }
    }
  });

  // ── List ────────────────────────────────────────────────────────────
  fastify.get<{ Querystring: { status?: string; roll_id?: string; since?: string; limit?: string } }>(
    "/",
    async (request, reply) => {
      const q = request.query;
      const status = q.status ?? "pending";
      const conds = [eq(captures.userId, request.userId)];
      if (status !== "all") {
        if (status !== "pending" && status !== "assigned") {
          return reply.status(400).send({ error: `Invalid status: ${status}` });
        }
        conds.push(eq(captures.status, status));
      }
      if (q.roll_id) conds.push(eq(captures.rollId, q.roll_id));
      if (q.since) {
        const d = new Date(q.since);
        if (Number.isNaN(d.getTime())) return reply.status(400).send({ error: `Invalid since: ${q.since}` });
        conds.push(gte(captures.capturedAt, d));
      }
      const limit = Math.min(Math.max(Number(q.limit ?? 100) || 100, 1), 500);
      const rows = await db
        .select()
        .from(captures)
        .where(and(...conds))
        .orderBy(desc(captures.capturedAt))
        .limit(limit);
      return { data: rows.map(presentCapture) };
    },
  );

  // ── Get one ─────────────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const row = await findCapture(request.userId, request.params.id);
    if (!row) return reply.status(404).send({ error: "Capture not found" });
    return { data: presentCapture(row) };
  });

  // ── Patch ───────────────────────────────────────────────────────────
  fastify.patch<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const row = await findCapture(request.userId, request.params.id);
    if (!row) return reply.status(404).send({ error: "Capture not found" });
    const body = updateCaptureSchema.parse(request.body);
    const set: Partial<typeof captures.$inferInsert> = { updatedAt: new Date() };
    if (body.rollId !== undefined) set.rollId = body.rollId;
    if (body.cameraId !== undefined) set.cameraId = body.cameraId;
    if (body.lensId !== undefined) set.lensId = body.lensId;
    if (body.frameNumber !== undefined) set.frameNumber = body.frameNumber;
    if (body.capturedAt !== undefined) set.capturedAt = new Date(body.capturedAt);
    for (const k of ["shutterSpeed", "aperture", "compensation", "meteringMode", "subject", "locationName", "notes", "sceneDescription"] as const) {
      if (body[k] !== undefined) set[k] = body[k];
    }
    const [updated] = await db.update(captures).set(set).where(eq(captures.id, row.id)).returning();
    return { data: presentCapture(updated) };
  });

  // ── Delete ──────────────────────────────────────────────────────────
  fastify.delete<{ Params: { id: string }; Querystring: { force?: string } }>("/:id", async (request, reply) => {
    const row = await findCapture(request.userId, request.params.id);
    if (!row) return reply.status(404).send({ error: "Capture not found" });
    if (row.status === "assigned" && request.query.force !== "true") {
      return reply.status(409).send({ error: `${formatCaptureId(row.seq)} is assigned to a frame; pass ?force=true to delete anyway (the frame and its note stay).` });
    }
    await db.delete(captures).where(eq(captures.id, row.id));
    if (row.fileKey) await rm(join(config.UPLOADS_DIR, row.fileKey), { force: true });
    return reply.status(204).send();
  });
}
```

- [ ] **Step 2: Register** in `packages/server/src/index.ts` — add the import and the route line after `tanksRoutes`:

```ts
import { capturesRoutes } from "./routes/captures.js";
// ...
await fastify.register(capturesRoutes, { prefix: "/api/v1/captures" });
```

- [ ] **Step 3: Type-check and smoke test**

Run: `npm run build -w packages/server` — expected clean. Then, with `npm run dev:server` running in another terminal and a token in `$TOKEN` (grab one via `curl -s localhost:3456/api/v1/auth/login -H 'content-type: application/json' -d '{"email":"…","password":"…"}' | jq -r .data.token`, or reuse `TOMU_API_TOKEN` from `.env`):

```bash
curl -s localhost:3456/api/v1/captures -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"shutterSpeed":"1/250","aperture":"f/8","subject":"smoke test"}' | jq .
curl -s "localhost:3456/api/v1/captures?status=pending" -H "Authorization: Bearer $TOKEN" | jq '.data | length'
curl -s localhost:3456/api/v1/captures/C1 -H "Authorization: Bearer $TOKEN" | jq .data.captureId
curl -s -X PATCH localhost:3456/api/v1/captures/C1 -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"aperture":"f/11"}' | jq .data.aperture
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE localhost:3456/api/v1/captures/C1 -H "Authorization: Bearer $TOKEN"
```

Expected: 201 with `captureId: "C1"`; list length 1; `"C1"`; `"f/11"`; `204`.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/routes/captures.ts packages/server/src/index.ts
git commit -m "feat(server): /captures CRUD with per-user C-seq ids" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01Q6jMVz9nSKsnyFxZP939Xi"
```

---

### Task 5: Photo upload + static serving

**Files:**
- Modify: `packages/server/src/routes/captures.ts`
- Modify: `packages/server/src/index.ts`

**Interfaces:**
- Consumes: `capturePhotoMetaSchema`, `captureFilePath`, `findCapture`.
- Produces: `POST /api/v1/captures/:id/photo` (multipart: `file` + optional `photoTakenAt`, `latitude`, `longitude`, `photoAssetId`); `GET /uploads/*` in dev.

- [ ] **Step 1: Register static serving** in `packages/server/src/index.ts` after the `authPlugin` registration:

```ts
import fastifyStatic from "@fastify/static";
// ...
// Uploaded files (capture photos). nginx serves this path in prod; this is the dev path.
await fastify.register(fastifyStatic, {
  root: config.UPLOADS_DIR,
  prefix: "/uploads/",
  decorateReply: false,
});
```

Check that `authPlugin` does not guard `/uploads`: open `packages/server/src/plugins/auth.ts` and confirm it only hooks routes under `/api/`. If it hooks everything, add `/uploads/` to its skip list the same way `/api/health` or `/api/v1/auth/login` is skipped.

- [ ] **Step 2: Add the upload route** to `capturesRoutes` in `captures.ts`, after the PATCH route. Imports to add at the top:

```ts
import multipart from "@fastify/multipart";
import { writeFile } from "node:fs/promises";
import { imageSize } from "image-size";
import { capturePhotoMetaSchema } from "@tomu/shared";
```

Register multipart inside `capturesRoutes` (first line of the function body, before `mkdir`):

```ts
  await fastify.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
```

Route:

```ts
  // ── Photo upload (laptop sync) ──────────────────────────────────────
  fastify.post<{ Params: { id: string } }>("/:id/photo", async (request, reply) => {
    const row = await findCapture(request.userId, request.params.id);
    if (!row) return reply.status(404).send({ error: "Capture not found" });

    const fields: Record<string, string> = {};
    let fileBuf: Buffer | undefined;
    let mime: string | undefined;
    for await (const part of request.parts()) {
      if (part.type === "file") {
        if (part.fieldname !== "file") { await part.toBuffer(); continue; }
        mime = part.mimetype;
        fileBuf = await part.toBuffer();
        if (part.file.truncated) return reply.status(413).send({ error: "Photo exceeds 25 MB" });
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }
    if (!fileBuf) return reply.status(400).send({ error: "Missing multipart field 'file'" });
    if (mime !== "image/jpeg") return reply.status(415).send({ error: `Only image/jpeg accepted, got ${mime}` });
    const meta = capturePhotoMetaSchema.parse(fields);

    let dims: { width?: number; height?: number } = {};
    try { dims = imageSize(fileBuf); } catch { /* not fatal */ }

    const { key, url, abs } = captureFilePath(row.id);
    await writeFile(abs, fileBuf);

    const [updated] = await db
      .update(captures)
      .set({
        fileKey: key,
        fileUrl: url,
        mimeType: mime,
        fileSizeBytes: fileBuf.length,
        widthPx: dims.width ?? null,
        heightPx: dims.height ?? null,
        photoTakenAt: meta.photoTakenAt ? new Date(meta.photoTakenAt) : row.photoTakenAt,
        latitude: meta.latitude != null ? String(meta.latitude) : row.latitude,
        longitude: meta.longitude != null ? String(meta.longitude) : row.longitude,
        photoAssetId: meta.photoAssetId ?? row.photoAssetId,
        updatedAt: new Date(),
      })
      .where(eq(captures.id, row.id))
      .returning();
    return { data: presentCapture(updated) };
  });
```

- [ ] **Step 3: Smoke test** (server running; any JPEG at `/tmp/x.jpg` — `sips -s format jpeg <some.heic> --out /tmp/x.jpg` makes one):

```bash
curl -s localhost:3456/api/v1/captures -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"subject":"upload test"}' | jq -r .data.captureId
curl -s localhost:3456/api/v1/captures/C2/photo -H "Authorization: Bearer $TOKEN" \
  -F file=@/tmp/x.jpg -F photoTakenAt=2026-09-06T09:58:30Z -F latitude=35.0116 -F longitude=135.7681 -F photoAssetId=TEST-UUID | jq '.data | {fileUrl, widthPx, photoTakenAt, latitude}'
curl -s -o /dev/null -w '%{http_code}\n' "localhost:3456$(curl -s localhost:3456/api/v1/captures/C2 -H "Authorization: Bearer $TOKEN" | jq -r .data.fileUrl)"
curl -s -o /dev/null -w '%{http_code}\n' localhost:3456/api/v1/captures/C2/photo -H "Authorization: Bearer $TOKEN" -F file=@/etc/hosts
```

Expected: a capture id; JSON with `fileUrl` `/uploads/captures/<uuid>.jpg`, non-null `widthPx`, the given time and lat; `200` for the static fetch; `415` for the non-JPEG.

- [ ] **Step 4: Commit**

```bash
git add packages/server/src/routes/captures.ts packages/server/src/index.ts
git commit -m "feat(server): capture photo upload + /uploads static serving" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01Q6jMVz9nSKsnyFxZP939Xi"
```

---

### Task 6: Assign route + pending captures on roll detail

**Files:**
- Modify: `packages/server/src/routes/captures.ts`
- Modify: `packages/server/src/routes/rolls.ts` (`GET /:id`, ~lines 252–326)

**Interfaces:**
- Consumes: `assignCaptureSchema`, `captureToFrame` from `@tomu/shared`; `frames`, `notes`, `rolls` tables.
- Produces: `POST /api/v1/captures/:id/assign` → `{ data: { capture, frame } }`; `GET /rolls/:id` gains `pendingCaptures: Capture[]`.

- [ ] **Step 1: Add the assign route** to `captures.ts` after the photo route. Extra imports:

```ts
import { assignCaptureSchema, captureToFrame } from "@tomu/shared";
import { frames, notes, rolls } from "../db/schema.js";
```

```ts
  // ── Assign: capture becomes a frame ─────────────────────────────────
  fastify.post<{ Params: { id: string } }>("/:id/assign", async (request, reply) => {
    const row = await findCapture(request.userId, request.params.id);
    if (!row) return reply.status(404).send({ error: "Capture not found" });
    if (row.status === "assigned") {
      return reply.status(409).send({ error: `${formatCaptureId(row.seq)} is already assigned (frame ${row.frameNumber})` });
    }
    const body = assignCaptureSchema.parse(request.body);
    const rollId = body.rollId ?? row.rollId;
    if (!rollId) return reply.status(400).send({ error: `${formatCaptureId(row.seq)} is not linked to a roll; pass rollId` });

    const [roll] = await db
      .select({ id: rolls.id, status: rolls.status })
      .from(rolls)
      .where(and(eq(rolls.id, rollId), eq(rolls.userId, request.userId)))
      .limit(1);
    if (!roll) return reply.status(404).send({ error: "Roll not found" });

    const [existing] = await db
      .select({ id: frames.id })
      .from(frames)
      .where(and(eq(frames.rollId, roll.id), eq(frames.frameNumber, body.frameNumber)))
      .limit(1);
    if (existing) {
      return reply.status(400).send({ error: `Frame ${body.frameNumber} already exists on this roll (frame id ${existing.id.slice(0, 8)})` });
    }

    const f = captureToFrame(row, body.frameNumber);
    const result = await db.transaction(async (tx) => {
      const [frame] = await tx
        .insert(frames)
        .values({
          rollId: roll.id,
          frameNumber: f.frameNumber,
          lensId: f.lensId,
          shutterSpeed: f.shutterSpeed,
          aperture: f.aperture,
          compensation: f.compensation,
          meteringMode: f.meteringMode,
          subject: f.subject,
          notes: f.notes,
          latitude: f.latitude != null ? String(f.latitude) : null,
          longitude: f.longitude != null ? String(f.longitude) : null,
          locationName: f.locationName,
          shotAt: new Date(f.shotAt),
          tags: [],
        })
        .returning();
      if (row.fileKey || row.sceneDescription) {
        await tx.insert(notes).values({
          userId: request.userId,
          frameId: frame.id,
          type: row.fileKey ? "photo" : "text",
          content: row.sceneDescription ?? null,
          fileKey: row.fileKey,
          fileUrl: row.fileUrl,
          mimeType: row.mimeType,
          fileSizeBytes: row.fileSizeBytes,
          latitude: row.latitude,
          longitude: row.longitude,
        });
      }
      if (roll.status === "loaded") {
        await tx.update(rolls).set({ status: "shooting", updatedAt: new Date() }).where(eq(rolls.id, roll.id));
      }
      const [capture] = await tx
        .update(captures)
        .set({ status: "assigned", rollId: roll.id, frameNumber: f.frameNumber, frameId: frame.id, updatedAt: new Date() })
        .where(eq(captures.id, row.id))
        .returning();
      return { capture: presentCapture(capture), frame };
    });
    return reply.status(201).send({ data: result });
  });
```

Note: the spec says note `type = "reference"`, but `NOTE_TYPES` is `["text","voice","photo"]` and `createNoteSchema` validates against it. Use `"photo"` when a file exists, `"text"` otherwise; this keeps the enum intact. The spec's intent (a note carrying the file) is preserved.

- [ ] **Step 2: Pending captures on roll detail** — in `rolls.ts`, add `captures` to the schema import, and in `GET /:id` extend the `Promise.all` and the response:

```ts
    const [rollFrames, rollNotes, pendingCaptures] = await Promise.all([
      /* existing two queries unchanged */,
      db
        .select()
        .from(captures)
        .where(and(eq(captures.rollId, roll.id), eq(captures.status, "pending")))
        .orderBy(asc(captures.capturedAt)),
    ]);
    // ...
    return {
      data: {
        ...roll,
        devId: formatDevId(roll.devDate, roll.devSeq),
        frames: rollFrames,
        notes: rollNotes,
        frameNotes,
        pendingCaptures: pendingCaptures.map((c) => ({ ...c, captureId: `C${c.seq}` })),
      },
    };
```

(Inline `C${c.seq}` avoids importing `presentCapture` across route files; both produce identical output.)

- [ ] **Step 3: Smoke test** (server running; pick an active roll id via `curl -s "localhost:3456/api/v1/rolls?status=active" -H "Authorization: Bearer $TOKEN" | jq -r '.data[0].id'` into `$ROLL`):

```bash
CID=$(curl -s localhost:3456/api/v1/captures -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "{\"rollId\":\"$ROLL\",\"shutterSpeed\":\"1/60\",\"aperture\":\"f/4\",\"sceneDescription\":\"assign test\"}" | jq -r .data.captureId)
curl -s "localhost:3456/api/v1/rolls/$ROLL" -H "Authorization: Bearer $TOKEN" | jq '.data.pendingCaptures | length'
curl -s localhost:3456/api/v1/captures/$CID/assign -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"frameNumber":99}' | jq '.data | {c: .capture.status, f: .frame.frameNumber, s: .frame.shutterSpeed}'
curl -s -o /dev/null -w '%{http_code}\n' localhost:3456/api/v1/captures/$CID/assign -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"frameNumber":98}'
```

Expected: pending count ≥ 1; `{c:"assigned", f:99, s:"1/60"}`; second assign → `409`. Clean up: delete frame 99 with the existing `DELETE /rolls/:id/frames/:frameNumber` route if present, otherwise `psql -c "delete from frames where frame_number=99 and roll_id='$ROLL'"`; then `DELETE /captures/$CID?force=true`.

- [ ] **Step 4: Build and commit**

```bash
npm run build -w packages/server
git add packages/server/src/routes/captures.ts packages/server/src/routes/rolls.ts
git commit -m "feat(server): assign capture -> frame (+photo note); pendingCaptures on roll detail" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01Q6jMVz9nSKsnyFxZP939Xi"
```

---

### Task 7: MCP tools

**Files:**
- Modify: `packages/mcp/src/server.ts` (add a `// ── Field captures ──` section after the `tomu_unload` tool, ~line 800)
- Modify: `CLAUDE.md` (tool list)

**Interfaces:**
- Consumes: `pickActiveRoll(cameraHint)`, `api()`, `fuzzyMatch`, `displayStock` (already in the file); `formatDevId` from `@tomu/shared` for the roll-handle helper.
- Produces: tools `tomu_capture`, `tomu_captures`, `tomu_edit_capture`, `tomu_assign_capture`; helper `resolveRollHandle(handle)`.

- [ ] **Step 1: Add the helper and shared types** (place right before the first new tool):

```ts
// ── Field captures ────────────────────────────────────────────────────
//
// Captures are spoken settings recorded before the frame number is known.
// The phone photo never passes through Claude: the laptop sync script attaches
// it later by timestamp. Tools here only move words.

interface CaptureRow {
  id: string;
  captureId: string;
  seq: number;
  status: "pending" | "assigned";
  rollId: string | null;
  cameraId: string | null;
  frameNumber: number | null;
  capturedAt: string;
  shutterSpeed: string | null;
  aperture: string | null;
  compensation: string | null;
  meteringMode: string | null;
  subject: string | null;
  locationName: string | null;
  notes: string | null;
  sceneDescription: string | null;
  fileUrl: string | null;
  photoTakenAt: string | null;
}

interface AnyRoll {
  id: string;
  displayId: string | null;
  devDate: string | null;
  devSeq: number | null;
  status: string;
  manufacturer: string;
  stockName: string;
  cameraMake: string | null;
  cameraModel: string | null;
}

/** Resolve a roll by display id ("20260906.1"), Dev Id ("20260906.0741"), bare dev seq ("741"), or uuid prefix. */
async function resolveRollHandle(handle: string): Promise<{ roll?: AnyRoll; error?: string }> {
  const h = handle.trim();
  const { data } = await api<{ data: AnyRoll[] }>("/rolls?status=all");
  const hits = data.filter((r) => {
    if (r.displayId === h) return true;
    if (formatDevId(r.devDate, r.devSeq) === h) return true;
    if (/^\d{1,5}$/.test(h) && r.devSeq === Number(h)) return true;
    return h.length >= 8 && r.id.startsWith(h.toLowerCase());
  });
  if (hits.length === 1) return { roll: hits[0] };
  if (hits.length === 0) return { error: `No roll matches "${h}". Use a display id (20260906.1), Dev Id (20260906.0741), or dev seq (741).` };
  return { error: `"${h}" matches ${hits.length} rolls: ${hits.map((r) => r.displayId ?? r.id.slice(0, 8)).join(", ")}` };
}

function rollLabel(r: { displayId?: string | null; devDate?: string | null; devSeq?: number | null; id: string }): string {
  return r.displayId ?? formatDevId(r.devDate, r.devSeq) ?? r.id.slice(0, 8);
}

function captureLine(c: CaptureRow, rollsById: Map<string, AnyRoll>): string {
  const settings = [c.shutterSpeed, c.aperture, c.compensation].filter(Boolean).join(" ");
  const roll = c.rollId ? rollsById.get(c.rollId) : undefined;
  const where = roll ? `roll ${rollLabel(roll)}` : "loose";
  const when = c.capturedAt.slice(0, 16).replace("T", " ");
  const photo = c.fileUrl ? "photo ✓" : "pending photo";
  const frame = c.status === "assigned" ? ` → frame ${c.frameNumber}` : "";
  return `**${c.captureId}** · ${when} · ${where}${settings ? ` · ${settings}` : ""}${c.subject ? ` · ${c.subject}` : ""} · ${photo}${frame}`;
}
```

Add `formatDevId` to the existing `@tomu/shared` import at the top of the file.

- [ ] **Step 2: `tomu_capture`**

```ts
server.tool(
  "tomu_capture",
  "FIELD USE. Record spoken exposure settings for a film frame whose number is not known yet, " +
    "with an optional description of the phone photo you were shown. Do NOT try to upload or attach the image — " +
    "the photo is matched to this capture later on the laptop by timestamp; just describe it in `description`. " +
    "If `camera` resolves to one active roll the capture is linked to it; otherwise it stays loose. " +
    "Never ask for missing fields — a capture with only a description is valid. Returns the capture id (C412).",
  {
    camera: z.string().optional().describe("Camera hint to link the active roll (e.g. 'M6', 'Mamiya'). Omit if unknown."),
    lens: z.string().optional().describe("Lens hint for fuzzy match"),
    frameNumber: z.number().int().positive().optional().describe("Only when known now (typical for 4x5 sheets)."),
    shutterSpeed: z.string().optional().describe("e.g. '1/250', '2s'"),
    aperture: z.string().optional().describe("e.g. 'f/8', '5.6'"),
    compensation: z.string().optional().describe("e.g. '+1', '-1/3'"),
    meteringMode: z.string().optional().describe("e.g. 'incident', 'spot', 'sunny 16', 'guess'"),
    subject: z.string().optional().describe("Short subject"),
    locationName: z.string().optional().describe("Place name"),
    notes: z.string().optional().describe("Anything unstructured"),
    description: z.string().optional().describe("What the phone photo shows (scene, light, framing). Your words, not the image."),
    capturedAt: z.string().optional().describe("ISO time if the shot was earlier than now (e.g. 'that was ten minutes ago')."),
  },
  async ({ camera, lens, frameNumber, shutterSpeed, aperture, compensation, meteringMode, subject, locationName, notes, description, capturedAt }) => {
    const body: Record<string, unknown> = {};
    const notesOut: string[] = [];

    if (camera) {
      const { roll, error } = await pickActiveRoll(camera);
      if (roll) {
        body.rollId = roll.id;
        if (roll.cameraId) body.cameraId = roll.cameraId;
        notesOut.push(`roll ${describeRoll(roll)}`);
      } else if (error?.startsWith("Multiple active rolls")) {
        return { content: [{ type: "text" as const, text: error }] };
      } else {
        // No active roll for that camera: link the camera if it exists, keep the capture loose.
        const { data: cams } = await api<{ data: Array<{ id: string; make: string; model: string }> }>("/cameras");
        const cam = cams.find((c) => fuzzyMatch(camera, c.make, c.model, `${c.make} ${c.model}`));
        if (cam) { body.cameraId = cam.id; notesOut.push(`${cam.make} ${cam.model}, no active roll — capture is loose`); }
        else notesOut.push(`no camera matched "${camera}" — capture is loose`);
      }
    } else {
      notesOut.push("loose (no camera given)");
    }

    if (lens) {
      const { data: lenses } = await api<{ data: Array<{ id: string; make: string; model: string; focalLengthMm: number | null }> }>("/lenses");
      const match = lenses.find((l) => fuzzyMatch(lens, `${l.make} ${l.model}`, l.model, String(l.focalLengthMm ?? "")));
      if (match) body.lensId = match.id;
    }
    if (frameNumber != null) body.frameNumber = frameNumber;
    if (shutterSpeed) body.shutterSpeed = shutterSpeed;
    if (aperture) body.aperture = aperture;
    if (compensation) body.compensation = compensation;
    if (meteringMode) body.meteringMode = meteringMode;
    if (subject) body.subject = subject;
    if (locationName) body.locationName = locationName;
    if (notes) body.notes = notes;
    if (description) body.sceneDescription = description;
    if (capturedAt) {
      const d = new Date(capturedAt);
      if (!Number.isNaN(d.getTime())) body.capturedAt = d.toISOString();
    }

    const { data: c } = await api<{ data: CaptureRow }>("/captures", { method: "POST", body: JSON.stringify(body) });
    const settings = [c.shutterSpeed, c.aperture, c.compensation].filter(Boolean).join(" ");
    return {
      content: [{
        type: "text" as const,
        text: `**${c.captureId}** · ${notesOut.join("; ")}${settings ? ` · ${settings}` : ""}${subject ? ` · ${subject}` : ""} · pending photo`,
      }],
    };
  }
);
```

`ActiveRoll` must expose `cameraId`; check the interface near line 585 — if it lacks `cameraId`, add `cameraId: string | null;` (the `/rolls` list already returns it).

- [ ] **Step 3: `tomu_captures`**

```ts
server.tool(
  "tomu_captures",
  "List field captures. Default: pending ones (no frame number yet), newest first. Shows whether the phone photo has been attached.",
  {
    roll: z.string().optional().describe("Restrict to one roll: display id, Dev Id, or dev seq"),
    status: z.string().optional().describe("'pending' (default), 'assigned', or 'all'"),
    limit: z.number().int().positive().optional().describe("Max rows (default 30)"),
  },
  async ({ roll, status, limit }) => {
    const params = new URLSearchParams();
    params.set("status", status ?? "pending");
    params.set("limit", String(limit ?? 30));
    if (roll) {
      const r = await resolveRollHandle(roll);
      if (!r.roll) return { content: [{ type: "text" as const, text: r.error! }] };
      params.set("roll_id", r.roll.id);
    }
    const { data } = await api<{ data: CaptureRow[] }>(`/captures?${params}`);
    if (data.length === 0) return { content: [{ type: "text" as const, text: "No captures." }] };
    const { data: allRolls } = await api<{ data: AnyRoll[] }>("/rolls?status=all");
    const rollsById = new Map(allRolls.map((r) => [r.id, r]));
    const lines = data.map((c) => `- ${captureLine(c, rollsById)}${c.sceneDescription ? `\n  _${c.sceneDescription}_` : ""}`);
    return { content: [{ type: "text" as const, text: `## Captures (${data.length})\n\n${lines.join("\n")}` }] };
  }
);
```

- [ ] **Step 4: `tomu_edit_capture`**

```ts
server.tool(
  "tomu_edit_capture",
  "Fix a capture: a misheard setting, or link a loose capture to a roll. Only the fields you pass change.",
  {
    capture: z.string().describe("Capture id, e.g. 'C412' or '412'"),
    roll: z.string().optional().describe("Link to this roll: display id, Dev Id, or dev seq"),
    lens: z.string().optional(),
    frameNumber: z.number().int().positive().optional(),
    shutterSpeed: z.string().optional(),
    aperture: z.string().optional(),
    compensation: z.string().optional(),
    meteringMode: z.string().optional(),
    subject: z.string().optional(),
    locationName: z.string().optional(),
    notes: z.string().optional(),
    description: z.string().optional(),
    capturedAt: z.string().optional().describe("ISO time"),
  },
  async ({ capture, roll, lens, description, capturedAt, ...rest }) => {
    const body: Record<string, unknown> = { ...rest };
    for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
    if (roll) {
      const r = await resolveRollHandle(roll);
      if (!r.roll) return { content: [{ type: "text" as const, text: r.error! }] };
      body.rollId = r.roll.id;
    }
    if (lens) {
      const { data: lenses } = await api<{ data: Array<{ id: string; make: string; model: string; focalLengthMm: number | null }> }>("/lenses");
      const match = lenses.find((l) => fuzzyMatch(lens, `${l.make} ${l.model}`, l.model, String(l.focalLengthMm ?? "")));
      if (!match) return { content: [{ type: "text" as const, text: `No lens matches "${lens}".` }] };
      body.lensId = match.id;
    }
    if (description) body.sceneDescription = description;
    if (capturedAt) body.capturedAt = new Date(capturedAt).toISOString();
    if (Object.keys(body).length === 0) return { content: [{ type: "text" as const, text: "Nothing to change." }] };
    const { data: c } = await api<{ data: CaptureRow }>(`/captures/${encodeURIComponent(capture)}`, { method: "PATCH", body: JSON.stringify(body) });
    const { data: allRolls } = await api<{ data: AnyRoll[] }>("/rolls?status=all");
    return { content: [{ type: "text" as const, text: `Updated ${captureLine(c, new Map(allRolls.map((r) => [r.id, r])))}` }] };
  }
);
```

- [ ] **Step 5: `tomu_assign_capture`**

```ts
server.tool(
  "tomu_assign_capture",
  "After development: give captures their frame numbers. Each capture becomes a real frame on its roll " +
    "(settings copied, phone photo attached as a note). Pass `roll` when any listed capture is still loose. " +
    "Runs in order and stops at the first failure.",
  {
    assignments: z.array(z.object({
      capture: z.string().describe("'C412' or '412'"),
      frameNumber: z.number().int().positive(),
    })).min(1),
    roll: z.string().optional().describe("Roll for loose captures: display id, Dev Id, or dev seq"),
  },
  async ({ assignments, roll }) => {
    let rollId: string | undefined;
    if (roll) {
      const r = await resolveRollHandle(roll);
      if (!r.roll) return { content: [{ type: "text" as const, text: r.error! }] };
      rollId = r.roll.id;
    }
    const done: string[] = [];
    for (const a of assignments) {
      try {
        const { data } = await api<{ data: { capture: CaptureRow; frame: { frameNumber: number } } }>(
          `/captures/${encodeURIComponent(a.capture)}/assign`,
          { method: "POST", body: JSON.stringify(rollId ? { rollId, frameNumber: a.frameNumber } : { frameNumber: a.frameNumber }) },
        );
        done.push(`${data.capture.captureId} → frame ${data.frame.frameNumber}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const remaining = assignments.slice(done.length + 1).map((x) => x.capture);
        return {
          content: [{
            type: "text" as const,
            text: `${done.length ? `Assigned: ${done.join(", ")}\n` : ""}Failed on ${a.capture} (frame ${a.frameNumber}): ${msg}${remaining.length ? `\nNot attempted: ${remaining.join(", ")}` : ""}`,
          }],
        };
      }
    }
    return { content: [{ type: "text" as const, text: `Assigned: ${done.join(", ")}` }] };
  }
);
```

- [ ] **Step 6: Build and test via the dev MCP server**

Run: `npm run build -w packages/mcp` — expected clean.

Restart the `tomu-dev` MCP server (Claude Code: `/mcp` → reconnect, or restart the session), then exercise: `tomu_capture` with `camera` for an active roll and with no camera; `tomu_captures`; `tomu_edit_capture` changing `aperture`; `tomu_assign_capture` on the loose one without `roll` (expect the "not linked" error), then with `roll`. Delete test artifacts afterwards via the API (`DELETE /captures/:id?force=true`, and the created frame).

- [ ] **Step 7: Update `CLAUDE.md`** — in the MCP tool list add:

```markdown
- **Field** — `tomu_capture`, `tomu_captures`, `tomu_edit_capture`, `tomu_assign_capture` (photo attaches via `npm run photos:sync` on the laptop, never through Claude)
```

and change the Deployment bullet `**Files**: DO Spaces (S3-compatible) for images and scans` to `**Files**: capture photos on droplet disk under \`UPLOADS_DIR\` (served at \`/uploads/\`); DO Spaces planned for scans`.

- [ ] **Step 8: Commit**

```bash
git add packages/mcp/src/server.ts CLAUDE.md
git commit -m "feat(mcp): tomu_capture / tomu_captures / tomu_edit_capture / tomu_assign_capture" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01Q6jMVz9nSKsnyFxZP939Xi"
```

---

### Task 8: Laptop photo sync script

**Files:**
- Create: `scripts/photos-sync.ts`
- Modify: `package.json` (root: `photos:sync` script, `tsx` devDependency)
- Modify: `docs/SELF-HOSTING.md` (short "Field captures" section)

**Interfaces:**
- Consumes: `matchPhotos`, `MatchCapture`, `CandidatePhoto` from `@tomu/shared`; API `GET /captures?status=all&since=`, `POST /captures/:id/photo`.
- Produces: `npm run photos:sync [-- --dry-run --since 14 --force C412=<uuid> --window-before 10 --window-after 2]`.

- [ ] **Step 1: Root wiring** — in `package.json` add to `scripts`:

```json
    "photos:sync": "tsx --env-file-if-exists=.env scripts/photos-sync.ts"
```

and run `npm install -D tsx@^4` at the root so the binary is guaranteed hoisted.

- [ ] **Step 2: Write `scripts/photos-sync.ts`**

```ts
#!/usr/bin/env tsx
/**
 * Attach iPhone photos (via the Mac Photos library) to Tomu field captures by time.
 *
 * Needs: `pip install osxphotos`, and TOMU_API_URL + TOMU_API_TOKEN in .env.
 * Usage: npm run photos:sync -- [--dry-run] [--since 14] [--force C412=<photo-uuid>]...
 *        [--window-before 10] [--window-after 2]
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { matchPhotos, parseCaptureId, type CandidatePhoto, type MatchCapture } from "@tomu/shared";

const run = promisify(execFile);
const API = process.env.TOMU_API_URL || "http://localhost:3456/api/v1";
const TOKEN = process.env.TOMU_API_TOKEN || "";
if (!TOKEN) { console.error("TOMU_API_TOKEN missing (.env)"); process.exit(2); }

// ── args ──
const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(n);
const opt = (n: string, d: string) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const dryRun = flag("--dry-run");
const sinceDays = Number(opt("--since", "14"));
const windowBeforeMin = Number(opt("--window-before", "10"));
const windowAfterMin = Number(opt("--window-after", "2"));
const forcedArg = new Map<string, string>();
argv.forEach((a, i) => { if (a === "--force" && argv[i + 1]) { const [c, u] = argv[i + 1].split("="); if (c && u) forcedArg.set(c, u); } });

interface Capture {
  id: string; captureId: string; seq: number; capturedAt: string;
  fileKey: string | null; photoAssetId: string | null;
}
interface OsxPhoto { uuid: string; date: string; latitude: number | null; longitude: number | null; original_filename: string; ismissing: boolean }

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, ...(init.headers as Record<string, string> ?? {}) } });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

function isoMinus(ms: number, from = Date.now()) { return new Date(from - ms).toISOString(); }

async function osxQuery(fromIso: string, toIso: string): Promise<OsxPhoto[]> {
  const { stdout } = await run("osxphotos", ["query", "--json", "--only-photos", "--from-date", fromIso, "--to-date", toIso], { maxBuffer: 64 * 1024 * 1024 });
  return stdout.trim() ? (JSON.parse(stdout) as OsxPhoto[]) : [];
}

async function osxExport(uuid: string, dir: string): Promise<string> {
  await run("osxphotos", ["export", dir, "--uuid", uuid, "--convert-to-jpeg", "--jpeg-quality", "0.9", "--download-missing", "--filename", "{uuid}", "--overwrite"]);
  const files = (await readdir(dir)).filter((f) => f.toLowerCase().startsWith(uuid.toLowerCase()) && f.toLowerCase().endsWith(".jpeg") || f.toLowerCase().endsWith(".jpg"));
  if (!files.length) throw new Error(`export produced no jpeg for ${uuid}`);
  return join(dir, files[0]);
}

async function main() {
  const since = isoMinus(sinceDays * 86_400_000);
  const { data: all } = await api<{ data: Capture[] }>(`/captures?status=all&since=${encodeURIComponent(since)}&limit=500`);
  const usedAssetIds = new Set(all.map((c) => c.photoAssetId).filter((x): x is string => !!x));
  const todo = all.filter((c) => !c.fileKey);
  if (!todo.length) { console.log("Nothing to sync: every capture in range has a photo."); return; }

  // One osxphotos query spanning all captures (cheaper than one per capture).
  const times = todo.map((c) => Date.parse(c.capturedAt));
  const from = isoMinus(windowBeforeMin * 60_000, Math.min(...times));
  const to = new Date(Math.max(...times) + windowAfterMin * 60_000).toISOString();
  const photos = (await osxQuery(from, to)).filter((p) => !p.ismissing || true);
  const byUuid = new Map(photos.map((p) => [p.uuid, p]));
  const cands: CandidatePhoto[] = photos.map((p) => ({ uuid: p.uuid, takenAt: new Date(p.date).toISOString() }));

  const forced = new Map<string, string>();
  for (const [cid, uuid] of forcedArg) {
    const seq = parseCaptureId(cid);
    const cap = todo.find((c) => c.seq === seq);
    if (cap) forced.set(cap.id, uuid);
  }
  const caps: MatchCapture[] = todo.map((c) => ({ id: c.id, capturedAt: c.capturedAt }));
  const results = matchPhotos(caps, cands, { usedAssetIds, forced, windowBeforeMin, windowAfterMin });

  const tmp = await mkdtemp(join(tmpdir(), "tomu-photos-"));
  const rows: string[][] = [["capture", "captured at", "status", "photo", "delta"]];
  try {
    for (const r of results) {
      const cap = todo.find((c) => c.id === r.captureId)!;
      const when = cap.capturedAt.slice(0, 16).replace("T", " ");
      if (r.status === "none") { rows.push([cap.captureId, when, "no photo", "", ""]); continue; }
      if (r.status === "ambiguous") {
        rows.push([cap.captureId, when, "AMBIGUOUS", (r.candidates ?? []).map((c) => `${c.uuid.slice(0, 8)} (${c.deltaSeconds}s)`).join(" | "), ""]);
        continue;
      }
      const p = byUuid.get(r.photoUuid!)!;
      if (dryRun) { rows.push([cap.captureId, when, "would upload", p.original_filename, `${r.deltaSeconds}s`]); continue; }
      const file = await osxExport(p.uuid, tmp);
      const form = new FormData();
      form.set("file", new Blob([await readFile(file)], { type: "image/jpeg" }), `${p.uuid}.jpg`);
      form.set("photoTakenAt", new Date(p.date).toISOString());
      if (p.latitude != null) form.set("latitude", String(p.latitude));
      if (p.longitude != null) form.set("longitude", String(p.longitude));
      form.set("photoAssetId", p.uuid);
      await api(`/captures/${cap.id}/photo`, { method: "POST", body: form });
      rows.push([cap.captureId, when, "uploaded", p.original_filename, `${r.deltaSeconds}s`]);
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }

  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  for (const r of rows) console.log(r.map((c, i) => c.padEnd(w[i])).join("  "));
  const amb = results.filter((r) => r.status === "ambiguous").length;
  if (amb) console.log(`\n${amb} ambiguous — resolve with: npm run photos:sync -- --force C<seq>=<photo-uuid>`);
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
```

Fix the `filter` precedence bug in `osxExport` before running: it should read

```ts
  const files = (await readdir(dir)).filter((f) => {
    const l = f.toLowerCase();
    return l.startsWith(uuid.toLowerCase()) && (l.endsWith(".jpeg") || l.endsWith(".jpg"));
  });
```

and drop the no-op `.filter((p) => !p.ismissing || true)` (keep missing photos; `--download-missing` fetches them).

- [ ] **Step 3: Install osxphotos and dry-run**

```bash
pip3 install --user osxphotos   # or pipx install osxphotos
osxphotos --version
```

Create one capture via the dev MCP or curl, take a photo on the iPhone within a few minutes before it (or backdate the capture with `capturedAt` to ~1 minute after an existing photo's time), wait for iCloud sync, then:

```bash
npm run photos:sync -- --dry-run --since 2
```

Expected: table with the capture marked `would upload` and the phone photo's filename with a negative delta. Then run without `--dry-run`; expected `uploaded`; `GET /captures/C<seq>` shows `fileUrl`, `photoTakenAt`, `photoAssetId`; second run prints "Nothing to sync".

Time-zone check: `osxphotos query --json` `date` carries an offset (e.g. `2026-09-06T02:58:30-07:00`); `new Date(p.date).toISOString()` normalizes to UTC. Confirm the delta printed matches the real gap.

- [ ] **Step 4: Docs** — append to `docs/SELF-HOSTING.md`:

```markdown
## Field captures and phone photos

Captures (`tomu_capture`) hold spoken settings; the phone photo is attached later
from a Mac with the iCloud Photos library: `pip install osxphotos`, put
`TOMU_API_URL` and `TOMU_API_TOKEN` in `.env`, then `npm run photos:sync`
(`--dry-run` first). Photos are matched by time (window −10/+2 min around the
capture) and uploaded to `UPLOADS_DIR` on the server (`/uploads/` in nginx).
Uploads are **not** in the Postgres dump — back that directory up separately.
```

- [ ] **Step 5: Commit**

```bash
git add scripts/photos-sync.ts package.json package-lock.json docs/SELF-HOSTING.md
git commit -m "feat(scripts): photos-sync — attach Photos-library images to captures by time" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01Q6jMVz9nSKsnyFxZP939Xi"
```

---

### Task 9: UI — pending captures on roll detail

**Files:**
- Modify: `packages/client/src/services/api.ts` (`RollDetail`, ~line 131)
- Modify: `packages/client/src/components/rolls/RollsPage.tsx` (`RollDetailView`, ~lines 141–224)

**Interfaces:**
- Consumes: `Capture` type from `@tomu/shared`; `pendingCaptures` from `GET /rolls/:id`.

- [ ] **Step 1: Type** — in `api.ts` import `Capture` from `@tomu/shared` and extend:

```ts
export type RollDetail = RollListItem & {
  frames: Frame[];
  notes: Note[];
  frameNotes: Note[];
  pendingCaptures: (Capture & { captureId: string })[];
};
```

- [ ] **Step 2: Render** — in `RollDetailView`, after the timeline block and before `<AddFrameDialog …>`, add:

```tsx
      {detail.pendingCaptures.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-xs font-medium text-muted-foreground">
            Pending captures ({detail.pendingCaptures.length}) — assign frame numbers with tomu_assign_capture
          </div>
          <ul className="space-y-1.5 text-xs">
            {detail.pendingCaptures.map((c) => {
              const settings = [c.shutterSpeed, c.aperture, c.compensation].filter(Boolean).join(" ");
              return (
                <li key={c.id} className="flex gap-2">
                  {c.fileUrl ? (
                    <img src={c.fileUrl} alt="" className="h-12 w-12 shrink-0 rounded object-cover" loading="lazy" />
                  ) : (
                    <div className="h-12 w-12 shrink-0 rounded border border-dashed border-border" />
                  )}
                  <div className="flex-1">
                    <span className="font-medium">{c.captureId}</span>
                    <span className="ml-1 text-muted-foreground tabular-nums">{formatTime(c.photoTakenAt ?? c.capturedAt)}</span>
                    {settings && <span className="ml-1 text-muted-foreground">{settings}</span>}
                    {c.subject && <div className="text-foreground">{c.subject}</div>}
                    {c.sceneDescription && <div className="text-muted-foreground italic">{c.sceneDescription}</div>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
```

`formatTime` already exists in the file (~line 268).

- [ ] **Step 3: Check in the browser**

Run: `npm run lint && npm run build -w packages/client`, then with `npm run dev:client` open a roll that has a pending capture (from Task 6/7 tests). Expected: section renders under the timeline, thumbnail shows when a photo was synced, dashed square otherwise; hidden on rolls with no pending captures. Check at 390 px width (mobile) that nothing overflows.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/services/api.ts packages/client/src/components/rolls/RollsPage.tsx
git commit -m "feat(client): read-only pending captures on roll detail" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01Q6jMVz9nSKsnyFxZP939Xi"
```

---

### Task 10: Deploy wiring, backups note, roadmap

**Files:**
- Modify: `deploy/nginx/tomu.conf`
- Modify: `scripts/deploy.sh` (rsync excludes)
- Modify: `RESTORE.md`
- Modify: `ROADMAP.md`

- [ ] **Step 1: nginx** — in `deploy/nginx/tomu.conf`, before the SPA `location /` block:

```nginx
    # Uploaded files (capture photos). Written by the API under UPLOADS_DIR.
    location /uploads/ {
        alias /home/USER/tomu/uploads/;
        expires 30d;
        add_header Cache-Control "public";
    }
```

- [ ] **Step 2: deploy.sh** — add to the rsync exclude list:

```bash
  --exclude 'uploads' \
```

- [ ] **Step 3: RESTORE.md** — after the "How backups run" list add:

```markdown
- **Uploaded files** (`uploads/` on the droplet — capture photos) are **not** in
  the nightly dump. Until file storage moves to Spaces, pull a copy after each
  `photos:sync` run: `rsync -a fhwrdh@<droplet>:filmlog/uploads/ ./uploads/`
  (kept out of git via `.gitignore`).
```

- [ ] **Step 4: ROADMAP.md** — under `## Data model` add:

```markdown
- ~~**Reference image attachments**~~ V1 shipped 2026-09 as **field captures** (`captures` table, `tomu_capture`/`tomu_captures`/`tomu_edit_capture`/`tomu_assign_capture`, `scripts/photos-sync.ts`). Photos live on droplet disk under `UPLOADS_DIR`; not in the nightly dump (manual rsync, see RESTORE.md). Spec: `docs/superpowers/specs/2026-09-06-field-captures-design.md`.
- **Captures V2** — UI-side assignment with thumbnails; reconciliation from Lightroom scan order; move uploads to Spaces with a replication story; thumbnails.
```

- [ ] **Step 5: Full gate, then commit and PR**

Run: `npm run test:coverage && npm run build` — expected: all green, coverage thresholds hold.

```bash
git add deploy/nginx/tomu.conf scripts/deploy.sh RESTORE.md ROADMAP.md
git commit -m "chore: uploads dir in nginx/deploy/backup docs; roadmap for captures" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01Q6jMVz9nSKsnyFxZP939Xi"
git push -u origin feat/field-captures
gh pr create --title "Field captures V1: pseudo-EXIF from the field + phone-photo sync" --body-file - <<'EOF'
Implements docs/superpowers/specs/2026-09-06-field-captures-design.md.

- `captures` table + `/api/v1/captures` (CRUD, multipart photo upload, assign → frame + photo note)
- MCP: `tomu_capture`, `tomu_captures`, `tomu_edit_capture`, `tomu_assign_capture`
- `scripts/photos-sync.ts`: matches Mac Photos-library images to captures by time (osxphotos), uploads to `UPLOADS_DIR`
- Roll detail shows pending captures (read-only)
- nginx `/uploads/` location, deploy excludes, backup note

**Deploy notes (owner):** merge triggers the app deploy; then (1) apply the nginx `/uploads/` block on the droplet and reload, (2) run the deploy with `migrate` to create the table, (3) `mkdir -p ~/filmlog/uploads`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Q6jMVz9nSKsnyFxZP939Xi
EOF
```

- [ ] **Step 6: Owner-gated droplet steps** (do not run without explicit approval; list them in the final report):

1. Add the nginx `/uploads/` block to the live site config (path `/home/fhwrdh/filmlog/uploads/`), `nginx -t && systemctl reload nginx`.
2. Merge the PR (auto-deploy), then run the Deploy workflow manually with `migrate = true` (or `npm run deploy:migrate`) to create `captures`.
3. `mkdir -p /home/fhwrdh/filmlog/uploads` as `fhwrdh` (the API also creates it on boot).
4. Add the claude.ai connector on the phone (pending since 2026-08-15).
5. First field test: one capture from the phone, one photo, `npm run photos:sync -- --dry-run` on the laptop.

---

## Self-review

**Spec coverage.** §1 table → Task 3; shared types/schemas/id helpers → Task 1; §2 routes: create/list/get/patch/delete → Task 4, photo → Task 5, assign + `pendingCaptures` + static + nginx + rsync exclude + `UPLOADS_DIR` → Tasks 5, 6, 10, 3; §3 four MCP tools + CLAUDE.md → Task 7; §4 sync script incl. flags and `photoAssetId` idempotency → Task 8 (+ Task 2 matcher); §5 UI → Task 9; §6 backups → Task 10; §7 errors: 400/404/409/413/415 present in Tasks 4–6; §8 tests → Tasks 1, 2 (server mapping test folded into `capture.test.ts` since `captureToFrame` lives in shared); §9 rollout → Task 10 step 6.

**Deviations from spec, deliberate.** Note type is `photo`/`text` instead of `reference` (enum constraint, noted in Task 6). `captureToFrame` and its test live in shared rather than `packages/server/test` so the existing vitest include/coverage config applies unchanged.

**Type consistency.** `CaptureRow` (MCP) fields match `presentCapture` output; `captureFilePath`/`findCapture`/`presentCapture` are defined in Task 4 and used in 5–6; `MatchCapture`/`CandidatePhoto`/`MatchResult` names match between Task 2 and Task 8; `captureId` string appears on every API row and on `pendingCaptures`.
