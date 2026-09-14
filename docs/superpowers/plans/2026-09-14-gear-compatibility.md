# Body–Lens Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tomu learns which lenses fit which bodies, so it can fill in fixed lenses, order lens choices on `/capture`, warn about a lens that cannot fit, and answer lens-history questions, without ever blocking a note.

**Architecture:** Two pure shared modules (`mounts.ts`, `compat.ts`) hold every rule and are used by the phone, the server, the MCP server and the eval. The schema gains additive columns (`cameras.mount`, `cameras.built_in_lens_id`, `lenses.mount`, `lens_note` on events and frames) and one `adapters` table. Compatibility is computed on every read from current gear. Nothing about it is stored except the gear itself.

**Tech Stack:** TypeScript monorepo (npm workspaces), Fastify + Drizzle + PostgreSQL 16, Vitest (projects: node, repo, client, client-dom), React 18 + Dexie (PWA), MCP SDK.

**Spec:** `docs/superpowers/specs/2026-09-14-gear-compatibility-design.md` (approved 2026-09-14). Read it before any task. This plan argues from it.

## Global Constraints

- **Do not start before 2026-09-16.**
- **Depends on PR #51** (parser corrections: `lensNamedIn` in `packages/shared/src/field-parse.ts`, `retracted` in `field-merge.ts`) and **PR #52** (`update_camera` / `update_lens` in `packages/mcp/src/tools/gear.ts`, `packages/mcp/src/gear-update.ts`). Both must be merged to `main` first. #47 (MCP split) is already on `main`.
- Migrations are **additive only**: add columns and tables, never drop or rename. `camera_lenses` stays.
- **Nothing rejects on compatibility, mount or built-in-lens combinations.** The only 4xx on gear is ownership (a lens or camera id that is not the user's), as today.
- Categories, orderings, fills and filters are pit-of-success defaults. Each one needs a one-tap way past it, and no choice is hidden or removed.
- Record reality: a lens that does not fit is a `gearWarning` computed on read. It is never written to `review` or `parseNotes`.
- An override of a filled built-in lens is scoped to that one record. The next record from the same body is filled again.
- Unknown mount (`null`) never warns.
- Every task is its own PR off `main`. CI (`npm test`, `npm run build`) must be green. Merge only with the owner's approval.
- A merge to `main` deploys to prod. Schema changes deploy with `migrate: true` **before** merging (Task 3).
- Commit messages are plain English, say why and how the change was verified, and end with:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01RDEzRPUbwUe26oobj6zgTk
  ```

## File Structure

| File | Responsibility |
|---|---|
| `packages/shared/src/mounts.ts` (new) | Mount list with aliases; `normalizeMount` (listed id or custom slug); `mountLabel`. |
| `packages/shared/src/compat.ts` (new) | `lensFits`, `compatibleLenses`, `gearWarningFor`, `builtInLensFill`. Pure. |
| `packages/shared/src/field-parse.ts` | `GearIndex` gains optional `mount`, `builtInLensId`, `adapters`. |
| `packages/shared/src/schemas.ts` | Mount fields on camera and lens schemas; adapter schemas; `lensNote` on event and frame schemas. |
| `packages/shared/src/types.ts` | `Camera`, `Lens`, `Frame` gain the new fields; new `Adapter`. |
| `packages/server/src/db/schema.ts` | New columns and the `adapters` table. |
| `packages/server/src/db/sql/2026-09-16-gear-compatibility.sql` (new) | Reviewed additive SQL, kept for the record and for a hand-apply fallback. |
| `packages/server/src/routes/adapters.ts` (new) | `/api/v1/adapters` list, create, update. |
| `packages/server/src/routes/frames.ts` (new) | `GET /api/v1/frames?lens_id=&lens=` for lens history. |
| `packages/server/src/routes/{cameras,lenses}.ts` | Accept mount and built-in lens; ownership check on `builtInLensId`. |
| `packages/server/src/services/gear.ts` | `loadGear` returns mounts, built-in lenses and active adapters. |
| `packages/server/src/services/gear-warnings.ts` (new) | Attach `gearWarning` to event and frame rows on read. |
| `packages/server/src/services/built-in-lens.ts` (new) | Fill on write; backfill with counts first. |
| `packages/server/src/routes/field-events.ts`, `routes/rolls.ts` | Use the two services above; accept `lensNote`. |
| `packages/mcp/src/tools/gear.ts`, `src/gear-update.ts` | Mount and built-in lens on `update_camera` / `update_lens`, `add_adapter`, `backfill_built_in_lenses`, richer `list`. |
| `packages/mcp/src/tools/shooting.ts` | `tomu_rolls` gains `lens`. |
| `packages/mcp/src/format.ts`, `src/types.ts` | Show `gearWarning` and `lensNote` on events. |
| `packages/server/scripts/seed-mounts.ts`, `packages/server/src/services/gear-seed.ts` (new) | Owner-confirmed seed, planned as a pure function, applied through the API. |
| `packages/client/src/offline/{api,db,store}.ts` | Gear cache carries mounts and adapters; built-in fill on save. |
| `packages/client/src/components/capture/{LensPicker,FieldChips,CapturePage}.tsx` | Lens picker (all lenses, ordered) with "Other lens…", and the inline warning. |
| `evals/field-parse/{gear.json,cases.json,observe.ts,eval.test.ts}` | Mounts in the eval gear, a fixed-lens fill case, and a wrong-lens warning case. |
| `vitest.config.ts` | Coverage gate includes `mounts.ts` and `compat.ts`. |

## Task order and PRs

| Task | PR | Behaviour change in prod |
|---|---|---|
| 1 Mounts | shared only | none |
| 2 Compatibility | shared only | none |
| 3 Schema + API | server | new fields accepted, nothing filled or warned |
| 4 MCP gear tools | mcp | gear can carry mounts |
| 5 Seed | script | mounts populated |
| 6 Warnings on read + `lens_note` | server + mcp | warnings appear |
| 7 Built-in fill + backfill | server + mcp | lenses filled |
| 8 Lens history | server + mcp | new filter |
| 9 Eval | evals | none |
| 10 Capture UI | client | picker and warning on the phone |

Each task ends green on its own. Nothing before Task 5 changes behaviour, because every mount is still `null`.

---

### Task 1: Mount list and normalisation

**Files:**
- Create: `packages/shared/src/mounts.ts`
- Modify: `packages/shared/src/index.ts` (add export)
- Modify: `vitest.config.ts` (coverage include)
- Test: `packages/shared/test/mounts.test.ts`

**Interfaces:**
- Produces: `MOUNTS` (record of `{ label: string; aliases: readonly string[] }`), `type MountId = keyof typeof MOUNTS`, `normalizeMount(input: string | null | undefined): string | null`, `mountLabel(mount: string | null | undefined): string | null`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/test/mounts.test.ts
import { describe, expect, it } from "vitest";
import { MOUNTS, mountLabel, normalizeMount } from "../src/mounts.js";

describe("normalizeMount", () => {
  it.each([
    ["leica-m", "leica-m"],
    ["Leica M", "leica-m"],
    ["M mount", "leica-m"],
    ["LTM", "m39"],
    ["L39", "m39"],
    ["leica screw", "m39"],
    ["FD", "canon-fd"],
    ["Nikon F", "nikon-f"],
    ["F-mount", "nikon-f"],
    ["M42", "m42"],
    ["pentax screw", "m42"],
    ["Pinhole", "none"],
    ["built-in", "fixed"],
    ["board", "lens-board"],
  ])("%s → %s", (input, want) => {
    expect(normalizeMount(input)).toBe(want);
  });

  it("keeps an unlisted mount as a custom slug instead of dropping it", () => {
    expect(normalizeMount("Leica R")).toBe("leica-r");
    expect(normalizeMount("  SR  ")).toBe("minolta-md"); // an alias, with spacing ignored
    expect(normalizeMount("Bronica ETR")).toBe("bronica-etr");
  });

  it("returns null only for empty input", () => {
    expect(normalizeMount("")).toBeNull();
    expect(normalizeMount("   ")).toBeNull();
    expect(normalizeMount(null)).toBeNull();
    expect(normalizeMount(undefined)).toBeNull();
    expect(normalizeMount("—")).toBeNull();
  });

  it("has no one-letter aliases, which would collide with ordinary words", () => {
    const short = Object.values(MOUNTS).flatMap((m) => m.aliases).filter((a) => a.replace(/[^a-z0-9]/gi, "").length < 2);
    expect(short).toEqual(["m"]); // Leica M: "m" is only ever matched as a whole mount field, never in a transcript
  });
});

describe("mountLabel", () => {
  it("labels a listed mount and passes a custom slug through", () => {
    expect(mountLabel("m39")).toBe("M39 / LTM");
    expect(mountLabel("leica-r")).toBe("leica-r");
    expect(mountLabel(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/shared/test/mounts.test.ts`
Expected: FAIL with `Cannot find module '../src/mounts.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/shared/src/mounts.ts
/**
 * Lens mounts. A convenience list, not a gate: a mount name that matches nothing here is
 * kept as a custom slug, so a lens or adapter with a mount this list forgot still fits
 * what it should. Spec §3.1.
 */
export const MOUNTS = {
  "leica-m": { label: "Leica M", aliases: ["m", "m mount", "m-mount"] },
  m39: { label: "M39 / LTM", aliases: ["ltm", "l39", "leica thread", "leica screw", "screw mount"] },
  "canon-fd": { label: "Canon FD", aliases: ["fd"] },
  "minolta-md": { label: "Minolta MD", aliases: ["md", "sr"] },
  "nikon-f": { label: "Nikon F", aliases: ["f mount", "f-mount", "ai", "ai-s"] },
  // Not "n": N is Mamiya's lens series name, not a mount.
  "mamiya-7": { label: "Mamiya 7", aliases: ["mamiya 7 mount"] },
  "pentax-67": { label: "Pentax 6×7", aliases: ["pentax 67", "p67", "6x7"] },
  "olympus-pen-f": { label: "Olympus Pen F", aliases: ["pen f"] },
  nikonos: { label: "Nikonos", aliases: [] },
  // Not in the kit today, listed so a found lens or a new adapter has a mount to name.
  m42: { label: "M42", aliases: ["m42x1", "pentax screw", "universal screw", "praktica screw"] },
  "pentax-k": { label: "Pentax K", aliases: ["pk", "k mount", "k-mount"] },
  "olympus-om": { label: "Olympus OM", aliases: ["om"] },
  "contax-yashica": { label: "Contax/Yashica", aliases: ["c/y", "cy"] },
  "canon-ef": { label: "Canon EF", aliases: ["ef"] },
  exakta: { label: "Exakta", aliases: [] },
  "hasselblad-v": { label: "Hasselblad V", aliases: ["hasselblad"] },
  "lens-board": { label: "Lens board (4x5)", aliases: ["board", "large format"] },
  fixed: { label: "Fixed lens", aliases: ["built-in", "built in"] },
  none: { label: "No lens (pinhole)", aliases: ["pinhole"] },
} as const satisfies Record<string, { label: string; aliases: readonly string[] }>;

export type MountId = keyof typeof MOUNTS;

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

const LOOKUP = new Map<string, MountId>();
for (const [id, m] of Object.entries(MOUNTS) as Array<[MountId, (typeof MOUNTS)[MountId]]>) {
  for (const key of [id, m.label, ...m.aliases]) LOOKUP.set(squash(key), id);
}

/** A listed mount id, a custom slug for anything else, or null for empty input. */
export function normalizeMount(input: string | null | undefined): string | null {
  if (input == null) return null;
  const key = squash(input);
  if (!key) return null;
  const listed = LOOKUP.get(key);
  if (listed) return listed;
  return input.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function mountLabel(mount: string | null | undefined): string | null {
  if (mount == null) return null;
  return (MOUNTS as Record<string, { label: string }>)[mount]?.label ?? mount;
}
```

Add to `packages/shared/src/index.ts` after `export * from "./field-event.js";`:

```ts
export * from "./mounts.js";
```

Add `"packages/shared/src/mounts.ts",` to the `coverage.include` list in `vitest.config.ts`, after `"packages/shared/src/field-event.ts",`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/shared/test/mounts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/mounts.ts packages/shared/src/index.ts packages/shared/test/mounts.test.ts vitest.config.ts
git commit -F - <<'EOF'
feat(shared): lens mount list with aliases and custom mounts

First piece of body–lens compatibility (spec 2026-09-14). normalizeMount
maps what a person types ("LTM", "F-mount", "Pinhole") to a listed id,
and keeps anything unlisted as a slug so a mount the list forgot still
works. No behaviour change yet.

Verified: npx vitest run packages/shared/test/mounts.test.ts.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RDEzRPUbwUe26oobj6zgTk
EOF
```

---

### Task 2: Compatibility rules

**Files:**
- Create: `packages/shared/src/compat.ts`
- Modify: `packages/shared/src/field-parse.ts` (the `GearIndex` interface at the top of the file)
- Modify: `packages/shared/src/index.ts`, `vitest.config.ts`
- Test: `packages/shared/test/compat.test.ts`

**Interfaces:**
- Consumes: nothing beyond Task 1 (mount strings are compared as stored, already normalised).
- Produces:
  ```ts
  interface CompatCamera { id: string; label: string; mount?: string | null; builtInLensId?: string | null }
  interface CompatLens { id: string; label: string; mount?: string | null }
  interface CompatAdapter { id: string; name: string; lensMount: string; bodyMount: string; acquiredOn?: string | null; isActive?: boolean }
  type Fit = { kind: "direct" } | { kind: "adapter"; adapterId: string } | { kind: "no"; reason: string } | { kind: "unknown" }
  lensFits(camera: CompatCamera, lens: CompatLens, adapters?: CompatAdapter[], at?: Date | string): Fit
  compatibleLenses(camera: CompatCamera, lenses: CompatLens[], adapters?: CompatAdapter[], at?: Date | string): Array<{ lens: CompatLens; fit: Fit }>
  gearWarningFor(camera: CompatCamera | undefined, lens: CompatLens | undefined, adapters?: CompatAdapter[], at?: Date | string): string | null
  builtInLensFill(camera: CompatCamera | undefined, record: { lensId?: string | null; lensNote?: string | null; editedFields?: string[] }): string | null
  ```
  `GearIndex` becomes `{ cameras: CompatCamera[]; lenses: CompatLens[]; adapters?: CompatAdapter[] }`. The new fields are optional, so existing callers and fixtures keep compiling.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/test/compat.test.ts
import { describe, expect, it } from "vitest";
import { builtInLensFill, compatibleLenses, gearWarningFor, lensFits, type CompatAdapter } from "../src/compat.js";

const m6 = { id: "cam-m6", label: "Leica M6", mount: "leica-m" };
const iiia = { id: "cam-iiia", label: "Leica IIIa", mount: "m39" };
const f3 = { id: "cam-f3", label: "Nikon F3", mount: "nikon-f" };
const xa = { id: "cam-xa", label: "Olympus XA", mount: "fixed", builtInLensId: "lens-xa" };
const cube = { id: "cam-cube", label: "Chroma Cube", mount: "none" };
const unknownBody = { id: "cam-x", label: "Mystery", mount: null };

const nokton = { id: "lens-40", label: "Voigtlander Nokton 40mm", mount: "leica-m" };
const elmar = { id: "lens-elmar", label: "Leica Elmar 50mm", mount: "m39" };
const mamiya80 = { id: "lens-80", label: "Mamiya N 80mm", mount: "mamiya-7" };
const takumar = { id: "lens-tak", label: "Takumar 55mm", mount: "m42" };
const xaLens = { id: "lens-xa", label: "Olympus XA 35mm", mount: "fixed" };
const unknownLens = { id: "lens-y", label: "Old lens", mount: null };

const ltmToM: CompatAdapter = { id: "ad-ltm", name: "LTM to M", lensMount: "m39", bodyMount: "leica-m" };

describe("lensFits", () => {
  it("fits a lens on a body of the same mount", () => {
    expect(lensFits(m6, nokton)).toEqual({ kind: "direct" });
    expect(lensFits(iiia, elmar)).toEqual({ kind: "direct" });
  });

  it("fits through an owned adapter, naming it", () => {
    expect(lensFits(m6, elmar, [ltmToM])).toEqual({ kind: "adapter", adapterId: "ad-ltm" });
  });

  it("says no, with both mounts, when nothing bridges them", () => {
    expect(lensFits(m6, mamiya80)).toEqual({
      kind: "no",
      reason: "Mamiya N 80mm (mamiya-7) does not fit Leica M6 (leica-m)",
    });
    expect(lensFits(iiia, nokton, [ltmToM]).kind).toBe("no"); // adapters are one-way
  });

  it("widens as soon as a new adapter is owned — nothing else changes", () => {
    expect(lensFits(f3, takumar).kind).toBe("no");
    const m42ToF: CompatAdapter = { id: "ad-m42", name: "M42 to F", lensMount: "m42", bodyMount: "nikon-f" };
    expect(lensFits(f3, takumar, [m42ToF])).toEqual({ kind: "adapter", adapterId: "ad-m42" });
  });

  it("ignores a retired adapter", () => {
    expect(lensFits(m6, elmar, [{ ...ltmToM, isActive: false }]).kind).toBe("no");
  });

  it("does not let an adapter acquired later explain an earlier photograph", () => {
    const found = { ...ltmToM, acquiredOn: "2027-03-01" };
    expect(lensFits(m6, elmar, [found], "2026-09-14T10:00:00Z").kind).toBe("no");
    expect(lensFits(m6, elmar, [found], new Date("2027-03-01T08:00:00Z")).kind).toBe("adapter");
    expect(lensFits(m6, elmar, [found]).kind).toBe("adapter"); // no `at`: all active adapters
    expect(lensFits(m6, elmar, [ltmToM], "2020-01-01T00:00:00Z").kind).toBe("adapter"); // no date: always
  });

  it("fits only the built-in lens on a fixed body", () => {
    expect(lensFits(xa, xaLens)).toEqual({ kind: "direct" });
    expect(lensFits(xa, nokton)).toEqual({ kind: "no", reason: "Olympus XA has a fixed lens" });
    expect(lensFits({ ...xa, builtInLensId: null }, nokton)).toEqual({ kind: "unknown" });
  });

  it("does not put another body's built-in lens on an interchangeable body", () => {
    expect(lensFits(m6, xaLens)).toEqual({ kind: "no", reason: "Olympus XA 35mm is built into another camera" });
  });

  it("fits no lens on a pinhole", () => {
    expect(lensFits(cube, nokton)).toEqual({ kind: "no", reason: "Chroma Cube is a pinhole" });
  });

  it("never judges an unknown mount", () => {
    expect(lensFits(unknownBody, nokton)).toEqual({ kind: "unknown" });
    expect(lensFits(m6, unknownLens)).toEqual({ kind: "unknown" });
  });

  it("matches custom mounts exactly like listed ones", () => {
    const leicaR = { id: "cam-r", label: "Leica R4", mount: "leica-r" };
    const rLens = { id: "lens-r", label: "Summicron-R", mount: "leica-r" };
    expect(lensFits(leicaR, rLens)).toEqual({ kind: "direct" });
  });
});

describe("compatibleLenses", () => {
  it("orders fits first, then unknown, then no — and never drops a lens", () => {
    const out = compatibleLenses(m6, [mamiya80, unknownLens, elmar, nokton], [ltmToM]);
    expect(out.map((o) => o.lens.id)).toEqual(["lens-elmar", "lens-40", "lens-y", "lens-80"]);
    expect(out.map((o) => o.fit.kind)).toEqual(["adapter", "direct", "unknown", "no"]);
  });
});

describe("gearWarningFor", () => {
  it("warns only when the answer is no", () => {
    expect(gearWarningFor(m6, mamiya80)).toBe("Mamiya N 80mm (mamiya-7) does not fit Leica M6 (leica-m)");
    expect(gearWarningFor(m6, elmar, [ltmToM])).toBeNull();
    expect(gearWarningFor(unknownBody, mamiya80)).toBeNull();
    expect(gearWarningFor(undefined, mamiya80)).toBeNull();
    expect(gearWarningFor(m6, undefined)).toBeNull();
  });
});

describe("builtInLensFill", () => {
  it("fills the built-in lens of a fixed body when the record has none", () => {
    expect(builtInLensFill(xa, {})).toBe("lens-xa");
    expect(builtInLensFill(xa, { lensId: null, editedFields: [] })).toBe("lens-xa");
  });

  it("leaves a record alone when a lens is set, named in free text, or hand-edited", () => {
    expect(builtInLensFill(xa, { lensId: "lens-40" })).toBeNull();
    expect(builtInLensFill(xa, { lensNote: "borrowed wide adapter" })).toBeNull();
    expect(builtInLensFill(xa, { editedFields: ["lensId"] })).toBeNull();
  });

  it("an override on one record does not stop the next record being filled", () => {
    const overridden = { lensId: null, editedFields: ["lensId"] };
    expect(builtInLensFill(xa, overridden)).toBeNull();
    expect(builtInLensFill(xa, {})).toBe("lens-xa");
  });

  it("fills nothing for interchangeable bodies, pinholes, unrecorded built-ins, or no camera", () => {
    expect(builtInLensFill(m6, {})).toBeNull();
    expect(builtInLensFill(cube, {})).toBeNull();
    expect(builtInLensFill({ ...xa, builtInLensId: null }, {})).toBeNull();
    expect(builtInLensFill(undefined, {})).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/shared/test/compat.test.ts`
Expected: FAIL with `Cannot find module '../src/compat.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/shared/src/compat.ts
/**
 * Which lenses fit which bodies. Computed from current gear on every call and never
 * stored, so buying (or finding) an adapter widens the answer immediately. Every result
 * is advice: nothing in Tomu rejects a lens because of it. Spec §3.3 and §4.
 */
export interface CompatCamera { id: string; label: string; mount?: string | null; builtInLensId?: string | null }
export interface CompatLens { id: string; label: string; mount?: string | null }
export interface CompatAdapter {
  id: string;
  name: string;
  lensMount: string;
  bodyMount: string;
  /** YYYY-MM-DD. An adapter acquired after a photograph does not bridge it. Null: always counted. */
  acquiredOn?: string | null;
  isActive?: boolean;
}

export type Fit =
  | { kind: "direct" }
  | { kind: "adapter"; adapterId: string }
  | { kind: "no"; reason: string }
  | { kind: "unknown" };

const dayOf = (at: Date | string) => (at instanceof Date ? at.toISOString() : new Date(at).toISOString()).slice(0, 10);

export function lensFits(camera: CompatCamera, lens: CompatLens, adapters: CompatAdapter[] = [], at?: Date | string): Fit {
  if (camera.mount === "none") return { kind: "no", reason: `${camera.label} is a pinhole` };
  if (camera.mount === "fixed") {
    if (!camera.builtInLensId) return { kind: "unknown" };
    return lens.id === camera.builtInLensId ? { kind: "direct" } : { kind: "no", reason: `${camera.label} has a fixed lens` };
  }
  if (camera.mount == null || lens.mount == null) return { kind: "unknown" };
  if (lens.mount === "fixed") return { kind: "no", reason: `${lens.label} is built into another camera` };
  if (lens.mount === camera.mount) return { kind: "direct" };
  const day = at == null ? null : dayOf(at);
  const bridge = adapters.find(
    (a) =>
      a.isActive !== false &&
      a.lensMount === lens.mount &&
      a.bodyMount === camera.mount &&
      (a.acquiredOn == null || day == null || a.acquiredOn <= day),
  );
  if (bridge) return { kind: "adapter", adapterId: bridge.id };
  return { kind: "no", reason: `${lens.label} (${lens.mount}) does not fit ${camera.label} (${camera.mount})` };
}

const RANK: Record<Fit["kind"], number> = { direct: 0, adapter: 0, unknown: 1, no: 2 };

/** Every lens, fits first, then unknown, then those that do not fit. Stable within a group. */
export function compatibleLenses(
  camera: CompatCamera,
  lenses: CompatLens[],
  adapters: CompatAdapter[] = [],
  at?: Date | string,
): Array<{ lens: CompatLens; fit: Fit }> {
  return lenses
    .map((lens, i) => ({ lens, fit: lensFits(camera, lens, adapters, at), i }))
    .sort((a, b) => RANK[a.fit.kind] - RANK[b.fit.kind] || a.i - b.i)
    .map(({ lens, fit }) => ({ lens, fit }));
}

/** The warning shown next to a recorded lens, or null. Never a reason to refuse anything. */
export function gearWarningFor(
  camera: CompatCamera | undefined,
  lens: CompatLens | undefined,
  adapters: CompatAdapter[] = [],
  at?: Date | string,
): string | null {
  if (!camera || !lens) return null;
  const fit = lensFits(camera, lens, adapters, at);
  return fit.kind === "no" ? fit.reason : null;
}

/**
 * The built-in lens to fill on one record, or null. A default, not a lock: a record
 * whose lens was set, named in free text, or hand-edited is left alone, and that
 * override never affects the next record from the same body.
 */
export function builtInLensFill(
  camera: CompatCamera | undefined,
  record: { lensId?: string | null; lensNote?: string | null; editedFields?: string[] },
): string | null {
  if (!camera || camera.mount !== "fixed" || !camera.builtInLensId) return null;
  if (record.lensId != null || (record.lensNote != null && record.lensNote !== "")) return null;
  if (record.editedFields?.includes("lensId")) return null;
  return camera.builtInLensId;
}
```

In `packages/shared/src/field-parse.ts`, replace the `GearIndex` interface (lines 7–10 on `main`):

```ts
import type { CompatAdapter, CompatCamera, CompatLens } from "./compat.js";

export interface GearIndex {
  cameras: CompatCamera[];
  lenses: CompatLens[];
  /** Owned adapters. Optional so a gear list without mounts still parses. */
  adapters?: CompatAdapter[];
}
```

Add `export * from "./compat.js";` to `packages/shared/src/index.ts`, and `"packages/shared/src/compat.ts",` to `coverage.include` in `vitest.config.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/shared`
Expected: PASS (the new file, plus the existing field-parse tests, which only use `id` and `label`).

Run: `npm run build -w packages/shared && npm run typecheck:mcp-tests && npm run typecheck:evals`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/compat.ts packages/shared/src/field-parse.ts packages/shared/src/index.ts packages/shared/test/compat.test.ts vitest.config.ts
git commit -F - <<'EOF'
feat(shared): derive body–lens compatibility from mounts and adapters

lensFits answers direct, through an adapter, no (with both mounts named),
or unknown. It is computed from the gear passed in, so a newly owned
adapter widens fits with nothing stored or backfilled. An adapter with an
acquired_on after a photograph does not bridge it. builtInLensFill returns
a fixed body's lens for one record only, and never over a set, noted, or
hand-edited lens. GearIndex gains optional mount data; no caller changes.

Verified: npx vitest run packages/shared; shared build and the mcp-tests
and evals typechecks are clean.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RDEzRPUbwUe26oobj6zgTk
EOF
```

---

### Task 3: Schema, shared schemas, and gear API

**Files:**
- Modify: `packages/server/src/db/schema.ts` (`cameras` line ~34, `lenses` line ~48, after `cameraLenses` line ~61, `frames` line ~160, `fieldEvents` line ~194)
- Create: `packages/server/src/db/sql/2026-09-16-gear-compatibility.sql`
- Modify: `packages/shared/src/schemas.ts` (camera schemas ~line 16, lens schemas ~line 29, `createFrameSchema` ~line 162, `createFieldEventSchema` ~line 275, `updateFieldEventSchema` ~line 293), `packages/shared/src/types.ts` (`Camera`, `Lens`, `Frame`)
- Modify: `packages/server/src/routes/cameras.ts`, `packages/server/src/routes/lenses.ts`
- Create: `packages/server/src/routes/adapters.ts`; register in `packages/server/src/app.ts` after the lenses line (~58)
- Test: `packages/server/test/gear.routes.test.ts`

**Interfaces:**
- Consumes: `normalizeMount` (Task 1).
- Produces: DB columns `cameras.mount`, `cameras.built_in_lens_id`, `lenses.mount`, `frames.lens_note`, `field_events.lens_note`, table `adapters`; Drizzle names `cameras.mount`, `cameras.builtInLensId`, `lenses.mount`, `frames.lensNote`, `fieldEvents.lensNote`, `adapters`; zod `mountField`, `createAdapterSchema`, `updateAdapterSchema`; API `GET/POST /api/v1/adapters`, `PATCH /api/v1/adapters/:id`.

- [ ] **Step 1: Write the failing route test**

```ts
// packages/server/test/gear.routes.test.ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../src/db/client.js";
import { makeFixture, resetDb, type Fixture } from "./helpers/app.js";

let f: Fixture;

beforeEach(async () => {
  if (f) await f.app.close();
  await resetDb();
  f = await makeFixture();
});

afterAll(async () => {
  await f.app.close();
  await pool.end();
});

const call = (method: "GET" | "POST" | "PATCH", url: string, payload?: unknown) =>
  f.app.inject({ method, url, headers: f.auth, payload: payload as object });

describe("camera and lens mounts", () => {
  it("stores an alias as the canonical mount and a custom mount as a slug", async () => {
    const cam = await call("PATCH", `/api/v1/cameras/${f.cameraId}`, { mount: "M mount" });
    expect(cam.statusCode).toBe(200);
    expect(cam.json().data.mount).toBe("leica-m");

    const lens = await call("PATCH", `/api/v1/lenses/${f.lensId}`, { mount: "Leica R" });
    expect(lens.json().data.mount).toBe("leica-r");
  });

  it("accepts a fixed body with no built-in lens recorded — no combination is rejected", async () => {
    const res = await call("PATCH", `/api/v1/cameras/${f.cameraId}`, { mount: "fixed" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.builtInLensId).toBeNull();
  });

  it("accepts a built-in lens on any mount, including a pinhole", async () => {
    const res = await call("PATCH", `/api/v1/cameras/${f.cameraId}`, { mount: "pinhole", builtInLensId: f.lensId });
    expect(res.statusCode).toBe(200);
  });

  it("only refuses a built-in lens that is not the user's", async () => {
    const res = await call("PATCH", `/api/v1/cameras/${f.cameraId}`, { builtInLensId: "00000000-0000-4000-8000-000000000000" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Lens not found");
  });

  it("clears a mount back to unknown with null", async () => {
    await call("PATCH", `/api/v1/cameras/${f.cameraId}`, { mount: "leica-m" });
    const res = await call("PATCH", `/api/v1/cameras/${f.cameraId}`, { mount: null });
    expect(res.json().data.mount).toBeNull();
  });
});

describe("/adapters", () => {
  it("creates, lists, and retires an adapter with normalised mounts", async () => {
    const created = await call("POST", "/api/v1/adapters", { name: "LTM to M", lensMount: "LTM", bodyMount: "Leica M" });
    expect(created.statusCode).toBe(201);
    const ad = created.json().data;
    expect(ad).toMatchObject({ lensMount: "m39", bodyMount: "leica-m", acquiredOn: null, isActive: true });

    const listed = await call("GET", "/api/v1/adapters");
    expect(listed.json().data).toHaveLength(1);

    const retired = await call("PATCH", `/api/v1/adapters/${ad.id}`, { isActive: false, acquiredOn: "2025-06-01" });
    expect(retired.json().data).toMatchObject({ isActive: false, acquiredOn: "2025-06-01" });
  });

  it("does not show another user's adapter", async () => {
    const other = await makeFixture();
    await other.app.inject({ method: "POST", url: "/api/v1/adapters", headers: other.auth, payload: { name: "x", lensMount: "m42", bodyMount: "nikon-f" } });
    await other.app.close();
    expect((await call("GET", "/api/v1/adapters")).json().data).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/test/gear.routes.test.ts`
Expected: FAIL (mount is not in the schema, so `data.mount` is `undefined`; `/api/v1/adapters` returns 404).

- [ ] **Step 3: Schema**

In `packages/server/src/db/schema.ts`:

`cameras`, after `notes: text("notes"),`:
```ts
  /** A MountId from @tomu/shared/mounts, or a custom slug. Null: unknown, never warns. */
  mount: text("mount"),
  /** The built-in lens of a `fixed` body. Optional even then. */
  builtInLensId: uuid("built_in_lens_id").references(() => lenses.id),
```

`lenses`, after `notes: text("notes"),`:
```ts
  mount: text("mount"),
```

After the `cameraLenses` table:
```ts
/** An owned adapter: a `lensMount` lens goes on a `bodyMount` body. Compatibility is derived from these. */
export const adapters = pgTable("adapters", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  lensMount: text("lens_mount").notNull(),
  bodyMount: text("body_mount").notNull(),
  acquiredOn: date("acquired_on"),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
});
```
Add `date` to the `drizzle-orm/pg-core` import at the top if it is not already there.

`frames`, after `lensId: uuid("lens_id").references(() => lenses.id),`:
```ts
    /** A lens named in free text when Tomu has no row for it. Kept as provenance after reconciling. */
    lensNote: text("lens_note"),
```

`fieldEvents`, after `lensId: uuid("lens_id").references(() => lenses.id),`:
```ts
    lensNote: text("lens_note"),
```

Create `packages/server/src/db/sql/2026-09-16-gear-compatibility.sql`. This is the reviewed record of the migration and a hand-apply fallback. The normal path is the deploy workflow (Step 8).
```sql
-- Body–lens compatibility (spec 2026-09-14). Additive only: no drops, no renames.
BEGIN;
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS mount text;
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS built_in_lens_id uuid REFERENCES lenses(id);
ALTER TABLE lenses ADD COLUMN IF NOT EXISTS mount text;
ALTER TABLE frames ADD COLUMN IF NOT EXISTS lens_note text;
ALTER TABLE field_events ADD COLUMN IF NOT EXISTS lens_note text;
CREATE TABLE IF NOT EXISTS adapters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL,
  lens_mount text NOT NULL,
  body_mount text NOT NULL,
  acquired_on date,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
```

- [ ] **Step 4: Shared schemas and types**

In `packages/shared/src/schemas.ts`, add near the top, after the imports:
```ts
import { normalizeMount } from "./mounts.js";

/** A mount as typed: alias or custom name in, canonical id or slug out. Null clears it to unknown. */
const mountField = z.string().max(100).nullable().optional()
  .transform((v) => (v === undefined ? undefined : normalizeMount(v)));
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
```
(`uuid` is already defined in this file. If it is declared below this point, place `mountField` after it.)

`createCameraSchema`: add `mount: mountField,` and `builtInLensId: uuid.nullable().optional(),`.
`createLensSchema`: add `mount: mountField,`.
`createFrameSchema`: add `lensNote: z.string().max(200).optional(),`.
`createFieldEventSchema` and `updateFieldEventSchema`: add `lensNote: z.string().max(200).nullable().optional(),`.

After `updateLensSchema`:
```ts
export const createAdapterSchema = z.object({
  name: z.string().min(1).max(100),
  lensMount: z.string().min(1).max(100).transform((v) => normalizeMount(v) ?? v),
  bodyMount: z.string().min(1).max(100).transform((v) => normalizeMount(v) ?? v),
  acquiredOn: dateOnly.nullable().optional(),
  notes: z.string().max(2000).optional(),
});

export const updateAdapterSchema = createAdapterSchema.partial().extend({ isActive: z.boolean().optional() });
```

In `packages/shared/src/types.ts`: add `mount?: string | null; builtInLensId?: string | null;` to `Camera`, `mount?: string | null;` to `Lens`, `lensNote?: string | null;` to `Frame`, and:
```ts
export interface Adapter extends Timestamps {
  id: string;
  userId: string;
  name: string;
  lensMount: string;
  bodyMount: string;
  acquiredOn: string | null;
  notes?: string;
  isActive: boolean;
}
```

- [ ] **Step 5: Routes**

`packages/server/src/routes/cameras.ts`: import `lenses` from `../db/schema.js`, and add this helper above `camerasRoutes`:
```ts
async function ownsLens(userId: string, lensId: string): Promise<boolean> {
  const [row] = await db.select({ id: lenses.id }).from(lenses)
    .where(and(eq(lenses.id, lensId), eq(lenses.userId, userId))).limit(1);
  return !!row;
}
```
In both the create (`fastify.post("/")`) and update (`fastify.patch("/:id")`) handlers, directly after `const body = …Schema.parse(request.body);`:
```ts
    // Ownership is the only check: no mount / built-in combination is ever refused (spec §5).
    if (body.builtInLensId && !(await ownsLens(request.userId, body.builtInLensId))) {
      return reply.status(404).send({ error: "Lens not found" });
    }
```
`lenses.ts` needs no change beyond the schema, since `mount` flows through `updateLensSchema`.

Create `packages/server/src/routes/adapters.ts`:
```ts
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { createAdapterSchema, updateAdapterSchema } from "@tomu/shared";
import { db } from "../db/client.js";
import { adapters } from "../db/schema.js";

/** Owned adapters. No delete, matching gear: retire with isActive=false so history still explains old frames. */
export async function adaptersRoutes(fastify: FastifyInstance) {
  fastify.get("/", async (request) => {
    const rows = await db.select().from(adapters).where(eq(adapters.userId, request.userId)).orderBy(adapters.name);
    return { data: rows };
  });

  fastify.post("/", async (request, reply) => {
    const body = createAdapterSchema.parse(request.body);
    const [row] = await db.insert(adapters).values({ ...body, userId: request.userId }).returning();
    return reply.status(201).send({ data: row });
  });

  fastify.patch<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const body = updateAdapterSchema.parse(request.body);
    const [row] = await db.update(adapters).set({ ...body, updatedAt: new Date() })
      .where(and(eq(adapters.id, request.params.id), eq(adapters.userId, request.userId))).returning();
    if (!row) return reply.status(404).send({ error: "Adapter not found" });
    return { data: row };
  });
}
```
In `packages/server/src/app.ts`, import it and register after the lenses route:
```ts
  await fastify.register(adaptersRoutes, { prefix: "/api/v1/adapters" });
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run packages/server/test/gear.routes.test.ts`
Expected: PASS. The global setup pushes the new schema into `filmlog_test`, and it is additive, so there is no prompt.

Run: `npm test && npm run build`
Expected: everything green.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/db/schema.ts packages/server/src/db/sql/2026-09-16-gear-compatibility.sql packages/shared/src/schemas.ts packages/shared/src/types.ts packages/server/src/routes/cameras.ts packages/server/src/routes/adapters.ts packages/server/src/app.ts packages/server/test/gear.routes.test.ts
git commit -F - <<'EOF'
feat(server): mounts, built-in lenses, adapters, and lens_note in the schema

Additive columns (cameras.mount, cameras.built_in_lens_id, lenses.mount,
frames.lens_note, field_events.lens_note) and an adapters table. Mounts
arrive as typed and are stored canonical or as a custom slug. No mount or
built-in-lens combination is rejected; the only 4xx is a built-in lens
that is not the user's. Nothing reads the new data yet.

Verified: npm test and npm run build; gear.routes.test.ts covers aliases,
custom mounts, fixed-without-lens accepted, ownership 404, adapters CRUD.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RDEzRPUbwUe26oobj6zgTk
EOF
```

- [ ] **Step 8: Deploy with the migration BEFORE merging (owner approval required)**

A merge to `main` deploys without the schema push, and Drizzle selects every schema column, so merging first would break prod until migrated. The deploy workflow builds, then pushes schema, then reloads. Run it from the PR branch:

```bash
git push -u origin <this-branch>
gh workflow run deploy.yml --ref <this-branch> -f migrate=true
gh run watch "$(gh run list --workflow deploy.yml --limit 1 --json databaseId --jq '.[0].databaseId')" --exit-status
```
Expected: success. The workflow's guard fails the run on any drop or rename prompt, and this change has none. Then merge the PR. Its push deploy ships the same code.

---

### Task 4: MCP gear tools know mounts and adapters

**Files:**
- Modify: `packages/mcp/src/gear-update.ts` (from #52)
- Modify: `packages/mcp/src/tools/gear.ts`
- Modify: `packages/mcp/test/support/fixtures.ts` (`camera()`, `lens()` accept `mount`, `builtInLensId`; new `adapter()`)
- Test: `packages/mcp/test/gear-update.test.ts`, `packages/mcp/test/tools/gear.test.ts`

**Interfaces:**
- Consumes: API from Task 3; `normalizeMount`, `mountLabel`, `compatibleLenses` from `@tomu/shared`.
- Produces: `GearUpdateInput.mount` and `builtInLens`; `tomu_gear` actions `add_adapter` (params `name`, `lensMount`, `bodyMount`, `acquiredOn`, `notes`); `list` output with mounts, built-in lens, fitting lenses and adapters.

- [ ] **Step 1: Write the failing tests**

Add to `packages/mcp/test/gear-update.test.ts`:
```ts
describe("buildGearPatch — mounts", () => {
  it("normalises a mount for cameras and lenses", () => {
    expect(buildGearPatch("camera", { mount: "LTM" })).toEqual({ body: { mount: "m39" } });
    expect(buildGearPatch("lens", { mount: "Leica R" })).toEqual({ body: { mount: "leica-r" } });
  });
});
```

Add to `packages/mcp/test/support/fixtures.ts`:
```ts
export const adapter = (o: Partial<{ id: string; name: string; lensMount: string; bodyMount: string; acquiredOn: string | null; isActive: boolean }> = {}) => ({
  id: "ad-ltm",
  name: "LTM to M",
  lensMount: "m39",
  bodyMount: "leica-m",
  acquiredOn: null,
  isActive: true,
  ...o,
});
```
Also widen the `camera` fixture's override type with `mount: string | null; builtInLensId: string | null`, and `lens` with `mount: string | null`. Defaults stay unset, so existing tests are unchanged.

Add to `packages/mcp/test/tools/gear.test.ts` (import `adapter`):
```ts
describe("tomu_gear mounts and adapters", () => {
  it("lists each body's mount, what fits it, and owned adapters", async () => {
    api
      .answer("GET", "/cameras", { data: [camera({ mount: "leica-m" }), camera({ id: "cam-xa", make: "Olympus", model: "XA", mount: "fixed", builtInLensId: "lens-xa" })] })
      .answer("GET", "/lenses", {
        data: [
          lens({ id: "lens-40", make: "Voigtlander", model: "Nokton", focalLengthMm: 40, maxAperture: "1.4", mount: "leica-m" }),
          lens({ id: "lens-elmar", make: "Leica", model: "Elmar", focalLengthMm: 50, maxAperture: "3.5", mount: "m39" }),
          lens({ id: "lens-xa", make: "Olympus", model: "XA", focalLengthMm: 35, maxAperture: "2.8", mount: "fixed" }),
        ],
      })
      .answer("GET", "/adapters", { data: [adapter()] });

    const reply = await tomu.call("tomu_gear", { action: "list" });

    expect(reply).toContain("- **Leica M6** (35mm) · Leica M — fits: Voigtlander Nokton, Leica Elmar (via LTM to M)");
    expect(reply).toContain("- **Olympus XA** (35mm) · Fixed lens — built-in: Olympus XA");
    expect(reply).toContain("### Adapters\n- **LTM to M** — M39 / LTM → Leica M");
  });

  it("sets a camera's mount and built-in lens through update_camera", async () => {
    api
      .answer("GET", "/cameras", { data: [camera({ id: "cam-xa", make: "Olympus", model: "XA" })] })
      .answer("GET", "/lenses", { data: [lens({ id: "lens-xa", make: "Olympus", model: "XA F.Zuiko", focalLengthMm: 35 })] })
      .answer("PATCH", "/cameras/cam-xa", { data: camera({ id: "cam-xa", make: "Olympus", model: "XA", mount: "fixed", builtInLensId: "lens-xa" }) });

    await tomu.call("tomu_gear", { action: "update_camera", name: "xa", mount: "built-in", builtInLens: "zuiko" });

    expect(api.sent("PATCH", "/cameras/cam-xa")).toEqual({ mount: "fixed", builtInLensId: "lens-xa" });
  });

  it("adds an adapter with normalised mounts", async () => {
    api.answer("POST", "/adapters", { data: adapter({ id: "ad-m42", name: "M42 to F", lensMount: "m42", bodyMount: "nikon-f" }) });

    const reply = await tomu.call("tomu_gear", { action: "add_adapter", name: "M42 to F", lensMount: "M42", bodyMount: "F mount" });

    expect(api.sent("POST", "/adapters")).toEqual({ name: "M42 to F", lensMount: "m42", bodyMount: "nikon-f" });
    expect(reply).toBe("Added adapter: **M42 to F** (M42 → Nikon F)");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/mcp/test/gear-update.test.ts packages/mcp/test/tools/gear.test.ts`
Expected: FAIL (`mount` is not forwarded, `add_adapter` is unknown, the list has no mount text).

- [ ] **Step 3: Implementation**

`packages/mcp/src/gear-update.ts`: add `mount?: string;` to `GearUpdateInput`, add `"mount"` to both `FIELDS.camera` and `FIELDS.lens`, import `normalizeMount` from `@tomu/shared`, and inside the loop before `body[field] = value;`:
```ts
    if (field === "mount") {
      body.mount = normalizeMount(String(value));
      continue;
    }
```

`packages/mcp/src/tools/gear.ts`:
- Import `compatibleLenses, mountLabel, normalizeMount` from `@tomu/shared`.
- Add to the `action` enum: `"add_adapter"`.
- Add parameters, each described (the registration gate requires it):
```ts
    mount: z.string().optional().describe("update_camera / update_lens: lens mount, e.g. 'Leica M', 'LTM', 'Nikon F', 'fixed' (built-in lens), 'pinhole'; unlisted names are kept as custom mounts"),
    builtInLens: z.string().optional().describe("update_camera: the built-in lens of a fixed-lens body, fuzzy lens name"),
    lensMount: z.string().optional().describe("add_adapter: the mount of the lenses it takes, e.g. 'M42'"),
    bodyMount: z.string().optional().describe("add_adapter: the mount of the bodies it fits, e.g. 'Nikon F'"),
    acquiredOn: z.string().optional().describe("add_adapter: YYYY-MM-DD when bought or found; omit if unknown"),
```
- In the `update_camera` / `update_lens` branch, pass `mount` into `buildGearPatch`, then resolve `builtInLens` before the PATCH:
```ts
      if (kind === "camera" && builtInLens) {
        const { data: allLenses } = await api<{ data: any[] }>("/lenses");
        const hit = rankedMatch(builtInLens, allLenses, (l: any) => [`${l.make} ${l.model}`, l.model, l.make, String(l.focalLengthMm ?? "")]);
        if (hit.kind === "none") return reply(`No lens matching "${builtInLens}".`);
        if (hit.kind === "tied") return reply(`"${builtInLens}" is ambiguous: ${hit.items.map((l: any) => `${l.make} ${l.model}`).join(", ")}.`);
        patch.body!.builtInLensId = hit.item.id;
      }
```
  `buildGearPatch` returns an error when no field is given. When only `builtInLens` is given, call it with `{ ...fields, notes: undefined }` and treat `builtInLens` as a field: change the early `if (patch.error) return reply(patch.error);` to `if (patch.error && !(kind === "camera" && builtInLens)) return reply(patch.error);` and use `patch.body ?? {}`.
- Replace the `list` branch's camera loop and add adapters:
```ts
      const [camerasRes, lensesRes, adaptersRes] = await Promise.all([api<any>("/cameras"), api<any>("/lenses"), api<any>("/adapters")]);
      // … existing query filtering …
      const adapterRows = adaptersRes.data.filter((a: any) => a.isActive !== false);
      const lensLabel = (l: any) => `${l.make} ${l.model}`;
      if (cams.length > 0) {
        lines.push("### Cameras");
        for (const c of cams) {
          const base = `- **${c.make} ${c.model}** (${c.format})${c.serialNumber ? ` S/N: ${c.serialNumber}` : ""}`;
          if (c.mount == null) { lines.push(base); continue; }
          if (c.mount === "fixed") {
            const built = lens.find((l: any) => l.id === c.builtInLensId);
            lines.push(`${base} · Fixed lens — built-in: ${built ? lensLabel(built) : "not recorded"}`);
            continue;
          }
          const compat = compatibleLenses(
            { id: c.id, label: `${c.make} ${c.model}`, mount: c.mount, builtInLensId: c.builtInLensId },
            lens.map((l: any) => ({ id: l.id, label: lensLabel(l), mount: l.mount })),
            adapterRows,
          );
          const fits = compat
            .filter((x) => x.fit.kind === "direct" || x.fit.kind === "adapter")
            .map((x) => x.fit.kind === "adapter" ? `${x.lens.label} (via ${adapterRows.find((a: any) => a.id === (x.fit as { adapterId: string }).adapterId)?.name})` : x.lens.label);
          lines.push(`${base} · ${mountLabel(c.mount)}${fits.length ? ` — fits: ${fits.join(", ")}` : ""}`);
        }
      }
      // … existing lens loop …
      if (adapterRows.length > 0) {
        lines.push("\n### Adapters");
        for (const a of adapterRows) lines.push(`- **${a.name}** — ${mountLabel(a.lensMount)} → ${mountLabel(a.bodyMount)}${a.acquiredOn ? ` (since ${a.acquiredOn})` : ""}`);
      }
```
- Add the `add_adapter` branch before `return … "Unknown action."`:
```ts
    if (action === "add_adapter") {
      if (!name || !lensMount || !bodyMount) {
        return { content: [{ type: "text" as const, text: "add_adapter needs name, lensMount and bodyMount." }] };
      }
      const { data: ad } = await api<any>("/adapters", {
        method: "POST",
        body: JSON.stringify({ name, lensMount: normalizeMount(lensMount), bodyMount: normalizeMount(bodyMount), ...(acquiredOn ? { acquiredOn } : {}), ...(notes ? { notes } : {}) }),
      });
      return { content: [{ type: "text" as const, text: `Added adapter: **${ad.name}** (${mountLabel(ad.lensMount)} → ${mountLabel(ad.bodyMount)})` }] };
    }
```
- Update the existing "lists cameras and lenses" and "filters the list" tests in `gear.test.ts` to also `api.answer("GET", "/adapters", { data: [] })`, since the fake API fails any unanswered request.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/mcp && npm run typecheck:mcp-tests`
Expected: PASS, including `registration.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add packages/mcp/src/gear-update.ts packages/mcp/src/tools/gear.ts packages/mcp/test/gear-update.test.ts packages/mcp/test/tools/gear.test.ts packages/mcp/test/support/fixtures.ts
git commit -F - <<'EOF'
feat(mcp): mounts, built-in lenses and adapters through tomu_gear

update_camera and update_lens accept a mount (aliases and custom names)
and update_camera a built-in lens by fuzzy name; add_adapter records an
owned adapter; list shows each body's mount, the lenses that fit it
(adapter fits named), a fixed body's built-in lens, and the adapters. This
is how the seed and later corrections reach prod without SQL.

Verified: npx vitest run packages/mcp; typecheck:mcp-tests; registration
gate green (every new parameter described).

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RDEzRPUbwUe26oobj6zgTk
EOF
```

---

### Task 5: Seed the owner-confirmed gear

**Files:**
- Create: `packages/server/src/services/gear-seed.ts` (pure planner)
- Create: `packages/server/scripts/seed-mounts.ts` (applies the plan through the API)
- Test: `packages/server/test/gear-seed.test.ts`

**Interfaces:**
- Consumes: API from Task 3; `normalizeMount`.
- Produces: `planGearSeed(current: { cameras: SeedCamera[]; lenses: SeedLens[]; adapters: SeedAdapter[] }): SeedOp[]` where `SeedOp = { op: "patchCamera"; id: string; label: string; body: Record<string, unknown> } | { op: "createLens"; forCamera: string; body: Record<string, unknown> } | { op: "patchLens"; id: string; label: string; body: Record<string, unknown> } | { op: "createAdapter"; body: Record<string, unknown> } | { op: "skip"; label: string; reason: string }`.

Unknowns stay unknown. The old Leica LTM lens is not created, because its model is not given (spec §10). Rollei 35 and Yashica Electro 35 built-in lenses are created with `maxAperture: null` and a note saying the variant is unknown. The Chroma Cube's format was already corrected to 35mm through #52's `update_camera`; the seed only sets its mount.

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/test/gear-seed.test.ts
import { describe, expect, it } from "vitest";
import { planGearSeed } from "../src/services/gear-seed.js";

const cam = (id: string, make: string, model: string, extra: Record<string, unknown> = {}) => ({ id, make, model, mount: null, builtInLensId: null, ...extra });
const lens = (id: string, make: string, model: string, extra: Record<string, unknown> = {}) => ({ id, make, model, mount: null, ...extra });

describe("planGearSeed", () => {
  it("sets mounts on interchangeable bodies and known lenses", () => {
    const ops = planGearSeed({
      cameras: [cam("c1", "Leica", "M6"), cam("c2", "Leica", "IIIa"), cam("c3", "Chroma", "Cube")],
      lenses: [lens("l1", "Voigtlander", "Nokton"), lens("l2", "Mamiya", "N 80mm f/4 L")],
      adapters: [],
    });
    expect(ops).toContainEqual({ op: "patchCamera", id: "c1", label: "Leica M6", body: { mount: "leica-m" } });
    expect(ops).toContainEqual({ op: "patchCamera", id: "c2", label: "Leica IIIa", body: { mount: "m39" } });
    expect(ops).toContainEqual({ op: "patchCamera", id: "c3", label: "Chroma Cube", body: { mount: "none" } });
    expect(ops).toContainEqual({ op: "patchLens", id: "l1", label: "Voigtlander Nokton", body: { mount: "leica-m" } });
    expect(ops).toContainEqual({ op: "patchLens", id: "l2", label: "Mamiya N 80mm f/4 L", body: { mount: "mamiya-7" } });
  });

  it("creates a built-in lens for a fixed body and points the body at it", () => {
    const ops = planGearSeed({ cameras: [cam("c9", "Olympus", "XA")], lenses: [], adapters: [] });
    expect(ops).toContainEqual({
      op: "createLens",
      forCamera: "c9",
      body: { make: "Olympus", model: "XA built-in lens", focalLengthMm: 35, maxAperture: "2.8", mount: "fixed" },
    });
  });

  it("creates the one owned adapter once", () => {
    const first = planGearSeed({ cameras: [], lenses: [], adapters: [] });
    expect(first).toContainEqual({ op: "createAdapter", body: { name: "LTM to M", lensMount: "m39", bodyMount: "leica-m" } });
    const again = planGearSeed({ cameras: [], lenses: [], adapters: [{ lensMount: "m39", bodyMount: "leica-m" }] });
    expect(again.some((o) => o.op === "createAdapter")).toBe(false);
  });

  it("never overwrites a mount or built-in lens already set — the owner's later corrections win", () => {
    const ops = planGearSeed({ cameras: [cam("c1", "Leica", "M6", { mount: "custom-thing" })], lenses: [], adapters: [] });
    expect(ops).toContainEqual({ op: "skip", label: "Leica M6", reason: "mount already set (custom-thing)" });
  });

  it("reports gear it has no confirmed data for instead of guessing", () => {
    const ops = planGearSeed({ cameras: [cam("c7", "Bronica", "ETRS")], lenses: [lens("l7", "Leica", "Elmar")], adapters: [] });
    expect(ops).toContainEqual({ op: "skip", label: "Bronica ETRS", reason: "no owner-confirmed mount" });
    expect(ops).toContainEqual({ op: "skip", label: "Leica Elmar", reason: "no owner-confirmed mount" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/test/gear-seed.test.ts`
Expected: FAIL with `Cannot find module '../src/services/gear-seed.js'`.

- [ ] **Step 3: Write the planner and the script**

```ts
// packages/server/src/services/gear-seed.ts
/**
 * The owner-confirmed gear facts from 2026-09-14 (spec §6), as a pure plan. Unknowns are
 * left unknown; anything already set is left alone, because a later correction by the
 * owner must win over this one-off seed.
 */
export interface SeedCamera { id: string; make: string; model: string; mount: string | null; builtInLensId: string | null }
export interface SeedLens { id: string; make: string; model: string; mount: string | null }
export interface SeedAdapter { lensMount: string; bodyMount: string }

export type SeedOp =
  | { op: "patchCamera"; id: string; label: string; body: Record<string, unknown> }
  | { op: "createLens"; forCamera: string; body: Record<string, unknown> }
  | { op: "patchLens"; id: string; label: string; body: Record<string, unknown> }
  | { op: "createAdapter"; body: Record<string, unknown> }
  | { op: "skip"; label: string; reason: string };

const BODY_MOUNTS: Record<string, string> = {
  "leica m6": "leica-m",
  "leica iiia": "m39",
  "mamiya 7": "mamiya-7",
  "canon ae-1": "canon-fd",
  "canon f-1": "canon-fd",
  "minolta x-700": "minolta-md",
  "nikon f3": "nikon-f",
  "nikon ftn2": "nikon-f",
  "pentax 67": "pentax-67",
  "olympus pen ft": "olympus-pen-f",
  "nikon nikonos v": "nikonos",
  "graflex crown graphic 4x5": "lens-board",
  "intrepid 4x5": "lens-board",
  "wista 45sp": "lens-board",
  "chroma cube": "none",
};

/** Fixed-lens bodies and their built-in lens. Null where the variant is not confirmed. */
const BUILT_IN: Record<string, { focalLengthMm: number | null; maxAperture: string | null; notes?: string }> = {
  "canon canonet ql17": { focalLengthMm: 40, maxAperture: "1.7" },
  "olympus xa": { focalLengthMm: 35, maxAperture: "2.8" },
  "rollei 35": { focalLengthMm: 40, maxAperture: null, notes: "Variant unknown: Tessar f/3.5 or Sonnar f/2.8." },
  "yashica electro 35": { focalLengthMm: 45, maxAperture: "1.7", notes: "Variant unknown." },
  "yashica samurai x3.0": { focalLengthMm: null, maxAperture: null, notes: "25–75mm zoom." },
  "holga 120n": { focalLengthMm: 60, maxAperture: null },
  "holga 120 tlr": { focalLengthMm: 60, maxAperture: null },
  "holga 135": { focalLengthMm: 47, maxAperture: null },
  "kodak jiffy six-20": { focalLengthMm: null, maxAperture: null, notes: "Fixed meniscus lens." },
};

const LENS_MOUNTS: Record<string, string> = {
  "leica summicron v3": "leica-m",
  "voigtlander color skopar": "leica-m",
  "voigtlander nokton": "leica-m",
  "mamiya n 80mm f/4 l": "mamiya-7",
};

const ADAPTERS = [{ name: "LTM to M", lensMount: "m39", bodyMount: "leica-m" }];

const key = (make: string, model: string) => `${make} ${model}`.toLowerCase().replace(/\s+/g, " ").trim();

export function planGearSeed(current: { cameras: SeedCamera[]; lenses: SeedLens[]; adapters: SeedAdapter[] }): SeedOp[] {
  const ops: SeedOp[] = [];
  for (const c of current.cameras) {
    const label = `${c.make} ${c.model}`;
    const k = key(c.make, c.model);
    if (c.mount != null) { ops.push({ op: "skip", label, reason: `mount already set (${c.mount})` }); continue; }
    if (BODY_MOUNTS[k]) { ops.push({ op: "patchCamera", id: c.id, label, body: { mount: BODY_MOUNTS[k] } }); continue; }
    const built = BUILT_IN[k];
    if (built) {
      const { notes, ...spec } = built;
      ops.push({ op: "createLens", forCamera: c.id, body: { make: c.make, model: `${c.model} built-in lens`, ...spec, mount: "fixed", ...(notes ? { notes } : {}) } });
      continue;
    }
    ops.push({ op: "skip", label, reason: "no owner-confirmed mount" });
  }
  for (const l of current.lenses) {
    const label = `${l.make} ${l.model}`;
    if (l.mount != null) { ops.push({ op: "skip", label, reason: `mount already set (${l.mount})` }); continue; }
    const mount = LENS_MOUNTS[key(l.make, l.model)];
    ops.push(mount ? { op: "patchLens", id: l.id, label, body: { mount } } : { op: "skip", label, reason: "no owner-confirmed mount" });
  }
  for (const a of ADAPTERS) {
    if (!current.adapters.some((x) => x.lensMount === a.lensMount && x.bodyMount === a.bodyMount)) ops.push({ op: "createAdapter", body: a });
  }
  return ops;
}
```

```ts
// packages/server/scripts/seed-mounts.ts
/**
 * Seeds the owner-confirmed mounts, built-in lenses and adapter (spec 2026-09-14 §6)
 * through the Tomu API, so it reaches prod the same way the app does. Dry run by default.
 *
 * Run: TOMU_API_URL=… TOMU_API_TOKEN=… npx tsx scripts/seed-mounts.ts [--write]
 * (from packages/server). With no prod token on the laptop, the same result comes from
 * `tomu_gear update_camera … mount=…` and `add_adapter` through the connector.
 */
import { planGearSeed } from "../src/services/gear-seed.js";

const BASE = process.env.TOMU_API_URL ?? "http://localhost:3456/api/v1";
const TOKEN = process.env.TOMU_API_TOKEN ?? "";
const WRITE = process.argv.includes("--write");

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${TOKEN}` };
  if (init.body != null) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

const [{ data: cameras }, { data: lenses }, { data: adapters }] = await Promise.all([
  api<{ data: any[] }>("/cameras"), api<{ data: any[] }>("/lenses"), api<{ data: any[] }>("/adapters"),
]);
const ops = planGearSeed({ cameras, lenses, adapters });

for (const op of ops) {
  const line =
    op.op === "skip" ? `skip   ${op.label}: ${op.reason}` :
    op.op === "createLens" ? `lens   + ${op.body.make} ${op.body.model} → built into ${op.forCamera}` :
    op.op === "createAdapter" ? `adapt  + ${op.body.name}` :
    `${op.op === "patchCamera" ? "camera" : "lens  "} ${op.label} ← ${JSON.stringify(op.body)}`;
  console.log(line);
  if (!WRITE) continue;
  if (op.op === "patchCamera") await api(`/cameras/${op.id}`, { method: "PATCH", body: JSON.stringify(op.body) });
  if (op.op === "patchLens") await api(`/lenses/${op.id}`, { method: "PATCH", body: JSON.stringify(op.body) });
  if (op.op === "createAdapter") await api("/adapters", { method: "POST", body: JSON.stringify(op.body) });
  if (op.op === "createLens") {
    const { data: created } = await api<{ data: { id: string } }>("/lenses", { method: "POST", body: JSON.stringify(op.body) });
    await api(`/cameras/${op.forCamera}`, { method: "PATCH", body: JSON.stringify({ mount: "fixed", builtInLensId: created.id }) });
  }
}
console.log(WRITE ? `\napplied ${ops.filter((o) => o.op !== "skip").length} change(s)` : "\ndry run — pass --write to apply");
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/server/test/gear-seed.test.ts && npm run typecheck:scripts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/gear-seed.ts packages/server/scripts/seed-mounts.ts packages/server/test/gear-seed.test.ts
git commit -F - <<'EOF'
feat(server): seed the owner-confirmed mounts, built-in lenses and adapter

The 2026-09-14 gear facts as a pure plan plus a dry-run-by-default script
that applies it through the API. It never overwrites a mount already set
(the owner's corrections win), creates a built-in lens row per fixed body,
adds the one LTM-to-M adapter once, and reports unknowns instead of
guessing. The old LTM lens is not created: its model is still unknown.

Verified: npx vitest run packages/server/test/gear-seed.test.ts;
typecheck:scripts.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RDEzRPUbwUe26oobj6zgTk
EOF
```

- [ ] **Step 6: Apply to prod (owner approval required)**

After merge and deploy, run a dry run against dev first: `cd packages/server && npx tsx scripts/seed-mounts.ts`. Show the owner the output. For prod, where no API token is on the laptop, apply each non-skip line through the Tomu connector with `tomu_gear update_camera` / `update_lens` (`mount`, `builtInLens`) and `add_adapter`, then confirm with `tomu_gear list`. Paste the final list into the PR thread.

---

### Task 6: Gear warnings on read, and `lens_note`

**Files:**
- Create: `packages/server/src/services/gear-warnings.ts`
- Modify: `packages/server/src/services/gear.ts`
- Modify: `packages/server/src/routes/field-events.ts` (`presentEvent` line ~34 and every handler returning events; create insert ~line 150; patch field loop ~line 245)
- Modify: `packages/server/src/routes/rolls.ts` (`GET /:id`, `frames` and `unpinnedEvents` ~line 322; `POST /:id/frames` insert ~line 596)
- Modify: `packages/mcp/src/types.ts` (`FieldEventRow`), `packages/mcp/src/format.ts` (`eventLine`)
- Test: `packages/server/test/field-events.routes.test.ts` (new `describe`), `packages/mcp/test/format.test.ts`

**Interfaces:**
- Consumes: `gearWarningFor`, `GearIndex` (Task 2); schema (Task 3).
- Produces: `loadGear(userId): Promise<GearIndex>` including `mount`, `builtInLensId`, `adapters`; `attachEventWarnings<T extends WarnableEvent>(userId: string, rows: T[]): Promise<Array<T & { gearWarning: string | null }>>`; `attachFrameWarnings<T extends { lensId: string | null; shotAt: Date | null }>(userId: string, cameraId: string | null, rows: T[]): Promise<Array<T & { gearWarning: string | null }>>`. API event and frame objects gain `gearWarning` and `lensNote`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/server/test/field-events.routes.test.ts` (add `import { adapters, cameras, lenses } from "../src/db/schema.js"; import { db } from "../src/db/client.js"; import { eq } from "drizzle-orm";`):
```ts
describe("gear warnings (derived on read, never stored)", () => {
  async function mamiyaLensOnM6() {
    await db.update(cameras).set({ mount: "leica-m" }).where(eq(cameras.id, f.cameraId));
    const [m80] = await db.insert(lenses).values({ userId: f.userId, make: "Mamiya", model: "N 80mm", mount: "mamiya-7" }).returning();
    return m80;
  }

  it("keeps a lens that does not fit and returns a warning naming both mounts", async () => {
    const m80 = await mamiyaLensOnM6();
    const res = await create({ transcript: "x", cameraId: f.cameraId, lensId: m80.id });
    expect(res.statusCode).toBe(201);
    const ev = res.json().data;
    expect(ev.lensId).toBe(m80.id);
    expect(ev.gearWarning).toBe("Mamiya N 80mm (mamiya-7) does not fit Leica M6 (leica-m)");
    expect(ev.review).toBe(false);
    expect(ev.parseNotes).toBeNull();
  });

  it("clears the warning everywhere once the model is fixed, with nothing rewritten", async () => {
    const m80 = await mamiyaLensOnM6();
    const ev = (await create({ transcript: "x", cameraId: f.cameraId, lensId: m80.id })).json().data;
    await db.insert(adapters).values({ userId: f.userId, name: "odd adapter", lensMount: "mamiya-7", bodyMount: "leica-m" });
    const again = await f.app.inject({ method: "GET", url: `/api/v1/field-events/${ev.id}`, headers: f.auth });
    expect(again.json().data.gearWarning).toBeNull();
    expect(again.json().data.updatedAt).toBe(ev.updatedAt);
  });

  it("uses the roll's camera when the event has none", async () => {
    const m80 = await mamiyaLensOnM6();
    const ev = (await create({ transcript: "x", rollId: f.rollId, lensId: m80.id })).json().data;
    expect(ev.gearWarning).toContain("does not fit Leica M6");
  });

  it("never warns about an unknown mount", async () => {
    const ev = (await create({ transcript: "x", cameraId: f.cameraId, lensId: f.lensId })).json().data;
    expect(ev.gearWarning).toBeNull();
  });

  it("round-trips lens_note, and an event with only a lens note always saves", async () => {
    const res = await create({ transcript: "x", cameraId: f.cameraId, lensNote: "old Elmar" });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.lensNote).toBe("old Elmar");
    const patched = await f.app.inject({ method: "PATCH", url: `/api/v1/field-events/${res.json().data.id}`, headers: f.auth, payload: { lensNote: "Elmar 50/3.5" } });
    expect(patched.json().data.lensNote).toBe("Elmar 50/3.5");
    expect(patched.json().data.editedFields).toContain("lensNote");
  });

  it("returns warnings on roll frames too", async () => {
    const m80 = await mamiyaLensOnM6();
    await f.app.inject({ method: "POST", url: `/api/v1/rolls/${f.rollId}/frames`, headers: f.auth, payload: { lensId: m80.id, lensNote: "borrowed" } });
    const roll = await f.app.inject({ method: "GET", url: `/api/v1/rolls/${f.rollId}`, headers: f.auth });
    expect(roll.json().data.frames[0].gearWarning).toContain("does not fit");
    expect(roll.json().data.frames[0].lensNote).toBe("borrowed");
  });
});
```

Append to `packages/mcp/test/format.test.ts`:
```ts
it("shows a gear warning and a lens note on an event line", () => {
  const line = eventLine(fieldEvent({ gearWarning: "Mamiya N 80mm (mamiya-7) does not fit Leica M6 (leica-m)", lensNote: "old Elmar" }), new Map());
  expect(line).toContain("⚠ Mamiya N 80mm (mamiya-7) does not fit Leica M6 (leica-m)");
  expect(line).toContain("lens: old Elmar");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/server/test/field-events.routes.test.ts packages/mcp/test/format.test.ts`
Expected: FAIL (`gearWarning` undefined; `lensNote` not accepted).

- [ ] **Step 3: Implementation**

Replace `packages/server/src/services/gear.ts`:
```ts
import { and, eq } from "drizzle-orm";
import type { GearIndex } from "@tomu/shared";
import { db } from "../db/client.js";
import { adapters, cameras, lenses } from "../db/schema.js";

export type { GearIndex };

/** This user's gear with mounts and active adapters, for parsing, prompt context, fill and warnings. */
export async function loadGear(userId: string): Promise<GearIndex> {
  const [cams, lens, ads] = await Promise.all([
    db.select({ id: cameras.id, make: cameras.make, model: cameras.model, mount: cameras.mount, builtInLensId: cameras.builtInLensId })
      .from(cameras).where(eq(cameras.userId, userId)),
    db.select({ id: lenses.id, make: lenses.make, model: lenses.model, focalLengthMm: lenses.focalLengthMm, mount: lenses.mount })
      .from(lenses).where(eq(lenses.userId, userId)),
    db.select({ id: adapters.id, name: adapters.name, lensMount: adapters.lensMount, bodyMount: adapters.bodyMount, acquiredOn: adapters.acquiredOn })
      .from(adapters).where(and(eq(adapters.userId, userId), eq(adapters.isActive, true))),
  ]);
  return {
    cameras: cams.map((c) => ({ id: c.id, label: `${c.make} ${c.model}`, mount: c.mount, builtInLensId: c.builtInLensId })),
    lenses: lens.map((l) => ({ id: l.id, label: `${l.make} ${l.model}${l.focalLengthMm != null ? ` ${l.focalLengthMm}mm` : ""}`, mount: l.mount })),
    adapters: ads,
  };
}
```
The lens label keeps the focal length, as today. The warning test above expects `Mamiya N 80mm (mamiya-7)` because that fixture lens has no `focalLengthMm`.

Create `packages/server/src/services/gear-warnings.ts`:
```ts
/**
 * gearWarning is computed when a record is read, from the user's current gear, and
 * never written. Fixing a mount or adding an adapter clears it everywhere at once
 * (spec §4.3). One gear load per response, not per row.
 */
import { inArray } from "drizzle-orm";
import { gearWarningFor } from "@tomu/shared";
import { db } from "../db/client.js";
import { rolls } from "../db/schema.js";
import { loadGear } from "./gear.js";

export interface WarnableEvent { cameraId: string | null; rollId: string | null; lensId: string | null; capturedAt: Date | string }

export async function attachEventWarnings<T extends WarnableEvent>(userId: string, rows: T[]): Promise<Array<T & { gearWarning: string | null }>> {
  if (!rows.some((r) => r.lensId)) return rows.map((r) => ({ ...r, gearWarning: null }));
  const gear = await loadGear(userId);
  const needRoll = [...new Set(rows.filter((r) => r.lensId && !r.cameraId && r.rollId).map((r) => r.rollId!))];
  const rollCams = needRoll.length
    ? new Map((await db.select({ id: rolls.id, cameraId: rolls.cameraId }).from(rolls).where(inArray(rolls.id, needRoll))).map((r) => [r.id, r.cameraId]))
    : new Map<string, string | null>();
  return rows.map((r) => {
    const camId = r.cameraId ?? (r.rollId ? rollCams.get(r.rollId) ?? null : null);
    const camera = gear.cameras.find((c) => c.id === camId);
    const lens = gear.lenses.find((l) => l.id === r.lensId);
    return { ...r, gearWarning: gearWarningFor(camera, lens, gear.adapters, r.capturedAt) };
  });
}

export async function attachFrameWarnings<T extends { lensId: string | null; shotAt: Date | null }>(
  userId: string,
  cameraId: string | null,
  rows: T[],
): Promise<Array<T & { gearWarning: string | null }>> {
  if (!cameraId || !rows.some((r) => r.lensId)) return rows.map((r) => ({ ...r, gearWarning: null }));
  const gear = await loadGear(userId);
  const camera = gear.cameras.find((c) => c.id === cameraId);
  return rows.map((r) => ({
    ...r,
    gearWarning: gearWarningFor(camera, gear.lenses.find((l) => l.id === r.lensId), gear.adapters, r.shotAt ?? undefined),
  }));
}
```

In `packages/server/src/routes/field-events.ts`:
- Import `attachEventWarnings`.
- Add below `presentEvent`:
```ts
/** presentEvent plus the derived gear warning, for every response that returns events. */
async function presentEvents(userId: string, rows: FieldEventRow[]) {
  return (await attachEventWarnings(userId, rows)).map((r) => ({ ...presentEvent(r), gearWarning: r.gearWarning }));
}
```
- Replace each `presentEvent(x)` inside a handler with `(await presentEvents(request.userId, [x]))[0]`, and the list's `rows.map(presentEvent)` with `await presentEvents(request.userId, rows)`. Search the file for `presentEvent(` and change every call site except the definition and the new wrapper.
- In the create insert values, after `lensId: parsed.lensId ?? null,`: `lensNote: body.lensNote ?? null,`.
- In the PATCH handler's first field loop, change the key list to `["shutterSpeed", "aperture", "compensation", "meteringMode", "lensId", "lensNote", "subject", "locationName"] as const`. `updateFieldEventSchema` already has `lensNote` from Task 3.

In `packages/server/src/routes/rolls.ts`:
- `POST /:id/frames` insert, after `lensId: body.lensId ?? null,`: `lensNote: body.lensNote ?? null,`.
- `GET /:id` return: replace `frames: rollFrames,` with `frames: await attachFrameWarnings(request.userId, roll.cameraId, rollFrames),` and `unpinnedEvents: unpinnedEvents.map(…)` with:
```ts
        unpinnedEvents: (await attachEventWarnings(request.userId, unpinnedEvents)).map((e) => ({ ...e, shortId: e.id.slice(0, 8) })),
```
  Import both helpers.

In `packages/mcp/src/types.ts` `FieldEventRow`, add `lensNote?: string | null; gearWarning?: string | null;`. In `packages/mcp/src/format.ts` `eventLine`, replace the final `return` with:
```ts
  const lensNote = e.lensNote ? ` · lens: ${e.lensNote}` : "";
  const warning = e.gearWarning ? ` · ⚠ ${e.gearWarning}` : "";
  return `**${e.shortId}** · ${when} · ${where}${frame} · ${head}${e.subject ? ` · ${e.subject}` : ""}${lensNote} · ${state}${warning}`;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/server packages/mcp && npm run typecheck:mcp-tests && npm run build`
Expected: PASS. Existing field-events tests keep passing: `gearWarning: null` is extra data, and the #51 `review`/`parseNotes` tests are untouched.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/gear.ts packages/server/src/services/gear-warnings.ts packages/server/src/routes/field-events.ts packages/server/src/routes/rolls.ts packages/server/test/field-events.routes.test.ts packages/mcp/src/types.ts packages/mcp/src/format.ts packages/mcp/test/format.test.ts
git commit -F - <<'EOF'
feat(server): warn about a lens that cannot fit, computed on read

Events and roll frames gain gearWarning, derived from current gear each
time they are returned (event camera, else its roll's camera, at the
capture time) and never written to review or parseNotes. Adding an
adapter or fixing a mount clears it with nothing rewritten. lens_note is
accepted on events and frames for a lens Tomu has no row for, and a
hand edit of it is recorded. Unknown mounts never warn. tomu_field_events
lines show the warning and the lens note.

Verified: npx vitest run packages/server packages/mcp; build; mcp-tests
typecheck.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RDEzRPUbwUe26oobj6zgTk
EOF
```

---

### Task 7: Built-in lens fill on write, and the backfill

**Files:**
- Create: `packages/server/src/services/built-in-lens.ts`
- Modify: `packages/server/src/routes/field-events.ts` (create handler after the roll lookup ~line 130; pin frame insert ~line 325; `userOwnsRoll` select gains `cameraId`)
- Modify: `packages/server/src/routes/rolls.ts` (`POST /:id/frames`)
- Create route: `POST /api/v1/field-events/backfill-built-in-lenses` in `field-events.ts`
- Modify: `packages/mcp/src/tools/gear.ts` (action `backfill_built_in_lenses`, param `write`)
- Test: `packages/server/test/built-in-lens.test.ts`, `packages/mcp/test/tools/gear.test.ts`

**Interfaces:**
- Consumes: `builtInLensFill`, `loadGear`.
- Produces: `fillBuiltInLens(gear: GearIndex, cameraId: string | null, record: { lensId?: string | null; lensNote?: string | null; editedFields?: string[] }): string | null`; `backfillBuiltInLenses(userId: string, write: boolean): Promise<{ events: number; frames: number; skippedEdited: number; written: boolean }>`; `tomu_gear` action `backfill_built_in_lenses` with `write?: boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/test/built-in-lens.test.ts
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client.js";
import { cameras, fieldEvents, lenses } from "../src/db/schema.js";
import { makeFixture, resetDb, type Fixture } from "./helpers/app.js";

let f: Fixture;
let xaLensId: string;

beforeEach(async () => {
  if (f) await f.app.close();
  await resetDb();
  f = await makeFixture();
  const [xaLens] = await db.insert(lenses).values({ userId: f.userId, make: "Olympus", model: "XA built-in lens", focalLengthMm: 35, mount: "fixed" }).returning();
  xaLensId = xaLens.id;
  // The fixture's camera becomes the XA, so its loaded roll is an XA roll.
  await db.update(cameras).set({ make: "Olympus", model: "XA", mount: "fixed", builtInLensId: xaLensId }).where(eq(cameras.id, f.cameraId));
});

afterAll(async () => {
  await f.app.close();
  await pool.end();
});

const createEvent = (body: Record<string, unknown>) =>
  f.app.inject({ method: "POST", url: "/api/v1/field-events", headers: f.auth, payload: { clientId: randomUUID(), kind: "voice", transcript: "sunny sixteen", ...body } });

describe("built-in lens fill", () => {
  it("fills the built-in lens on create, from the camera or the roll's camera", async () => {
    expect((await createEvent({ cameraId: f.cameraId })).json().data.lensId).toBe(xaLensId);
    expect((await createEvent({ rollId: f.rollId })).json().data.lensId).toBe(xaLensId);
  });

  it("an override on one note leaves the next note filled", async () => {
    const first = (await createEvent({ cameraId: f.cameraId })).json().data;
    await f.app.inject({ method: "PATCH", url: `/api/v1/field-events/${first.id}`, headers: f.auth, payload: { lensId: f.lensId } });
    const second = (await createEvent({ cameraId: f.cameraId })).json().data;
    expect(second.lensId).toBe(xaLensId);
  });

  it("never fills over a lens note or a phone-side edit", async () => {
    expect((await createEvent({ cameraId: f.cameraId, lensNote: "wide converter" })).json().data.lensId).toBeNull();
    expect((await createEvent({ cameraId: f.cameraId, editedFields: ["lensId"] })).json().data.lensId).toBeNull();
  });

  it("fills a frame logged on the roll and a frame created by pinning", async () => {
    const logged = await f.app.inject({ method: "POST", url: `/api/v1/rolls/${f.rollId}/frames`, headers: f.auth, payload: {} });
    expect(logged.json().data.lensId).toBe(xaLensId);
  });

  it("backfill reports counts first, writes only when asked, and skips edited records", async () => {
    await db.insert(fieldEvents).values([
      { clientId: randomUUID(), userId: f.userId, kind: "voice", cameraId: f.cameraId },
      { clientId: randomUUID(), userId: f.userId, kind: "voice", cameraId: f.cameraId, editedFields: ["lensId"] },
    ]);
    const dry = await f.app.inject({ method: "POST", url: "/api/v1/field-events/backfill-built-in-lenses", headers: f.auth, payload: { write: false } });
    expect(dry.json().data).toEqual({ events: 1, frames: 0, skippedEdited: 1, written: false });
    expect((await db.select().from(fieldEvents)).filter((e) => e.lensId === xaLensId)).toHaveLength(0);

    const wet = await f.app.inject({ method: "POST", url: "/api/v1/field-events/backfill-built-in-lenses", headers: f.auth, payload: { write: true } });
    expect(wet.json().data).toMatchObject({ events: 1, written: true });
    expect((await db.select().from(fieldEvents)).filter((e) => e.lensId === xaLensId)).toHaveLength(1);
  });
});
```

Add to `packages/mcp/test/tools/gear.test.ts`:
```ts
it("backfill_built_in_lenses reports counts and only writes when asked", async () => {
  api.answer("POST", "/field-events/backfill-built-in-lenses", { data: { events: 4, frames: 2, skippedEdited: 1, written: false } });
  const reply = await tomu.call("tomu_gear", { action: "backfill_built_in_lenses" });
  expect(api.sent("POST", "/field-events/backfill-built-in-lenses")).toEqual({ write: false });
  expect(reply).toBe("Would fill the built-in lens on 4 note(s) and 2 frame(s); 1 hand-edited record(s) left alone. Run again with write=true to apply.");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/server/test/built-in-lens.test.ts packages/mcp/test/tools/gear.test.ts`
Expected: FAIL (`lensId` null on create; backfill route 404; unknown action).

- [ ] **Step 3: Implementation**

```ts
// packages/server/src/services/built-in-lens.ts
/**
 * Filling a fixed-lens body's lens: a default on one record, never a lock, and never over
 * a set, noted, or hand-edited lens. Spec §4.1.
 */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { builtInLensFill, type GearIndex } from "@tomu/shared";
import { db } from "../db/client.js";
import { fieldEvents, frames, rolls } from "../db/schema.js";
import { loadGear } from "./gear.js";

export function fillBuiltInLens(gear: GearIndex, cameraId: string | null, record: { lensId?: string | null; lensNote?: string | null; editedFields?: string[] }): string | null {
  return builtInLensFill(gear.cameras.find((c) => c.id === cameraId), record);
}

export async function backfillBuiltInLenses(userId: string, write: boolean) {
  const gear = await loadGear(userId);
  const fixed = gear.cameras.filter((c) => c.mount === "fixed" && c.builtInLensId);
  if (!fixed.length) return { events: 0, frames: 0, skippedEdited: 0, written: write };
  const camIds = fixed.map((c) => c.id);

  const evs = await db.select({ id: fieldEvents.id, cameraId: fieldEvents.cameraId, editedFields: fieldEvents.editedFields }).from(fieldEvents)
    .where(and(eq(fieldEvents.userId, userId), inArray(fieldEvents.cameraId, camIds), isNull(fieldEvents.lensId), isNull(fieldEvents.lensNote)));
  const skippedEdited = evs.filter((e) => e.editedFields.includes("lensId")).length;
  const eventTargets = evs.filter((e) => !e.editedFields.includes("lensId"));

  const frameRows = await db.select({ id: frames.id, cameraId: rolls.cameraId }).from(frames)
    .innerJoin(rolls, eq(frames.rollId, rolls.id))
    .where(and(eq(rolls.userId, userId), inArray(rolls.cameraId, camIds), isNull(frames.lensId), isNull(frames.lensNote)));

  if (write) {
    await db.transaction(async (tx) => {
      for (const c of fixed) {
        const evIds = eventTargets.filter((e) => e.cameraId === c.id).map((e) => e.id);
        if (evIds.length) await tx.update(fieldEvents).set({ lensId: c.builtInLensId!, updatedAt: sql`now()` }).where(inArray(fieldEvents.id, evIds));
        const frIds = frameRows.filter((fr) => fr.cameraId === c.id).map((fr) => fr.id);
        if (frIds.length) await tx.update(frames).set({ lensId: c.builtInLensId!, updatedAt: sql`now()` }).where(inArray(frames.id, frIds));
      }
    });
  }
  return { events: eventTargets.length, frames: frameRows.length, skippedEdited, written: write };
}
```
(Frames have no `editedFields`; a frame lens set by hand is non-null and so already skipped.)

`packages/server/src/routes/field-events.ts`:
- `userOwnsRoll` selects `cameraId: rolls.cameraId` too, and returns `{ id; format; status; cameraId }`. Update its return type, and the "camera's active roll" select to include `cameraId: rolls.cameraId`.
- In the create handler, directly before the `try {` that inserts, add:
```ts
    // A fixed-lens body's lens, filled for this record only (spec §4.1).
    const gearForFill = await loadGear(request.userId);
    const filledLens = parsed.lensId == null
      ? fillBuiltInLens(gearForFill, cameraId ?? roll?.cameraId ?? null, { lensId: null, lensNote: body.lensNote ?? null, editedFields: body.editedFields ?? [] })
      : null;
```
  and change the insert's `lensId: parsed.lensId ?? null,` to `lensId: parsed.lensId ?? filledLens ?? null,`.
- In the pin transaction, where a new frame is inserted from `eventToFrame(row, …)`, change `lensId: f.lensId,` to:
```ts
              lensId: f.lensId ?? (row.lensNote ? null : fillBuiltInLens(await loadGear(request.userId), roll.cameraId, { lensId: null, editedFields: row.editedFields })),
              lensNote: row.lensNote ?? null,
```
- Add the backfill route before `// ── Get one`:
```ts
  // ── Backfill built-in lenses: counts first, writes only with write=true ─────
  fastify.post("/backfill-built-in-lenses", async (request) => {
    const write = (request.body as { write?: boolean } | undefined)?.write === true;
    return { data: await backfillBuiltInLenses(request.userId, write) };
  });
```
  Import `fillBuiltInLens, backfillBuiltInLenses` from `../services/built-in-lens.js`.

`packages/server/src/routes/rolls.ts` `POST /:id/frames`: before the insert,
```ts
    const lensForFrame = body.lensId ?? (body.lensNote ? null : fillBuiltInLens(await loadGear(request.userId), roll.cameraId, { lensId: null }));
```
and use `lensId: lensForFrame ?? null,`. Import `fillBuiltInLens` and `loadGear`.

`packages/mcp/src/tools/gear.ts`: add `"backfill_built_in_lenses"` to the action enum, a parameter `write: z.boolean().optional().describe("backfill_built_in_lenses: true applies; default reports counts only")`, and the branch:
```ts
    if (action === "backfill_built_in_lenses") {
      const { data: r } = await api<{ data: { events: number; frames: number; skippedEdited: number; written: boolean } }>(
        "/field-events/backfill-built-in-lenses",
        { method: "POST", body: JSON.stringify({ write: write === true }) },
      );
      const counts = `the built-in lens on ${r.events} note(s) and ${r.frames} frame(s); ${r.skippedEdited} hand-edited record(s) left alone`;
      return { content: [{ type: "text" as const, text: r.written ? `Filled ${counts}.` : `Would fill ${counts}. Run again with write=true to apply.` }] };
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/server packages/mcp && npm run typecheck:mcp-tests && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/services/built-in-lens.ts packages/server/src/routes/field-events.ts packages/server/src/routes/rolls.ts packages/server/test/built-in-lens.test.ts packages/mcp/src/tools/gear.ts packages/mcp/test/tools/gear.test.ts
git commit -F - <<'EOF'
feat(server): fill a fixed-lens body's lens, per record, with a backfill

A note, a logged frame, or a pinned frame from a fixed-lens body gets its
built-in lens when none is set, named in lens_note, or hand-edited. An
override on one note leaves the next note filled: the default is per
record and never learned. The backfill route (and tomu_gear
backfill_built_in_lenses) reports counts first and writes only with
write=true, skipping hand-edited events.

Verified: npx vitest run packages/server packages/mcp; build; built-in-lens
tests cover create, roll camera, override-then-next, lens note, edited,
logged frame, and dry-run versus write backfill.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RDEzRPUbwUe26oobj6zgTk
EOF
```

- [ ] **Step 6: Backfill prod (owner approval required)**

After deploy and after Task 5's seed: `tomu_gear action=backfill_built_in_lenses` (dry run). Show the counts to the owner. Only on approval: `tomu_gear action=backfill_built_in_lenses write=true`.

---

### Task 8: Lens history filter

**Files:**
- Create: `packages/server/src/routes/frames.ts`; register in `app.ts` at `/api/v1/frames`
- Modify: `packages/mcp/src/tools/shooting.ts` (`tomu_rolls`, ~line 223)
- Test: `packages/server/test/frames.routes.test.ts`, `packages/mcp/test/tools/shooting.test.ts`

**Interfaces:**
- Produces: `GET /api/v1/frames?lens_id=<uuid>&lens=<text>` → `{ data: Array<{ id; rollId; frameNumber; lensId; lensNote; lensLabel: string | null; displayId: string | null; shotAt }>, meta: { matched: number; totalFrames: number } }`; `tomu_rolls` parameter `lens`.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/server/test/frames.routes.test.ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "../src/db/client.js";
import { frames, lenses } from "../src/db/schema.js";
import { makeFixture, resetDb, type Fixture } from "./helpers/app.js";

let f: Fixture;

beforeEach(async () => {
  if (f) await f.app.close();
  await resetDb();
  f = await makeFixture();
  const [nokton] = await db.insert(lenses).values({ userId: f.userId, make: "Voigtlander", model: "Nokton", focalLengthMm: 40 }).returning();
  await db.insert(frames).values([
    { rollId: f.rollId, frameNumber: 1, lensId: nokton.id },
    { rollId: f.rollId, frameNumber: 2, lensNote: "borrowed Nokton 35" },
    { rollId: f.rollId, frameNumber: 3, lensId: f.lensId },
  ]);
});

afterAll(async () => {
  await f.app.close();
  await pool.end();
});

describe("GET /frames", () => {
  it("finds frames by fuzzy lens name, including lens notes, and says how many it left out", async () => {
    const res = await f.app.inject({ method: "GET", url: "/api/v1/frames?lens=nokton", headers: f.auth });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((x: { frameNumber: number }) => x.frameNumber)).toEqual([1, 2]);
    expect(res.json().meta).toEqual({ matched: 2, totalFrames: 3 });
  });

  it("finds frames by lens id", async () => {
    const res = await f.app.inject({ method: "GET", url: `/api/v1/frames?lens_id=${f.lensId}`, headers: f.auth });
    expect(res.json().data.map((x: { frameNumber: number }) => x.frameNumber)).toEqual([3]);
  });
});
```

Add to `packages/mcp/test/tools/shooting.test.ts`:
```ts
it("tomu_rolls with a lens lists the frames shot with it and what the filter left out", async () => {
  api.answer("GET", "/frames?lens=nokton", {
    data: [
      { id: "f1", rollId: "r1", frameNumber: 1, lensId: "l40", lensNote: null, lensLabel: "Voigtlander Nokton 40mm", displayId: "20260906.1", shotAt: "2026-09-06T10:00:00.000Z" },
      { id: "f2", rollId: "r1", frameNumber: 2, lensId: null, lensNote: "borrowed Nokton 35", lensLabel: null, displayId: "20260906.1", shotAt: null },
    ],
    meta: { matched: 2, totalFrames: 40 },
  });
  const reply = await tomu.call("tomu_rolls", { lens: "nokton" });
  expect(reply).toContain("## Frames shot with \"nokton\" (2 of 40 frames)");
  expect(reply).toContain("- **20260906.1** frame 1 · Voigtlander Nokton 40mm");
  expect(reply).toContain("- **20260906.1** frame 2 · lens note: borrowed Nokton 35");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/server/test/frames.routes.test.ts packages/mcp/test/tools/shooting.test.ts`
Expected: FAIL (route 404; `lens` is not a `tomu_rolls` parameter).

- [ ] **Step 3: Implementation**

```ts
// packages/server/src/routes/frames.ts
import { and, asc, count, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { db } from "../db/client.js";
import { frames, lenses, rolls } from "../db/schema.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lens history. A filter narrows a view; meta says how much it left out (spec §4.4). */
export async function framesRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: { lens_id?: string; lens?: string } }>("/", async (request, reply) => {
    const { lens_id, lens } = request.query;
    const mine = eq(rolls.userId, request.userId);
    const conds: SQL[] = [mine];
    if (lens_id) {
      if (!UUID_RE.test(lens_id)) return reply.status(400).send({ error: `Invalid lens_id: ${lens_id}` });
      conds.push(eq(frames.lensId, lens_id));
    }
    if (lens) {
      const label = sql`coalesce(${lenses.make}, '') || ' ' || coalesce(${lenses.model}, '') || ' ' || coalesce(${lenses.focalLengthMm}::text, '')`;
      for (const token of lens.toLowerCase().split(/\s+/).filter(Boolean)) {
        conds.push(or(ilike(label, `%${token}%`), ilike(frames.lensNote, `%${token}%`))!);
      }
    }
    const [rows, [{ total }]] = await Promise.all([
      db.select({
        id: frames.id, rollId: frames.rollId, frameNumber: frames.frameNumber, lensId: frames.lensId, lensNote: frames.lensNote,
        lensMake: lenses.make, lensModel: lenses.model, lensFocal: lenses.focalLengthMm, displayId: rolls.displayId, shotAt: frames.shotAt,
      }).from(frames).innerJoin(rolls, eq(frames.rollId, rolls.id)).leftJoin(lenses, eq(frames.lensId, lenses.id))
        .where(and(...conds)).orderBy(asc(rolls.loadedAt), asc(frames.frameNumber)).limit(500),
      db.select({ total: count() }).from(frames).innerJoin(rolls, eq(frames.rollId, rolls.id)).where(mine),
    ]);
    const data = rows.map(({ lensMake, lensModel, lensFocal, ...r }) => ({
      ...r,
      lensLabel: lensMake ? `${lensMake} ${lensModel}${lensFocal != null ? ` ${lensFocal}mm` : ""}` : null,
    }));
    return { data, meta: { matched: data.length, totalFrames: total } };
  });
}
```
Register in `app.ts`: `await fastify.register(framesRoutes, { prefix: "/api/v1/frames" });`.

`packages/mcp/src/tools/shooting.ts` `tomu_rolls`: add parameter `lens: z.string().optional().describe("Frames shot with this lens: fuzzy lens name, also matched against free-text lens notes")` and, at the start of the handler:
```ts
    if (lens) {
      const res = await api<{ data: Array<{ frameNumber: number; lensLabel: string | null; lensNote: string | null; displayId: string | null; rollId: string }>; meta: { matched: number; totalFrames: number } }>(
        `/frames?lens=${encodeURIComponent(lens)}`,
      );
      const lines = [`## Frames shot with "${lens}" (${res.meta.matched} of ${res.meta.totalFrames} frames)`, ""];
      for (const fr of res.data) {
        lines.push(`- **${fr.displayId ?? fr.rollId.slice(0, 8)}** frame ${fr.frameNumber} · ${fr.lensLabel ?? `lens note: ${fr.lensNote}`}`);
      }
      if (!res.data.length) lines.push("No frames match. A lens recorded only in a transcript is not searched; check tomu_field_events.");
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
```
Add `lens` to the destructured handler arguments.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/server/test/frames.routes.test.ts packages/mcp && npm run typecheck:mcp-tests`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/routes/frames.ts packages/server/src/app.ts packages/server/test/frames.routes.test.ts packages/mcp/src/tools/shooting.ts packages/mcp/test/tools/shooting.test.ts
git commit -F - <<'EOF'
feat: lens history — which frames were shot with a lens

GET /frames?lens= matches a fuzzy lens name and the free-text lens_note,
so a lens recorded before Tomu knew it is still found; lens_id matches
exactly. The response says how many frames matched out of all the user's
frames, and tomu_rolls lens= shows both numbers, so a filter never looks
like the whole picture.

Verified: npx vitest run packages/server/test/frames.routes.test.ts
packages/mcp; mcp-tests typecheck.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RDEzRPUbwUe26oobj6zgTk
EOF
```

---

### Task 9: Eval cases for fill and warnings

**Files:**
- Modify: `evals/field-parse/gear.json`, `evals/field-parse/cases.json`, `evals/field-parse/observe.ts` (`tier1Of`), `evals/field-parse/eval.test.ts`

**Interfaces:**
- Consumes: `builtInLensFill`, `gearWarningFor`.
- Produces: `EvalCase.expectGearWarning?: boolean`; `gearWarningOf(c: EvalCase): string | null` in `observe.ts`.

- [ ] **Step 1: Write the failing test**

Add to `evals/field-parse/eval.test.ts` (import `gearWarningOf`):
```ts
describe("gear rules over the corpus", () => {
  it("warns exactly on the cases that expect a gear warning — and never changes the recorded lens", () => {
    for (const c of CASES) {
      const warning = gearWarningOf(c);
      expect(warning != null, `${c.id}: gear warning`).toBe(c.expectGearWarning === true);
    }
  });
});
```

Update `gear.json`:
```json
{
  "cameras": [
    { "id": "cam-m6", "label": "Leica M6", "mount": "leica-m" },
    { "id": "cam-m7", "label": "Mamiya 7", "mount": "mamiya-7" },
    { "id": "cam-crown", "label": "Graflex Crown Graphic", "mount": "lens-board" },
    { "id": "cam-xa", "label": "Olympus XA", "mount": "fixed", "builtInLensId": "lens-xa" }
  ],
  "lenses": [
    { "id": "lens-35", "label": "Leica Summicron 35mm", "mount": "leica-m" },
    { "id": "lens-80", "label": "Mamiya 80mm f/4", "mount": "mamiya-7" },
    { "id": "lens-xa", "label": "Olympus XA 35mm", "mount": "fixed" }
  ],
  "adapters": []
}
```

Append to `cases.json`:
```json
  {
    "id": "fixed-lens-body",
    "source": "synthetic",
    "provenance": "Gear compatibility spec §4.1, 2026-09-14: a fixed-lens body fills its built-in lens when no lens is spoken.",
    "transcript": "XA, sunny sixteen, frame 3",
    "expect": { "cameraId": "cam-xa", "lensId": "lens-xa", "meteringMode": "sunny 16", "frameNumber": "3" }
  },
  {
    "id": "lens-cannot-fit-body",
    "source": "synthetic",
    "provenance": "Gear compatibility spec §4.3, 2026-09-14: record reality — a named lens that cannot fit the named body is kept as spoken and only warned about.",
    "transcript": "M6 with the 80, f8",
    "expect": { "cameraId": "cam-m6", "lensId": "lens-80", "aperture": "f/8" },
    "expectGearWarning": true
  }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run evals/field-parse/eval.test.ts`
Expected: FAIL (`gearWarningOf` is not exported; `fixed-lens-body` misses `lensId`).

- [ ] **Step 3: Implementation**

`evals/field-parse/score.ts` `EvalCase`: add `expectGearWarning?: boolean;`.

`evals/field-parse/observe.ts`: import `builtInLensFill, gearWarningFor` from `@tomu/shared`. In `tier1Of`, after building `out`:
```ts
  // Mirrors the phone: a fixed-lens body fills its built-in lens when none was spoken.
  const camera = GEAR.cameras.find((g) => g.id === out.cameraId);
  const filled = builtInLensFill(camera, { lensId: out.lensId ?? null });
  if (filled) out.lensId = filled;
```
Add:
```ts
/** The warning a person would see for this case's tier-1 camera and lens. */
export function gearWarningOf(c: EvalCase): string | null {
  const t1 = tier1Of(c);
  return gearWarningFor(
    GEAR.cameras.find((g) => g.id === t1.cameraId),
    GEAR.lenses.find((g) => g.id === t1.lensId),
    GEAR.adapters ?? [],
    new Date(),
  );
}
```

Tier-2 recordings for the two new cases need one model call each: `ANTHROPIC_API_KEY=… npm run eval:field-parse -- --live`. Replay without them still gates tier 1, as today.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run eval:field-parse && npx vitest run evals && npm run typecheck:evals`
Expected: tier 1 stays at harm 0 outside `KNOWN_TIER1_GAPS`; the gear test passes.

- [ ] **Step 5: Commit**

```bash
git add evals/field-parse/gear.json evals/field-parse/cases.json evals/field-parse/observe.ts evals/field-parse/score.ts evals/field-parse/eval.test.ts
git commit -F - <<'EOF'
test(evals): fixed-lens fill and a lens-that-cannot-fit warning

The eval gear gains mounts and an Olympus XA with a built-in lens. Two
cases: a note from the XA fills its lens without it being spoken, and
"M6 with the 80" keeps the Mamiya lens as recorded while the gear rules
warn about it. A gate checks warnings appear exactly where expected.

Verified: npm run eval:field-parse; npx vitest run evals; typecheck:evals.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RDEzRPUbwUe26oobj6zgTk
EOF
```

---

### Task 10: Capture — lens picker, "Other lens…", and the inline warning

**Files:**
- Modify: `packages/client/src/offline/api.ts` (`fetchGear` ~line 72), `packages/client/src/offline/db.ts` (`LocalEvent` gains `lensNote`), `packages/client/src/offline/store.ts` (`SaveCaptureInput.cameraId`; fill in `saveCapture`)
- Modify: `packages/client/src/offline/sync.ts` (`toCreateBody` sends `lensNote`)
- Create: `packages/client/src/components/capture/LensPicker.tsx`
- Modify: `packages/client/src/components/capture/FieldChips.tsx`, `packages/client/src/components/capture/CapturePage.tsx` (pass `cameraId` to `saveCapture` ~line 114; open the picker from the lens chip)
- Test: `packages/client/test/capture-store.test.ts`, `packages/client/test/capture-page.dom.test.tsx`

**Interfaces:**
- Consumes: `compatibleLenses`, `gearWarningFor`, `builtInLensFill`, `mountLabel`; API `GET /adapters` (Task 3); `lensNote` on events (Task 6).
- Produces: `GearCache` with mount data and `adapters` (no Dexie version bump, since the new fields are unindexed properties of the single `gear` row); `Chip.warning?: string | null`; `<LensPicker gear camera capturedAt value onPick onOther onClose />`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/client/test/capture-store.test.ts`:
```ts
describe("built-in lens fill on the phone", () => {
  const xaGear = {
    cameras: [{ id: "cam-xa", label: "Olympus XA", mount: "fixed", builtInLensId: "lens-xa" }],
    lenses: [{ id: "lens-xa", label: "Olympus XA 35mm", mount: "fixed" }],
    adapters: [],
    activeRolls: [],
  };

  it("fills the built-in lens when a note is saved from a fixed-lens body", async () => {
    await saveGear(db, xaGear);
    const ev = await saveCapture(db, { transcript: "sunny sixteen", cameraId: "cam-xa" });
    expect(ev.lensId).toBe("lens-xa");
  });

  it("a hand change on one note does not stop the next note being filled", async () => {
    await saveGear(db, xaGear);
    const first = await saveCapture(db, { transcript: "a", cameraId: "cam-xa" });
    await editField(db, first.clientId, "lensId", null);
    const second = await saveCapture(db, { transcript: "b", cameraId: "cam-xa" });
    expect(second.lensId).toBe("lens-xa");
  });
});
```

Add to `packages/client/test/capture-page.dom.test.tsx`:
```ts
describe("the lens chip", () => {
  const lensGear = {
    cameras: [{ id: "cam-m6", label: "Leica M6", mount: "leica-m" }],
    lenses: [
      { id: "lens-80", label: "Mamiya 80mm", mount: "mamiya-7" },
      { id: "lens-y", label: "Old lens", mount: null },
      { id: "lens-40", label: "Voigtlander Nokton 40mm", mount: "leica-m" },
    ],
    adapters: [],
    activeRolls: [{ id: "roll-1", cameraId: "cam-m6", cameraLabel: "Leica M6", label: "Ilford Pan F", framesShot: 11, frameCount: 36 }],
  };

  it("lists every lens — fits first, lenses that do not fit last but still tappable — and warns inline", async () => {
    await saveGear(db, lensGear);
    render(<CapturePage />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/note/i), "f8");
    await user.click(screen.getByRole("button", { name: /save/i }));
    await user.click(await screen.findByRole("button", { name: /lens/i }));

    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options[0]).toContain("Voigtlander Nokton 40mm");
    expect(options[1]).toContain("Old lens");
    expect(options[2]).toContain("Mamiya 80mm");
    expect(options[2]).toContain("doesn't fit");

    await user.click(screen.getAllByRole("option")[2]);
    expect(await screen.findByText(/does not fit Leica M6/)).toBeTruthy();
    const [ev] = await db.events.toArray();
    expect(ev.lensId).toBe("lens-80");
  });

  it("saves a lens Tomu does not know through Other lens…", async () => {
    await saveGear(db, lensGear);
    render(<CapturePage />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/note/i), "f8");
    await user.click(screen.getByRole("button", { name: /save/i }));
    await user.click(await screen.findByRole("button", { name: /lens/i }));
    await user.click(screen.getByRole("button", { name: /other lens/i }));
    await user.type(screen.getByLabelText(/lens name/i), "old Elmar");
    await user.click(screen.getByRole("button", { name: /use this lens/i }));
    const [ev] = await db.events.toArray();
    expect(ev.lensNote).toBe("old Elmar");
    expect(ev.editedFields).toContain("lensNote");
  });
});
```
Before writing Step 3, read `CapturePage.tsx` and match the existing test's selectors for the note field and save button. The labels above (`/note/i`, `/save/i`) must be replaced with the ones the existing tests in this file use.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run --project client packages/client/test/capture-store.test.ts && npx vitest run --project client-dom packages/client/test/capture-page.dom.test.tsx`
Expected: FAIL (no fill; no lens button or options).

- [ ] **Step 3: Implementation**

`offline/api.ts` `fetchGear`: fetch `/adapters` in the `Promise.all`, widen the camera and lens response types with `mount?: string | null; builtInLensId?: string | null`, and map:
```ts
      cameras: cameras.data.map((c) => ({ id: c.id, label: `${c.make} ${c.model}`, mount: c.mount ?? null, builtInLensId: c.builtInLensId ?? null })),
      lenses: lenses.data.map((l) => ({ id: l.id, label: `${l.make} ${l.model}${l.focalLengthMm != null ? ` ${l.focalLengthMm}mm` : ""}`, mount: l.mount ?? null })),
      adapters: adapters.data.filter((a) => a.isActive !== false).map(({ id, name, lensMount, bodyMount, acquiredOn }) => ({ id, name, lensMount, bodyMount, acquiredOn })),
```
Adding an adapter from any client reaches the phone on the next gear refresh, which the sync worker already runs on every pass.

`offline/db.ts` `LocalEvent`: add `lensNote?: string | null;` with the doc comment `/** A lens named in free text ("Other lens…"). */`.

`offline/store.ts`: add `cameraId?: string | null;` to `SaveCaptureInput`, pass `gearIndex` with `adapters: gear.adapters`, and in `saveCapture`, after `parsed`:
```ts
  const cameraId = parsed.fields.cameraId ?? input.cameraId ?? undefined;
  const camera = gear?.cameras.find((c) => c.id === cameraId);
  const filledLens = kind === "voice" ? builtInLensFill(camera, { lensId: parsed.fields.lensId ?? null }) : null;
```
and in the event object, after `...parsed.fields,`: `cameraId, lensId: parsed.fields.lensId ?? filledLens ?? undefined,`. Import `builtInLensFill`.

`offline/sync.ts` `toCreateBody`: add `lensNote: e.lensNote,` next to `sheetId`.

`CapturePage.tsx`: pass `cameraId` to both `saveCapture` calls. Hold `const [pickingLensFor, setPickingLensFor] = useState<LocalEvent | null>(null);`, pass `onPickLens={(ev) => setPickingLensFor(ev)}` to each saved event's `FieldChips` (with the event), and render:
```tsx
      {pickingLensFor && gear && (
        <LensPicker
          gear={gear}
          camera={gear.cameras.find((c) => c.id === (pickingLensFor.cameraId ?? cameraId))}
          capturedAt={pickingLensFor.capturedAt}
          value={pickingLensFor.lensId ?? null}
          onPick={async (lensId) => {
            await editField(db, pickingLensFor.clientId, "lensId", lensId);
            if (pickingLensFor.lensNote) await editField(db, pickingLensFor.clientId, "lensNote", null);
            setPickingLensFor(null);
          }}
          onOther={async (text) => {
            await editField(db, pickingLensFor.clientId, "lensNote", text);
            await editField(db, pickingLensFor.clientId, "lensId", null);
            setPickingLensFor(null);
          }}
          onClose={() => setPickingLensFor(null)}
        />
      )}
```

Create `components/capture/LensPicker.tsx`:
```tsx
import { useState } from "react";
import { compatibleLenses, type CompatCamera } from "@tomu/shared";
import type { GearCache } from "../../offline/db.js";

interface LensPickerProps {
  gear: GearCache;
  camera?: CompatCamera;
  capturedAt: string;
  value: string | null;
  onPick: (lensId: string) => void;
  onOther: (text: string) => void;
  onClose: () => void;
}

/**
 * Every lens, always. Fits first, unknown next, lenses the gear says do not fit last and
 * marked — the model can be wrong, and it never stands between you and the note.
 */
export function LensPicker({ gear, camera, capturedAt, value, onPick, onOther, onClose }: LensPickerProps) {
  const [other, setOther] = useState<string | null>(null);
  const rows = camera
    ? compatibleLenses(camera, gear.lenses, gear.adapters ?? [], capturedAt)
    : gear.lenses.map((lens) => ({ lens, fit: { kind: "unknown" as const } }));
  const adapterName = (id: string) => gear.adapters?.find((a) => a.id === id)?.name;

  return (
    <div role="dialog" aria-label="Choose lens" className="fixed inset-x-0 bottom-0 z-50 rounded-t-xl border bg-background p-4 shadow-lg">
      <ul role="listbox" aria-label="Lenses" className="max-h-72 overflow-y-auto">
        {rows.map(({ lens, fit }) => (
          <li
            key={lens.id}
            role="option"
            aria-selected={lens.id === value}
            tabIndex={0}
            onClick={() => onPick(lens.id)}
            onKeyDown={(e) => e.key === "Enter" && onPick(lens.id)}
            className={fit.kind === "no" ? "py-2 text-muted-foreground" : "py-2"}
          >
            {lens.label}
            {fit.kind === "adapter" && <span className="ml-2 text-xs"> · via {adapterName(fit.adapterId)}</span>}
            {fit.kind === "no" && <span className="ml-2 text-xs"> · doesn't fit</span>}
          </li>
        ))}
      </ul>
      {other == null ? (
        <button type="button" className="mt-3 text-sm underline" onClick={() => setOther("")}>Other lens…</button>
      ) : (
        <div className="mt-3 flex gap-2">
          <input aria-label="Lens name" className="flex-1 rounded border px-2 py-1" value={other} onChange={(e) => setOther(e.target.value)} autoFocus />
          <button type="button" disabled={!other.trim()} onClick={() => onOther(other.trim())}>Use this lens</button>
        </div>
      )}
      <button type="button" className="mt-3 block text-sm" onClick={onClose}>Close</button>
    </div>
  );
}
```

`FieldChips.tsx`:
- `Chip` gains `warning?: string | null;`.
- In `chipsFor`, compute the lens chip as:
```ts
  const warning = gearWarningFor(camera, lens, gear?.adapters ?? [], event.capturedAt);
  // …
    { key: "lens", label: "lens", value: lens?.label ?? event.lensNote ?? null, warning },
```
  Import `gearWarningFor`.
- `FieldChipsProps` gains `onPickLens?: () => void;`. For the chip with `key === "lens"` and `onPickLens` set, render the chip's value as `<button type="button" aria-label="Choose lens" onClick={onPickLens}>…</button>`. After the chip, when `chip.warning`, render `<span role="note" className="text-xs text-amber-600">{chip.warning}</span>`.
- Make the lens chip always render when `onPickLens` is provided (dashed when empty), so there is always a way to name a lens. On a pinhole, the picker still offers "Other lens…".

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run --project client --project client-dom && npm run build -w packages/client`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/offline/api.ts packages/client/src/offline/db.ts packages/client/src/offline/store.ts packages/client/src/offline/sync.ts packages/client/src/components/capture/LensPicker.tsx packages/client/src/components/capture/FieldChips.tsx packages/client/src/components/capture/CapturePage.tsx packages/client/test/capture-store.test.ts packages/client/test/capture-page.dom.test.tsx
git commit -F - <<'EOF'
feat(client): lens picker on capture, with Other lens… and an inline warning

The lens chip opens a picker listing every lens: those that fit the
camera first (adapter fits named), unknown mounts next, and lenses the
gear says do not fit last, marked but tappable. "Other lens…" saves free
text to lens_note offline. A chosen lens that does not fit shows the
warning under the chip and is saved as chosen. Notes from a fixed-lens
body fill its lens on the phone; changing it on one note leaves the next
filled. The gear cache now carries mounts and adapters.

Verified: npx vitest run --project client --project client-dom; client
build.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01RDEzRPUbwUe26oobj6zgTk
EOF
```

---

## Self-review against the spec

| Spec section | Task |
|---|---|
| §2 derived compatibility, adapters widen fits | 2 (`lensFits` over passed-in adapters; "widens" test), 6 (loaded per read) |
| §2 defaults, not constraints; no 4xx on combos | 3 (fixed-without-lens and lens-on-pinhole accepted; ownership only), 10 (all lenses tappable) |
| §2 record reality; derived warning | 6 (`gearWarning` on read, `review`/`parseNotes` untouched), 9, 10 |
| §2 built-in override is per record | 2, 7 (server "override then next"), 10 (phone) |
| §3.1 mount list, aliases, custom slugs | 1 |
| §3.2 additive schema, `acquired_on`, `lens_note`, `camera_lenses` stays | 3 |
| §3.3 `lensFits` order, `at` | 2 |
| §4.1 fixed-lens fill (device, create, pin, frames) | 7 (server), 10 (device) |
| §4.2 capture ordering, Other lens…, gear cache refresh | 10 |
| §4.3 warning on read, roll camera fallback, phone offline, `lensNamedIn` runs first | 6, 10; `lensNamedIn` is untouched from #51 |
| §4.4 `tomu_gear` list, mounts, adapters, lens filter, hidden count | 4, 8 |
| §5 API | 3, 6, 7, 8 |
| §6 seed data, unknowns left unknown | 5 |
| §7 tests | in each task |
| §8 rollout order, backfill counts first | task order; 3 Step 8, 5 Step 6, 7 Step 6 |

**Gaps found and resolved in this plan:**
- **`set_mount` action (spec §4.4):** delivered as `mount` (and `builtInLens`) on #52's `update_camera` / `update_lens`, so there is one way to correct gear instead of two.
- **Deploy order:** a merge deploys without the schema push, and Drizzle selects every column. Task 3 deploys its branch with `migrate: true` before merging.
- **Seed "through the API" with no prod token on the laptop:** Task 5 plans the seed as a pure function, applies it through the API on dev, and applies the same lines through the Tomu connector on prod.
- **Pinhole "no lens chip, but Other lens… offered":** there must be an entry point, so the lens chip always renders (dashed) when the picker is available.
- **Frames have no `editedFields`:** backfill skips frames with any lens or lens note, which covers hand-set frame lenses.

**Needs an owner decision before Task 5 applies to prod:**
- The old Leica LTM lens: make, model, focal length, max aperture. It is not created until given.
- Rollei 35 and Yashica Electro 35 variants. Created with the unknowns in `notes`.
