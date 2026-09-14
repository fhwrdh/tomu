# Body–lens compatibility — design

Date: 2026-09-14. Status: draft for owner review. Not to ship before 2026-09-16, and not
before #51 (parser corrections) and #47 (MCP module split) have merged.

## 1. Why

A lens is only ever on a body it fits. Tomu does not know that today, so it cannot:

- fill in the lens for a fixed-lens camera (the XA only ever shoots its own 35mm);
- narrow the lens choices on `/capture` once a camera is picked;
- flag a lens that cannot be on the camera a note or roll names;
- answer history questions ("what did I shoot with the Nokton") from consistent data.

The owner asked for all four (2026-09-14). The trigger was the tier-2 lens regression
fixed in #51: the model chose the Mamiya N 80mm for a note that only said "Mamiya 7".
That lens does fit that body, so compatibility would not have caught it — `lensNamedIn`
(evidence in the note) and compatibility (physically possible) are separate checks,
and both are needed.

## 2. Decisions already made

| Decision | Choice |
|---|---|
| Model | Mount on bodies and lenses, owned adapters as records, built-in lenses for fixed-lens bodies. Compatibility is derived, not hand-maintained. |
| Wrong lens | Flag for review and keep the value. Never rejected, never cleared — same rule as retractions. |
| Built-in lenses | Real `lenses` rows, so a frame from the XA carries a `lensId` like any other. |
| Adapter use | Derived, not stored: a mount mismatch bridged by an owned adapter implies the adapter. |
| Mount names | A constant list in `@tomu/shared` with aliases, matched case-insensitively (Postel). |
| 4x5 | One `lens-board` mount; any board lens fits any 4x5 body. Board sizes are out of scope. |

## 3. Data model

### 3.1 Mounts (`packages/shared/src/mounts.ts`)

```ts
export const MOUNTS = {
  "leica-m":       { label: "Leica M",        aliases: ["m", "m mount", "m-mount"] },
  "m39":           { label: "M39 / LTM",      aliases: ["ltm", "l39", "leica thread", "leica screw", "screw mount"] },
  "canon-fd":      { label: "Canon FD",       aliases: ["fd"] },
  "minolta-md":    { label: "Minolta MD",     aliases: ["md", "sr"] },
  "nikon-f":       { label: "Nikon F",        aliases: ["f mount", "f-mount", "ai", "ai-s"] },
  // Not "n": N is Mamiya's lens series name, not a mount, and a one-letter alias invites collisions.
  "mamiya-7":      { label: "Mamiya 7",       aliases: ["mamiya 7 mount"] },
  "pentax-67":     { label: "Pentax 6×7",     aliases: ["pentax 67", "p67", "6x7"] },
  "olympus-pen-f": { label: "Olympus Pen F",  aliases: ["pen f"] },
  "nikonos":       { label: "Nikonos",        aliases: [] },
  "lens-board":    { label: "Lens board (4x5)", aliases: ["board", "large format"] },
  "fixed":         { label: "Fixed lens",     aliases: ["built-in", "built in"] },
  "none":          { label: "No lens (pinhole)", aliases: ["pinhole"] },
} as const;
export type MountId = keyof typeof MOUNTS;
export function normalizeMount(input: string): MountId | null;
```

`null` means unknown and is always allowed: an unknown mount never flags anything.

### 3.2 Schema (additive only)

- `cameras.mount text null` — a `MountId`.
- `cameras.built_in_lens_id uuid null → lenses.id` — required when `mount = 'fixed'`.
- `lenses.mount text null` — a `MountId`; built-in lenses carry `fixed`.
- New `adapters` table: `id`, `user_id`, `name`, `lens_mount`, `body_mount`, `notes`,
  `is_active`, timestamps. One row means "a `lens_mount` lens goes on a `body_mount` body".

No column or table is dropped, so `drizzle-kit push` stays prompt-free (it only asks
"created or renamed?" when a change adds and removes a table). The unused
`camera_lenses` table stays for now; dropping it is a separate change after confirming
it is empty in prod, via the reviewed-SQL recipe.

### 3.3 Compatibility (`packages/shared/src/compat.ts`)

```ts
type Fit =
  | { kind: "direct" }
  | { kind: "adapter"; adapterId: string }
  | { kind: "no"; reason: string }
  | { kind: "unknown" };
export function lensFits(camera, lens, adapters): Fit;
export function compatibleLenses(camera, lenses, adapters): Array<{ lens; fit }>;
```

In order:

1. Camera `none`: no lens fits (`"<camera> is a pinhole"`).
2. Camera `fixed`: only its built-in lens fits.
3. Either mount unknown: `unknown`.
4. Same mount: `direct`.
5. An active owned adapter with `lens_mount = lens.mount` and `body_mount = camera.mount`: `adapter`.
6. Otherwise `no` (`"<lens> is <mount>, <camera> is <mount>"`).

Pure and shared, so the phone, the server, the MCP server and the eval all compute the
same answer. `GearIndex` gains `mount` and `builtInLensId` on cameras, `mount` on
lenses, and an `adapters` list; `loadGear` fills them, and the offline gear cache
(`packages/client/src/offline/db.ts`) stores them.

## 4. Behaviour

### 4.1 Fixed-lens bodies fill in

When an event or frame has a `cameraId` whose mount is `fixed` and no `lensId`, the
built-in lens is filled in:

- tier 1, on device, in `offline/store.ts` after `parseTranscript`;
- server-side on create in `routes/field-events.ts`, and when frames are written
  from pinned events (`field-events.ts` pin path, `routes/rolls.ts`);
- never over a hand-edited `lensId`, and never on a `none` (pinhole) body.

This is identity, not inference, so it needs no review flag.

### 4.2 Capture narrows choices

In `CaptureHeader.tsx` / `FieldChips.tsx`, once a camera is chosen the lens chip offers:

- compatible lenses first, with adapter fits labelled (`Summicron V3 · via LTM→M`);
- lenses with unknown mount after a divider, so missing data never hides a lens;
- incompatible lenses behind "show all", never removed outright;
- a fixed body shows its built-in lens as the value, not a picker; a pinhole shows no lens chip.

No preselection for interchangeable bodies, even when only one lens fits: the M6 has
three M lenses and an adapted LTM lens, and a guessed lens is the f/50 class of error.

### 4.3 Wrong lens goes to review

A `lensId` that fails `lensFits` against the event's camera (or its roll's camera when
the event has none) keeps its value and marks the event for review:

- tier 1 gear match and tier-2 `lensId` both pass through the same check in
  `field-parse-model.ts` and on event create;
- the note names both mounts, e.g. `lens Mamiya N 80mm (mamiya-7) does not fit Leica M6 (leica-m)`,
  joined with any `reviewReason` and retraction note (#51);
- `lensNamedIn` (#51) runs first and still drops a lens the note gives no evidence for;
  compatibility only judges a lens that survived it.

### 4.4 History

- `tomu_gear list` shows each body's mount, its built-in lens, and the lenses that fit it
  (with adapter), plus owned adapters.
- New `tomu_gear` actions: `set_mount` (camera or lens, alias-tolerant) and `add_adapter`.
  Implemented in `packages/mcp/src/tools/gear.ts` after #47.
- `GET /frames?lensId=` and a `lens` filter on `tomu_rolls` (fuzzy lens name) answer
  "what did I shoot with the Nokton". The question gets reliable once 4.1 backfills
  fixed-lens frames.

## 5. API

- `createCameraSchema` / `updateCameraSchema`: optional `mount` (accepts aliases,
  stores the canonical id) and `builtInLensId`. Setting `mount: "fixed"` without a
  built-in lens is a 400 that says so.
- `createLensSchema` / `updateLensSchema`: optional `mount`.
- `/adapters`: list, create, update (`isActive` to retire). No delete, matching gear.
- Responses stay `{ data }`; mount returns as `{ id, label }`.

## 6. Seed data (owner-confirmed 2026-09-14)

| Body | Mount | Lens |
|---|---|---|
| Leica M6 | leica-m | fits: Summicron V3 50/2, Color Skopar 28/2.8, Nokton 40/1.4 (all M); old LTM lens via adapter |
| Leica IIIa | m39 | old Leica LTM lens (to be added; model unknown) |
| Mamiya 7 | mamiya-7 | Mamiya N 80mm f/4 L |
| Canon AE-1, Canon F-1 | canon-fd | — |
| Minolta X-700 | minolta-md | — |
| Nikon F3, Nikon FTn2 | nikon-f | — |
| Pentax 67 | pentax-67 | — |
| Olympus Pen FT | olympus-pen-f | — |
| Nikon Nikonos V | nikonos | — |
| Graflex Crown Graphic 4x5, Intrepid 4x5, Wista 45SP | lens-board | — |
| Chroma Cube | none | pinhole. **Recorded as 4x5; owner says 35mm** — correct the format. |
| Canon Canonet QL17 | fixed | 40mm f/1.7 |
| Olympus XA | fixed | 35mm f/2.8 |
| Rollei 35 | fixed | 40mm (Tessar f/3.5 or Sonnar f/2.8 — variant unknown) |
| Yashica Electro 35 | fixed | 45mm f/1.7 (variant unknown) |
| Yashica Samurai X3.0 | fixed | 25–75mm zoom |
| Holga 120N, Holga 120 TLR | fixed | 60mm |
| Holga 135 | fixed | 47mm |
| Kodak Jiffy Six-20 | fixed | meniscus |

Adapters: one, `m39 → leica-m`.

Seeding is a one-off script (`packages/server/scripts/seed-mounts.ts`) run against prod
through the API, idempotent, reporting what it set and what it skipped. Anything marked
unknown above is left unknown, not guessed.

## 7. Testing

- **Shared unit tests** for `lensFits` covering direct, adapter, inactive adapter, fixed
  (own lens and any other), pinhole, unknown on either side, and alias normalisation.
- **Server tests:** fixed-lens fill on create and on pin, never over an edited `lensId`;
  an incompatible lens sets review with both mounts named; mount aliases on the gear
  routes; the `fixed`-without-built-in-lens 400.
- **Eval:** `gear.json` gains mounts, and new cases cover a fixed-lens body with no lens
  spoken (expect the built-in lens) and a named lens that cannot fit the named camera
  (expect `flagged`). `bulb-on-tripod` stays as the case where the lens fits but is not named.
- **Client:** the lens chip ordering (compatible, then unknown, with incompatible hidden)
  and the fixed-body display.

## 8. Rollout

1. After 2026-09-16, and after #51 and #47 merge.
2. Shared (`mounts.ts`, `compat.ts`) and schema, with tests. Additive migration.
3. API and MCP (`set_mount`, `add_adapter`, list output).
4. Seed script against prod, reviewed output, Chroma Cube format corrected.
5. Server behaviour (fill, review) and eval cases.
6. Client capture chips.
7. Backfill of fixed-lens frames and events: report counts first, then write. Events
   the owner already edited are skipped.

Each step is its own PR; nothing before step 4 changes behaviour.

## 9. Out of scope

- Lens board sizes, rangefinder or meter coupling, crop and vignetting.
- Spoken focal lengths the tokens cannot see ("the eighty").
- 4x5 capture from the camera-first header (still needs its own design).
- Dropping `camera_lenses`.

## 10. Open questions for the owner

1. The old Leica LTM lens: make, model, focal length, max aperture (to add it).
2. Rollei 35 and Yashica Electro 35: which variants.
3. Should a frame record *which* adapter when more than one could bridge the same
   mounts? (Not needed with one adapter; revisit if a second is bought.)
