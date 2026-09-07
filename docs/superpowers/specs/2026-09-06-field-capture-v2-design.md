# Field capture V2 — the in-the-field interface

Date: 2026-09-06. Status: design approved in chat, spec for review. Supersedes the
capture surface of `2026-09-06-field-captures-design.md` (V1); V1's server routes,
MCP tools, and `photos:sync` remain as fallbacks and are re-pointed at the new model.

## North star for this feature

> The film camera gets what it gets. Tomu enriches with everything else.
> "I want to describe the sound of the photo as much as the exposure stats."

A field capture is a field note about the experience of a frame. Exposure fields are the
extractable subset. The raw dictation is kept verbatim and shown first. Tomu is the
envelope around the negative; each stage adds to the envelope without touching the light.

## Requirements (acceptance criteria)

The field interface must be:

1. **Low friction to capture** — one tap, talk, done. Photo optional and independent.
2. **Liberal in what it accepts** — rambles, sparse frame numbers, wrong order, no
   camera named, no roll loaded. Never blocks, never nags.
3. **Offline capable** — everything works with no signal; syncs later.
4. **Reviewable and correctable in the moment** — "scratch that", tap a chip to fix,
   see what was parsed and what was missed.

## Decisions (from the brainstorm)

- Surface: a `/capture` route in the existing React PWA. Not the Claude app, not native.
- Voice via the keyboard mic (Wispr Flow or Apple dictation) into a text field. Tomu
  records no audio in V2 (mic contention with dictation keyboards; revisit in V3 behind a
  spike). Wispr Flow keeps its own dictation history if re-listening is ever needed.
- The model is out of the hot path: deterministic regex parse on device, model parse
  server-side on sync and on demand. The model is a second opinion, never the gate.
- Raw transcript is immutable and first-class displayed content.
- Frame numbers are provisional and sparse: a spoken number wins; otherwise next after
  the highest noted; gaps are normal. Sheets (4x5) require a spoken/tapped holder id.
- A reference photo is its own event on the stream (time, GPS), not a field on a
  capture. Pinning to frames happens at the desk.
- One spoken command: "scratch that" / "delete last" (regex-detected). Corrections are
  delete-and-say-again, or tap-to-edit.
- Nice to have: expected-field chips render as dashed placeholders when empty; the
  model's review reason shows under the chip; parser-consumed transcript spans are
  faintly underlined.

## Alternatives rejected

- Separate minimal PWA (duplicate auth/gear code, second deploy).
- Native iOS app (best mic/camera control, worst maintenance; not yet).
- Shortcut + photo inbox (superseded once the photo became an independent event).
- Web Speech API in Safari (flaky; keyboard dictation is better and already offline).
- Model parse in the field (blocks capture on connectivity and latency).

## 1. Data model — the stream

`field_events`: one row per thing captured in the field. Replaces `captures`.

| column | type | notes |
|---|---|---|
| `id` | uuid pk | server id |
| `client_id` | uuid not null unique | minted on the phone; sync is idempotent on it |
| `user_id` | uuid fk users | |
| `kind` | text not null | `voice` or `photo` |
| `captured_at` | timestamptz not null | phone clock at save; photo EXIF time for `photo` |
| `latitude`, `longitude` | numeric(10,7) | Geolocation at save, or photo EXIF |
| `roll_id` | uuid fk rolls set null | from the header's active roll or a spoken camera |
| `camera_id` | uuid fk cameras | |
| `frame_number` | integer | spoken or provisional |
| `frame_provisional` | boolean not null default false | true when auto-assigned |
| `transcript` | text | immutable after save (voice events) |
| `file_key`, `file_url`, `mime_type`, `file_size_bytes`, `width_px`, `height_px` | | photo events |
| `shutter_speed`, `aperture`, `compensation`, `metering_mode`, `lens_id`, `subject`, `location_name` | | parsed fields |
| `parsed_at` | timestamptz | last tier-2 run |
| `parser` | text | `regex`, `claude:<model>` |
| `parse_notes` | text | model's review reason / remarks |
| `edited_fields` | text[] not null default '{}' | hand-corrected fields; never re-parsed |
| `review` | boolean not null default false | model asked for a look |
| `status` | text not null default `pending` | `pending`, `pinned` (to a frame), `roll_level` |
| `frame_id` | uuid fk frames set null | |
| `created_at`, `updated_at` | | |

Indexes: `(user_id, captured_at desc)`, `(roll_id, status)`, unique `(client_id)`.

`display_id` for events: `E<seq>` is not needed; events are addressed by time and
roll in the UI and by uuid/client_id in the API. (V1's `C<seq>` ids are retired with the
`captures` table.)

## 2. Capture screen (`/capture`)

- **Header:** camera + active roll chip: "M6 · Pan F · last noted 12/36". Tap to switch
  camera (list of cameras with active rolls first) or open the existing Load Roll dialog.
  Offline: shows cached rolls; warns "no active roll for M6" but never blocks.
- **New note button:** full width, thumb height. Focuses the transcript field so the
  keyboard mic comes up.
- **Transcript field:** auto-growing textarea. Chips below fill live from tier 1: camera,
  frame (`13?` when provisional), shutter, aperture, compensation, metering, lens.
  Expected chips (camera, frame, shutter, aperture) always render, dashed when empty.
  Tap a chip → picker; ✕ clears it and adds the field to `edited_fields`.
- **Done:** saves to IndexedDB immediately, clears the field, card appears at the top of
  the stream. Save also happens on blur with non-empty text (never lose a note).
- **"scratch that" / "delete last"** typed by dictation: deletes the in-progress note; if
  the field is empty, deletes the most recent event (undo toast for 5 s).
- **Photo button:** camera or library picker. Creates a `photo` event at once with
  EXIF time (else now) and GPS. Independent of any voice note.
- **Stream list:** today's events newest first; chips + first transcript line + sync
  badge; tap opens detail (full transcript first, fields second, edit, delete); a date
  picker reveals earlier days.
- Location: Geolocation on each save; last cached fix if slow or denied; none if never
  granted.

Nothing on this screen calls the model.

## 3. Offline store and sync

- **Store:** IndexedDB via Dexie. Tables: `events` (full event JSON, key `client_id`,
  `sync_state`), `blobs` (photo Blob by `client_id`), `gear_cache` (cameras, lenses,
  active rolls, `refreshed_at`).
- **Write path:** IndexedDB first, then enqueue. The UI reads IndexedDB only.
- **Sync worker (in-app):** runs on `online`, on visibility change to visible, and after
  each save. In order: `POST /field-events` (idempotent on `client_id`; returns the
  server row), then `POST /field-events/:id/photo` for blobs. Pulls parse results back
  per event (`GET /field-events?client_ids=`). Exponential backoff per item; a failed
  item never blocks others.
- **Sync states:** `queued` → `synced` → `parsed` | `needs review`.
- **Service worker:** app shell precached (`vite-plugin-pwa`) so `/capture` opens with
  no signal. No Background Sync API (unsupported on iOS); the worker runs while the app
  is open.
- **Conflicts:** none by design. The phone is the sole writer of transcript and the
  parsed fields it set; desk-side edits mark `edited_fields`; a later phone sync sends
  only fields it owns and the server ignores any field listed in `edited_fields`.
- **Gear cache refresh:** on every successful sync and on manual pull-down.

## 4. Parsing — two tiers

**Tier 1, on device, deterministic.** `packages/shared/src/field-parse.ts`, pure:

- shutter: `1/250`, `250`, `two fifty`, `two-fiftieth`, `2s`, `two seconds`, `half a second`, `bulb`
- aperture: `f8`, `f/8`, `f 8`, `eight`, `five six`, `two point eight`, `f/2.8`
- compensation: `+1`, `plus one`, `minus a third`, `-2/3`, `plus two thirds`
- metering: incident, spot, average, center, sunny 16, guess
- frame: `frame 12`, `number 12`, `twelve`(only when preceded by frame/number)
- sheet: `holder 3 a`, `sheet 3b` (formats `4x5`, `8x10`)
- camera / lens: fuzzy against the gear cache using the MCP matching rules
- command: `scratch that`, `delete last`, `delete that`

Returns `{ fields, spans, command }`; `spans` are `[start, end, field]` ranges of the
transcript the parser consumed (for the underline nice-to-have). Runs on every input
change. Never modifies the transcript.

**Tier 2, server, model.** `packages/server/src/services/field-parse-model.ts`:

- Runs on first sync of a `voice` event and on demand. Claude Haiku-class, structured
  output: the tier-1 fields plus `subject`, `location_name`, `remarks` (notes-worthy
  lines), `scene_description` when a `photo` event exists within 10 min on the same
  roll (image sent along), per-field `confidence`, and `review_reason`.
- Merge rules: a field in `edited_fields` is never touched; a tier-1 value stands
  unless the model's confidence ≥ 0.9; empty fields are filled from the model; the
  transcript is never modified. Sets `parsed_at`, `parser`, `parse_notes`, `review`.
- Prompt in repo (`packages/server/src/services/field-parse-prompt.md`) with the gear
  list and active rolls injected; the model also flags "camera named has no active
  roll".
- Failure (API down, key missing) leaves the event `synced`; retried by a periodic job
  and by the next sync. Never sets `review`.
- Re-parse: `POST /field-events/reparse { ids? | rollId? | since? }` and the MCP tool
  `tomu_reparse_events`.
- Config: `ANTHROPIC_API_KEY`, `FIELD_PARSE_MODEL` (default `claude-haiku-4-5-20251001`).

## 5. Desk side

- `POST /field-events/:id/pin { rollId?, frameNumber }` — creates or updates the frame
  from the parsed fields (`shot_at = captured_at`, GPS, lens, settings), attaches the
  transcript as a `text` note and, for photo events, the file as a `photo` note; sets
  `status = pinned`, `frame_id`, clears `frame_provisional`.
- `POST /field-events/:id/roll-level { rollId? }` — attaches as a roll note, no frame;
  `status = roll_level`.
- `PATCH /field-events/:id` — fields (adds to `edited_fields`), roll, frame; transcript
  is rejected with 400.
- `DELETE /field-events/:id` — pending only; pinned/roll-level require `?force=true`
  and keep the frame/note/file.
- `GET /field-events` — filters: `status`, `roll_id`, `kind`, `since`, `review=true`,
  `client_ids`.
- Roll detail UI: unpinned events section, transcript first, chips second, photo
  thumbnails; pin/roll-level actions arrive in a later slice (MCP first, per the
  field-workflow rule they ship together only when the desk UI is in scope).
- MCP: `tomu_field_events` (list), `tomu_pin_event`, `tomu_roll_level_event`,
  `tomu_edit_event`, `tomu_reparse_events`. V1's `tomu_capture` becomes a thin writer of
  a `voice` event (Claude-app fallback); `tomu_captures` / `tomu_assign_capture` /
  `tomu_edit_capture` are replaced by the new names.

## 6. Migration from V1

- Create `field_events`; copy each `captures` row as a `voice` event (`client_id` =
  new uuid, `parser = 'regex'` if any settings, `status` mapped from
  pending/assigned → pending/pinned, `frame_id` kept). A capture with a file also
  spawns a `photo` event with the same `captured_at`, GPS, and file columns.
- `photos:sync` re-pointed: matches Photos-library images to `voice` events that have
  no `photo` event within the window, creating `photo` events.
- Drop `captures` after row counts match. Snapshot `db-backups/` before.

## 7. Error handling

- Field: nothing blocks. No roll → event saved loose. No GPS → null. Parser confusion →
  text stays in transcript. Save failures in IndexedDB (quota) → visible banner, note
  kept in memory until resolved.
- Sync: 4xx on an event → marked `error` with the message, visible on the card,
  retried only on tap; 5xx/network → backoff.
- Server: pin conflicts (frame exists) → 400 naming the frame; model failures never
  flag review.

## 8. Testing

Vitest, inside the coverage gate:

- `field-parse.test.ts` — every token family above, spoken numbers, spans, commands,
  camera/lens fuzzy against a fixture gear list, sheet ids, nothing-parsed case.
- `field-merge.test.ts` — tier 1 vs tier 2 vs `edited_fields` rules; confidence
  threshold; transcript immutability.
- `frame-numbering.test.ts` — spoken wins, provisional next after highest, gaps, sheets
  require id.
- `pin-mapping.test.ts` — event → frame/note fields.
- Sync worker against `fake-indexeddb`: ordering, idempotency, per-item failure
  isolation, edited-fields protection.
- Tier 2 client mocked; one fixture transcript recorded from the owner (a real ramble)
  with an expected parse.

## 9. Rollout

1. Shared parser + tests.
2. Table, migration script, routes, MCP tools (V1 tools re-pointed).
3. Tier 2 service + reparse; prompt fixture.
4. PWA: store, sync worker, capture screen, service worker.
5. Roll detail: unpinned events section.
6. Deploy (migrate), `ANTHROPIC_API_KEY` on the droplet, use from home for a week
   before any trip. Claude-app path stays live throughout.

## Open questions for V3

- Audio capture alongside dictation (mic contention spike); lazy Wi-Fi upload.
- Search across transcripts; transcript into XMP description for the Lightroom handoff.
- Desk UI for pin / roll-level.
- Pulling dictation history or audio from Wispr Flow via its MCP.
