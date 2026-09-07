# Field captures — pseudo-EXIF for film, V1

Date: 2026-09-06. Status: design approved in chat, spec for review.

## Problem

In the field the photographer takes a phone photo of the scene and speaks the
exposure settings to Claude on the phone. Tomu should store those settings as
"pseudo-EXIF" for a film frame that does not have a frame number yet, keep the
phone photo alongside, and let the two be reconciled with a roll or sheet after
development. Zero copy-paste in the field.

## Constraint that shapes the design

Claude cannot forward image bytes or EXIF to an MCP tool. The model sees the
photo as pixels only; metadata is stripped before it arrives; there is no file
handle to pass through a JSON tool call. So the photo takes a separate path:
iPhone → iCloud Photos → Mac Photos library → a laptop script that matches
photos to captures **by time** and uploads them. Claude contributes only words:
settings, subject, and a description of what it saw.

## Decisions (from the brainstorm)

- Capture surface: Claude app on the phone with the Tomu MCP connector.
- Photo bytes never pass through Claude; laptop sync matches by timestamp.
- A capture links to the camera's active roll when a camera hint is given,
  otherwise stays loose. Frame number deferred unless given (LF sheets).
- Photos stored on the droplet's disk under `uploads/`. Re-evaluate DO Spaces
  after some use.
- Reconciliation (assigning frame numbers) is MCP-only in V1. The UI shows
  pending captures read-only.
- Out of scope for V1: DO Spaces, UI assignment, Lightroom-side reconciliation,
  voice parsing (Claude does it), Android/other-phone paths.

## Alternatives rejected

- **Frames with nullable roll/frame_number.** Breaks the `(roll_id,
  frame_number)` uniqueness and every consumer of `frames`.
- **`notes` rows typed "capture".** Has file columns but no exposure fields;
  would bolt settings onto a notes table.

## 1. Data model

New table `captures` (Drizzle, `packages/server/src/db/schema.ts`):

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `user_id` | uuid fk users | |
| `seq` | integer not null | per-user, monotonically increasing; shown as `C412`. Unique index on `(user_id, seq)`. |
| `status` | text not null default `pending` | `pending` or `assigned` |
| `roll_id` | uuid fk rolls, on delete set null | set when a camera hint resolved an active roll |
| `camera_id` | uuid fk cameras | resolved from the hint even when no active roll exists |
| `lens_id` | uuid fk lenses | |
| `frame_number` | integer | supplied in the field for LF sheets, or at assign time |
| `captured_at` | timestamptz not null | server time of the tool call unless the caller passes an explicit time |
| `shutter_speed`, `aperture`, `compensation`, `metering_mode`, `subject`, `location_name`, `notes` | text | same semantics as `frames` |
| `scene_description` | text | Claude's description of the phone photo |
| `file_key` | text | relative path under uploads, e.g. `captures/<id>.jpg` |
| `file_url` | text | public path `/uploads/captures/<id>.jpg` |
| `mime_type`, `file_size_bytes`, `width_px`, `height_px` | | from the upload |
| `photo_taken_at` | timestamptz | from the phone photo's EXIF, via the sync script |
| `latitude`, `longitude` | numeric(10,7) | from the phone photo's EXIF |
| `photo_asset_id` | text | Photos library UUID; makes re-syncs idempotent |
| `frame_id` | uuid fk frames, on delete set null | set at assign time |
| `created_at`, `updated_at` | | shared `timestamps` |

`seq` is assigned in the create route as `max(seq)+1` for the user inside the
insert transaction. Uniqueness index catches a race; the route retries once.

Shared types (`packages/shared`): `Capture`, `CaptureStatus`,
`createCaptureSchema`, `updateCaptureSchema`, `assignCaptureSchema`,
`capturePhotoMetaSchema`. `formatCaptureId(seq)` → `C412`; `parseCaptureId`
accepts `C412`, `c412`, `412`.

Migration: take a timestamped snapshot into `db-backups/` first
(`pre-captures-table-<ts>.sql`), then `db:push`. No data backfill.

## 2. API

All under `/api/v1/captures`, JWT-protected like every other route.

- `POST /` — body per `createCaptureSchema`: optional `rollId`, `cameraId`,
  `lensId`, `frameNumber`, `capturedAt`, exposure fields, `sceneDescription`.
  Assigns `seq`. Returns `{ data: capture }`.
- `GET /?status=pending&roll_id=&since=&limit=` — newest first. Default
  `status=pending`; `status=all` lifts the filter.
- `GET /:id` — accepts uuid or `C412`.
- `PATCH /:id` — any of the settings/link fields. Used by the MCP correction
  path and by the sync script to set `rollId` when the field call was loose.
- `POST /:id/photo` — multipart. Fields: `file` (jpeg/heic-converted jpeg,
  max 25 MB), `photoTakenAt`, `latitude`, `longitude`, `photoAssetId`.
  Writes `uploads/captures/<id>.jpg` (overwrites), fills the file/EXIF
  columns, returns the capture. Dimensions read from the JPEG header
  (`image-size` package); no thumbnailing in V1.
- `POST /:id/assign` — body `{ rollId?, frameNumber }`. Requires the capture
  to end up with a roll: either already linked or given here. Inside one
  transaction: create the `frames` row (settings copied; `shot_at =
  photo_taken_at ?? captured_at`; lat/long and `location_name` copied; `lens_id`
  copied), create a `notes` row `type = "reference"` on that frame with
  `file_key`/`file_url`/`mime_type`/`file_size_bytes`/`latitude`/`longitude`
  and `content = scene_description`, set `capture.frame_id`, `status =
  assigned`, `frame_number`. If the frame number already exists on the roll,
  400 with a message naming the existing frame. Returns
  `{ data: { capture, frame } }`.
- `DELETE /:id` — removes the row and the file. Assigned captures refuse
  (the frame and note own the data now) unless `?force=true`.

Roll response: `GET /rolls/:id` adds `pendingCaptures` (count + the rows), so
the UI and `tomu_rolls` can show them without a second query.

Static files: `uploads/` at the repo root, gitignored. Dev: `@fastify/static`
serves it at `/uploads/`. Prod: nginx `location /uploads/ { alias …; }` added to
`deploy/nginx/tomu.conf`; `scripts/deploy.sh` rsync excludes `uploads/`.
Config: `UPLOADS_DIR` env (default `<repo>/uploads`), validated in `config.ts`.

## 3. MCP tools (`packages/mcp/src/server.ts`)

- `tomu_capture` — args: `camera?` (hint, resolves active roll like
  `tomu_shoot`), `lens?`, `frameNumber?`, `shutterSpeed?`, `aperture?`,
  `compensation?`, `meteringMode?`, `subject?`, `locationName?`, `notes?`,
  `description?` (what Claude sees in the photo), `capturedAt?` (ISO; for
  "that was ten minutes ago"). Behavior: camera hint resolves to exactly one
  active roll → linked; hint resolves to a camera with no active roll → camera
  linked, roll loose, reply says so; no hint → loose, no error. Returns one line:
  `C412 · Mamiya 7 · roll 20260906.1 · 1/250 f/8 · pending photo`.
  Never asks a clarifying question when a required field is missing; a capture
  with only a description is valid. Ambiguous camera hint → lists candidates,
  does not create (same rule as `tomu_shoot`).
- `tomu_captures` — list. Args: `roll?` (display id / dev id / uuid),
  `status?` (`pending` default, `assigned`, `all`), `limit?`. Shows id, time,
  camera/roll, settings, whether a photo is attached, frame if assigned.
- `tomu_assign_capture` — args: `assignments: [{ capture, frameNumber }]`,
  `roll?` (required when any listed capture is loose; applied to all loose
  ones). Runs assignments in order, stops at the first failure, reports what
  landed and what didn't. Supports "captures 410, 411, 412 on roll X are
  frames 3, 4, 5".
- `tomu_edit_capture` — `capture` id plus the same optional fields as
  `tomu_capture`; calls `PATCH`. Fixes a misheard setting or moves a loose
  capture onto a roll. Kept separate so each tool stays single-purpose.

CLAUDE.md tool list gains a **Field** group. Tool descriptions state the
photo rule plainly so Claude on the phone does not attempt to upload the image
or apologize for not being able to.

## 4. Laptop photo sync (`scripts/photos-sync.ts`)

Node/TypeScript script run on the Mac (`npm run photos:sync`). Requires
`osxphotos` (`pip install osxphotos`) and a `TOMU_API_URL` + `TOMU_API_TOKEN`
in `.env` (same vars the MCP server uses).

Steps:

1. `GET /captures?status=all&since=<N days>` and keep those with no
   `file_key`. Default window 14 days, `--since` overrides.
2. For each capture, run `osxphotos query --json --from-date <captured_at −
   10 min> --to-date <captured_at + 2 min> --only-photos` and parse the
   results (uuid, `date`, `latitude`/`longitude`, `original_filename`,
   `ismissing`/`incloud` flags).
3. Match via the pure function `matchPhotos(captures, photos)` in
   `scripts/lib/photo-match.ts`:
   - candidates = photos inside the window, not already used by another
     capture in this run and not already recorded as `photo_asset_id` on any
     capture;
   - pick the candidate nearest to `captured_at`, preferring those *before*
     it (the photo is normally taken, then the settings are spoken);
   - ambiguous when the two nearest candidates are within 30 s of each other,
     or two captures claim the same photo → skip both, report;
   - captures with no candidate → report "no photo".
4. Export matched photos with `osxphotos export --uuid <uuid> --convert-to-jpeg
   --jpeg-quality 0.9 --download-missing` into the scratch dir, then
   `POST /captures/:id/photo` with the file, `photoTakenAt`, lat/long,
   `photoAssetId`.
5. Print a table: capture, matched photo time, delta, status
   (uploaded / no photo / ambiguous / already has photo).

Flags: `--dry-run` (match and report only), `--since <days>`,
`--force C412=<photo-uuid>` (repeatable; resolves an ambiguous one by hand),
`--window-before <min>` / `--window-after <min>`.

Assumptions: Photos library is the iCloud-synced default library; the Mac
clock and the phone clock are both NTP-correct; `captured_at` is server time,
which is UTC, and phone EXIF times are converted to UTC by osxphotos.

## 5. UI

Roll detail (`RollsPage.tsx` roll drawer/detail) gains a **Pending captures**
section: thumbnail (the uploaded JPEG scaled by CSS; no thumbnail generation),
capture id, time, settings line, description. No editing. Hidden when empty.
Mobile layout follows existing cards. Darkroom palette; no new colors.

## 6. Storage and backups

- Uploads live at `UPLOADS_DIR` on the droplet (`/home/fhwrdh/filmlog/uploads`),
  owned by `fhwrdh`, served read-only by nginx.
- The nightly `pg_dump` does not include files. V1 adds a manual step to
  `RESTORE.md`: `rsync -a fhwrdh@<droplet>:filmlog/uploads/ ./uploads/` from
  the laptop, run whenever the sync script has uploaded. Flagged in ROADMAP as
  the thing to solve when Spaces is revisited.
- Phone JPEGs at 0.9 quality run 2–5 MB; 500 captures ≈ 2 GB. Fine on 80 GB.

## 7. Error handling

- Create never fails for missing settings. Only an ambiguous camera hint
  refuses.
- Assign is transactional; duplicate frame number → 400 naming the conflict;
  loose capture with no roll → 400.
- Photo upload: wrong mime → 415; too large → 413; a second upload overwrites
  the file and metadata (idempotent re-sync).
- Sync script never guesses on ambiguity; exits 0 with a report, non-zero only
  on API/auth/osxphotos failures.

## 8. Testing

Vitest, inside the existing coverage gate:

- `packages/shared/test/capture-id.test.ts` — `formatCaptureId` /
  `parseCaptureId`.
- `scripts/lib/photo-match.test.ts` — nearest-before preference, window
  edges, ambiguity within 30 s, duplicate claims, already-used asset ids,
  no-candidate case.
- `packages/server/test/capture-assign.test.ts` — pure mapping
  `captureToFrame(capture)` (which fields copy, `shot_at` fallback).
- MCP resolution reuses `pickActiveRoll`; existing tests for that stand.
  Route handlers and osxphotos calls are exercised by hand against the dev DB
  and a real Photos library, not unit-tested in V1.

## 9. Rollout

1. Schema + shared types + routes + tests. Snapshot, `db:push` locally.
2. MCP tools; verify with the `tomu-dev` server.
3. Sync script; dry-run against the real Photos library with one or two
   staged captures.
4. UI pending list.
5. nginx `uploads` location on the droplet (manual, owner approval), deploy
   via PR merge, `deploy:migrate`.
6. Owner adds the claude.ai connector on the phone (still pending from the
   deploy follow-ups). First field test.

## Open questions deferred to V2

- Assignment from Lightroom scans (Tomu reading scan order / timestamps).
- UI-side assignment with thumbnails.
- Spaces vs disk once volume is known.
- Thumbnails for the UI list.
