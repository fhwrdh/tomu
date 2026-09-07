# Field Events Backend Implementation Plan (Field capture V2, part 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace V1 `captures` with the `field_events` stream (voice notes with a verbatim transcript, photos as independent events), add the deterministic parser, the server-side Claude parse, pin/roll-level desk actions, and re-point the MCP tools and `photos:sync`. Part 2 (a separate plan) builds the offline PWA capture screen on top of this API.

**Architecture:** Pure logic (transcript parser, tier merge, provisional frame numbering, event→frame mapping) lives in `packages/shared` under the Vitest coverage gate. The server owns `field_events`, idempotent creation by `client_id`, photo storage under `UPLOADS_DIR`, the tier-2 parse via the Anthropic TypeScript SDK with Zod structured output, and the pin/roll-level transactions. The MCP server exposes the desk-side tools; `tomu_capture` becomes a thin writer of a voice event. The roll detail UI shows unpinned events read-only.

**Tech Stack:** TypeScript, Fastify 5, Drizzle ORM + Postgres 16, Zod, `@anthropic-ai/sdk` (+ `@anthropic-ai/sdk/helpers/zod`), MCP SDK, React 18, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-06-field-capture-v2-design.md` (sections 1, 4, 5, 6, 7, 8; sections 2–3 are part 2).

## Global Constraints

- Branch `feat/field-capture-v2` from `main` (already created). Commit messages end with the trailers `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01Q6jMVz9nSKsnyFxZP939Xi` as separate `-m` args. Never push; the controller does.
- API responses are `{ data: ... }`; routes Zod-`.parse()` bodies; the global handler maps `ZodError` → 400. Every route is JWT-guarded; `request.userId` is the caller.
- **Transcript is immutable**: no route, service, or tool may change `transcript` after creation. PATCH rejects it with 400.
- **Field ownership**: a field named in `edited_fields` is never written by any parser. Tier-1 values stand unless tier-2 confidence ≥ 0.9. Empty fields are filled by tier 2.
- **Frame numbers are sparse and provisional**: a spoken number wins; otherwise next after the highest noted on the roll, `frame_provisional = true`; gaps are never an error. Sheet formats (`4x5`, `8x10`) never get a provisional number.
- Photo storage: `uploads/events/<eventUuid>.jpg`, URL `/uploads/events/<uuid>.jpg`, JPEG only, ≤ 25 MB (413/415/400 exactly as V1).
- Tier-2 model: `FIELD_PARSE_MODEL` env, default `claude-haiku-4-5` (the owner chose a Haiku-class model for this per-capture call). `ANTHROPIC_API_KEY` unset → tier 2 is skipped silently, events stay `synced`. Tier-2 failure never sets `review = true`.
- Snapshot the dev DB into `db-backups/` (timestamped) before every `db:push`. Prod migration runs through the fixed migrate workflow (PR #22) plus the copy script.
- Coverage gate stays green: lines ≥ 90, functions ≥ 90, branches ≥ 85, statements ≥ 90 over the `include` list in `vitest.config.ts`.
- The `captures` table is dropped only in Task 8, after the copy is verified.

## File map

| Path | Responsibility |
|---|---|
| `packages/shared/src/field-parse.ts` | Tier-1 transcript parser: `parseTranscript(text, gear)` → fields, spans, command |
| `packages/shared/src/field-merge.ts` | `mergeParse(current, tier2, editedFields)` rules |
| `packages/shared/src/frame-numbering.ts` | `nextFrameNumber(spoken, highestNoted, format)` |
| `packages/shared/src/field-event.ts` | `eventToFrame(event, frameNumber)`, `FieldEventKind`, `FieldEventStatus` |
| `packages/shared/src/types.ts`, `schemas.ts`, `index.ts` | `FieldEvent` type, Zod schemas, exports (V1 `Capture*` removed in Task 8) |
| `packages/shared/test/field-parse.test.ts`, `field-merge.test.ts`, `frame-numbering.test.ts`, `field-event.test.ts` | Vitest |
| `packages/server/src/db/schema.ts` | `fieldEvents` table |
| `packages/server/scripts/migrate-captures-to-field-events.ts` | one-shot copy `captures` → `field_events` |
| `packages/server/src/routes/field-events.ts` | create/list/get/patch/delete/photo/pin/roll-level/reparse |
| `packages/server/src/services/field-parse-model.ts` | tier-2 Claude call + merge + persistence + retry sweep |
| `packages/server/src/services/field-parse-prompt.md` | the prompt |
| `packages/server/src/routes/rolls.ts` | `unpinnedEvents` on `GET /rolls/:id` |
| `packages/server/src/index.ts`, `config.ts` | registration, `ANTHROPIC_API_KEY`, `FIELD_PARSE_MODEL` |
| `packages/mcp/src/server.ts` | `tomu_capture` (rewritten), `tomu_field_events`, `tomu_edit_event`, `tomu_pin_event`, `tomu_roll_level_event`, `tomu_reparse_events` |
| `scripts/photos-sync.ts` | re-pointed at field events |
| `packages/client/src/services/api.ts`, `components/rolls/RollsPage.tsx` | unpinned events section |
| `CLAUDE.md`, `ROADMAP.md`, `docs/SELF-HOSTING.md`, `vitest.config.ts` | docs + coverage include |

---

### Task 1: Tier-1 transcript parser (shared, pure)

**Files:**
- Create: `packages/shared/src/field-parse.ts`
- Create: `packages/shared/test/field-parse.test.ts`
- Modify: `packages/shared/src/index.ts`, `vitest.config.ts`

**Interfaces:**
- Produces:
  ```ts
  interface GearIndex { cameras: Array<{ id: string; label: string }>; lenses: Array<{ id: string; label: string }> }
  interface ParsedFields { shutterSpeed?: string; aperture?: string; compensation?: string; meteringMode?: string; frameNumber?: number; sheetId?: string; cameraId?: string; lensId?: string }
  type ParseSpan = [start: number, end: number, field: keyof ParsedFields | "command"]
  interface ParseResult { fields: ParsedFields; spans: ParseSpan[]; command: "delete_last" | null }
  function parseTranscript(text: string, gear?: GearIndex): ParseResult
  ```

- [ ] **Step 1: Write the failing tests** in `packages/shared/test/field-parse.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseTranscript } from "../src/field-parse.js";

const gear = {
  cameras: [
    { id: "cam-m6", label: "Leica M6" },
    { id: "cam-m7", label: "Mamiya 7" },
    { id: "cam-crown", label: "Graflex Crown Graphic" },
  ],
  lenses: [
    { id: "lens-35", label: "Leica Summicron 35mm" },
    { id: "lens-80", label: "Mamiya 80mm f/4" },
  ],
};

describe("shutter", () => {
  it.each([
    ["1/250", "1/250"],
    ["at 250", "1/250"],
    ["a two-fiftieth", "1/250"],
    ["two fifty", "1/250"],
    ["one sixty", "1/60"],
    ["1/1000", "1/1000"],
    ["two seconds", "2s"],
    ["2s", "2s"],
    ["half a second", "1/2"],
    ["bulb", "B"],
  ])("%s → %s", (text, want) => {
    expect(parseTranscript(text).fields.shutterSpeed).toBe(want);
  });
});

describe("aperture", () => {
  it.each([
    ["f8", "f/8"],
    ["f/8", "f/8"],
    ["f 8", "f/8"],
    ["at f eight", "f/8"],
    ["five six", "f/5.6"],
    ["f5.6", "f/5.6"],
    ["two point eight", "f/2.8"],
    ["f/2.8", "f/2.8"],
    ["eleven", "f/11"],
    ["wide open", undefined],
  ])("%s → %s", (text, want) => {
    expect(parseTranscript(text).fields.aperture).toBe(want);
  });
});

describe("compensation and metering", () => {
  it("reads plus/minus fractions", () => {
    expect(parseTranscript("plus one").fields.compensation).toBe("+1");
    expect(parseTranscript("+1").fields.compensation).toBe("+1");
    expect(parseTranscript("minus a third").fields.compensation).toBe("-1/3");
    expect(parseTranscript("-2/3").fields.compensation).toBe("-2/3");
    expect(parseTranscript("plus two thirds").fields.compensation).toBe("+2/3");
    expect(parseTranscript("plus one and a half").fields.compensation).toBe("+1.5");
  });
  it("reads metering words", () => {
    expect(parseTranscript("spot on the wall").fields.meteringMode).toBe("spot");
    expect(parseTranscript("incident reading").fields.meteringMode).toBe("incident");
    expect(parseTranscript("sunny sixteen").fields.meteringMode).toBe("sunny 16");
    expect(parseTranscript("sunny 16").fields.meteringMode).toBe("sunny 16");
    expect(parseTranscript("just a guess").fields.meteringMode).toBe("guess");
  });
});

describe("frame and sheet", () => {
  it("reads spoken frame numbers only with a frame/number cue", () => {
    expect(parseTranscript("frame 12 of the lake").fields.frameNumber).toBe(12);
    expect(parseTranscript("number twelve").fields.frameNumber).toBe(12);
    expect(parseTranscript("twelve people on the beach").fields.frameNumber).toBeUndefined();
  });
  it("reads sheet holder ids", () => {
    expect(parseTranscript("holder 3 a").fields.sheetId).toBe("3A");
    expect(parseTranscript("sheet 3b").fields.sheetId).toBe("3B");
  });
});

describe("gear", () => {
  it("matches camera and lens by fuzzy tokens", () => {
    const r = parseTranscript("on the m6 with the summicron, two fifty at f8", gear);
    expect(r.fields.cameraId).toBe("cam-m6");
    expect(r.fields.lensId).toBe("lens-35");
    expect(r.fields.shutterSpeed).toBe("1/250");
    expect(r.fields.aperture).toBe("f/8");
  });
  it("matches the Mamiya by model name and the 80 by focal length", () => {
    const r = parseTranscript("mamiya, 80, one twenty-fifth at eleven", gear);
    expect(r.fields.cameraId).toBe("cam-m7");
    expect(r.fields.lensId).toBe("lens-80");
    expect(r.fields.shutterSpeed).toBe("1/125");
    expect(r.fields.aperture).toBe("f/11");
  });
  it("leaves gear unset with no index", () => {
    expect(parseTranscript("m6 250 f8").fields.cameraId).toBeUndefined();
  });
});

describe("commands and spans", () => {
  it("detects delete phrases", () => {
    expect(parseTranscript("scratch that").command).toBe("delete_last");
    expect(parseTranscript("Delete last").command).toBe("delete_last");
    expect(parseTranscript("delete that one").command).toBe("delete_last");
    expect(parseTranscript("the last light").command).toBeNull();
  });
  it("reports consumed spans in order", () => {
    const text = "frame 12, 1/250 at f/8, spot";
    const r = parseTranscript(text);
    const consumed = r.spans.map(([s, e, f]) => [text.slice(s, e), f]);
    expect(consumed).toEqual([
      ["frame 12", "frameNumber"],
      ["1/250", "shutterSpeed"],
      ["f/8", "aperture"],
      ["spot", "meteringMode"],
    ]);
  });
  it("parses a ramble without touching it", () => {
    const text =
      "okay so this is the kitchen window again, um, two fifty at f eight, plus one because of the backlight, " +
      "the sound of the fridge is in this one somehow, frame nine I think";
    const r = parseTranscript(text);
    expect(r.fields).toMatchObject({ shutterSpeed: "1/250", aperture: "f/8", compensation: "+1", frameNumber: 9 });
    expect(r.command).toBeNull();
  });
  it("returns nothing for text with no settings", () => {
    const r = parseTranscript("just a note about the light");
    expect(r.fields).toEqual({});
    expect(r.spans).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to see it fail**

Run: `npx vitest run packages/shared/test/field-parse.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/shared/src/field-parse.ts`**

```ts
/**
 * Tier-1 field parser — deterministic, runs on the phone on every keystroke
 * and on the server as a fallback. Never modifies the transcript; returns the
 * fields it recognised plus the character spans it consumed.
 */

export interface GearIndex {
  cameras: Array<{ id: string; label: string }>;
  lenses: Array<{ id: string; label: string }>;
}

export interface ParsedFields {
  shutterSpeed?: string;
  aperture?: string;
  compensation?: string;
  meteringMode?: string;
  frameNumber?: number;
  sheetId?: string;
  cameraId?: string;
  lensId?: string;
}

export type ParseSpan = [start: number, end: number, field: keyof ParsedFields | "command"];

export interface ParseResult {
  fields: ParsedFields;
  spans: ParseSpan[];
  command: "delete_last" | null;
}

// ── number words ──
const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const ORDINAL: Record<string, number> = {
  fifteenth: 15, thirtieth: 30, sixtieth: 60, "one twenty-fifth": 125, "one twenty fifth": 125,
  "two fiftieth": 250, "two-fiftieth": 250, "five hundredth": 500, thousandth: 1000, "one thousandth": 1000,
};
const HUNDREDS_WORDS = "(?:one|two|four|five|eight)?\\s*(?:hundred|thousand)";

/** "two fifty" → 250, "one sixty" → 160, "sixty" → 60, "125" → 125. */
function wordsToNumber(s: string): number | null {
  const t = s.toLowerCase().replace(/-/g, " ").trim();
  if (/^\d+$/.test(t)) return Number(t);
  const parts = t.split(/\s+/);
  let n = 0;
  for (const p of parts) {
    if (p in ONES) n = n * (n >= 10 ? 1 : 1) + ONES[p]; // "two fifty": handled below
    else if (p in TENS) n = n * 10 + TENS[p] / 10 * 10; // placeholder, replaced below
    else return null;
  }
  return n;
}

// The simple version above mis-handles "two fifty" (=250) vs "twenty five" (=25); use a
// small grammar instead: [ones] [tens|hundred] ([ones])
function spokenNumber(s: string): number | null {
  const t = s.toLowerCase().replace(/-/g, " ").trim();
  if (/^\d+$/.test(t)) return Number(t);
  const w = t.split(/\s+/);
  if (w.length === 1) return ONES[w[0]] ?? TENS[w[0]] ?? (w[0] === "hundred" ? 100 : w[0] === "thousand" ? 1000 : null);
  if (w.length === 2) {
    const [a, b] = w;
    if (a in TENS && b in ONES && ONES[b] < 10) return TENS[a] + ONES[b]; // twenty five
    if (a in ONES && b in TENS) return ONES[a] * 100 + TENS[b]; // two fifty → 250
    if (a in ONES && b === "hundred") return ONES[a] * 100;
    if (a in ONES && b === "thousand") return ONES[a] * 1000;
    if (a in ONES && b in ONES && ONES[b] >= 10) return ONES[a] * 100 + ONES[b]; // one sixty? no: "one sixty" is ONES+TENS
    return null;
  }
  if (w.length === 3) {
    const [a, b, c] = w;
    if (a in ONES && b === "hundred" && c in ONES) return ONES[a] * 100 + ONES[c];
    if (a in ONES && b in TENS && c in ONES) return ONES[a] * 100 + TENS[b] + ONES[c]; // one twenty five → 125
  }
  return null;
}
void wordsToNumber; // keep the simpler helper out of the public surface

const NUM_WORD = "(?:\\d+|(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand)(?:[\\s-](?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand))*)";

interface Rule { field: keyof ParsedFields | "command"; re: RegExp; value: (m: RegExpMatchArray) => string | number | null }

const SHUTTER_RULES: Rule[] = [
  { field: "shutterSpeed", re: /\b1\/(\d{1,5})\b/gi, value: (m) => `1/${m[1]}` },
  { field: "shutterSpeed", re: /\bbulb\b/gi, value: () => "B" },
  { field: "shutterSpeed", re: /\bhalf a second\b/gi, value: () => "1/2" },
  { field: "shutterSpeed", re: new RegExp(`\\b(${NUM_WORD})\\s*(?:seconds?|s)\\b`, "gi"), value: (m) => { const n = spokenNumber(m[1]); return n == null ? null : `${n}s`; } },
  { field: "shutterSpeed", re: /\b(?:a |an )?(one twenty[\s-]?fifth|two[\s-]?fiftieth|five hundredth|(?:one )?thousandth|fifteenth|thirtieth|sixtieth)\b/gi, value: (m) => { const n = ORDINAL[m[1].toLowerCase().replace(/\s+/g, " ")]; return n ? `1/${n}` : null; } },
  // "at 250", "two fifty", "one sixty", "at 1000" — a bare number ≥ 15 following "at" or standing alone before "at f"
  { field: "shutterSpeed", re: new RegExp(`(?:\\bat\\s+)?\\b(${NUM_WORD})\\b(?=\\s*(?:,|at\\b|and\\b|f\\b|f/|$))`, "gi"), value: (m) => { const n = spokenNumber(m[1]); return n != null && n >= 15 && n <= 8000 ? `1/${n}` : null; } },
];

const APERTURE_WORDS: Record<string, string> = {
  "one four": "1.4", "one point four": "1.4", "two": "2", "two point eight": "2.8", "two eight": "2.8", "four": "4",
  "five six": "5.6", "five point six": "5.6", "eight": "8", "eleven": "11", "sixteen": "16", "twenty two": "22", "twenty-two": "22", "thirty two": "32", "thirty-two": "32", "forty five": "45", "sixty four": "64",
};
const APERTURE_RULES: Rule[] = [
  { field: "aperture", re: /\bf\s*\/?\s*(\d{1,2}(?:\.\d)?)\b/gi, value: (m) => `f/${m[1]}` },
  { field: "aperture", re: new RegExp(`\\bf\\s+(${Object.keys(APERTURE_WORDS).join("|")})\\b`, "gi"), value: (m) => `f/${APERTURE_WORDS[m[1].toLowerCase()]}` },
  // spoken f-number without the "f": only the unambiguous ones (5.6, 2.8, 11, 16, 22 and "at eight/eleven")
  { field: "aperture", re: /\b(five six|five point six|two point eight|two eight|one point four|twenty[\s-]two|thirty[\s-]two)\b/gi, value: (m) => `f/${APERTURE_WORDS[m[1].toLowerCase().replace(/-/g, " ")] ?? APERTURE_WORDS[m[1].toLowerCase()]}` },
  { field: "aperture", re: /\bat\s+(eight|eleven|sixteen)\b/gi, value: (m) => `f/${APERTURE_WORDS[m[1].toLowerCase()]}` },
  { field: "aperture", re: /^\s*(eleven|sixteen)\s*$/gi, value: (m) => `f/${APERTURE_WORDS[m[1].toLowerCase()]}` },
];

const FRACTION: Record<string, string> = { "a third": "1/3", "one third": "1/3", "two thirds": "2/3", "a half": "1/2", "one half": "1/2", "half": "1/2" };
const COMP_RULES: Rule[] = [
  { field: "compensation", re: /(?<![\w/])([+-])\s?(\d(?:\.\d)?|\d\/\d)\b/g, value: (m) => `${m[1]}${m[2]}` },
  { field: "compensation", re: /\b(plus|minus)\s+(one|two|three)\s+and\s+(?:a\s+)?half\b/gi, value: (m) => `${m[1].toLowerCase() === "plus" ? "+" : "-"}${ONES[m[2].toLowerCase()]}.5` },
  { field: "compensation", re: /\b(plus|minus)\s+(a third|one third|two thirds|a half|one half|half)\b/gi, value: (m) => `${m[1].toLowerCase() === "plus" ? "+" : "-"}${FRACTION[m[2].toLowerCase()]}` },
  { field: "compensation", re: /\b(plus|minus)\s+(one|two|three|1|2|3)\b(?!\s+and)/gi, value: (m) => `${m[1].toLowerCase() === "plus" ? "+" : "-"}${ONES[m[2].toLowerCase()] ?? m[2]}` },
];

const METER_RULES: Rule[] = [
  { field: "meteringMode", re: /\bsunny\s*(?:16|sixteen)\b/gi, value: () => "sunny 16" },
  { field: "meteringMode", re: /\bincident\b/gi, value: () => "incident" },
  { field: "meteringMode", re: /\bspot\b/gi, value: () => "spot" },
  { field: "meteringMode", re: /\baverage\b/gi, value: () => "average" },
  { field: "meteringMode", re: /\bcent(?:er|re)(?:[\s-]weighted)?\b/gi, value: () => "center" },
  { field: "meteringMode", re: /\bguess(?:ed|ing)?\b/gi, value: () => "guess" },
];

const FRAME_RULES: Rule[] = [
  { field: "frameNumber", re: new RegExp(`\\b(?:frame|number|no\\.?|#)\\s*(${NUM_WORD})\\b`, "gi"), value: (m) => spokenNumber(m[1]) },
  { field: "sheetId", re: /\b(?:holder|sheet)\s*(\d{1,2})\s*([ab])\b/gi, value: (m) => `${m[1]}${m[2].toUpperCase()}` },
];

const COMMAND_RE = /\b(scratch that|delete (?:last|that)(?: one)?|delete the last(?: one)?)\b/i;

function overlaps(spans: ParseSpan[], s: number, e: number): boolean {
  return spans.some(([a, b]) => s < b && e > a);
}

function apply(rules: Rule[], text: string, fields: ParsedFields, spans: ParseSpan[]) {
  for (const rule of rules) {
    if (fields[rule.field as keyof ParsedFields] !== undefined) continue;
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(text))) {
      const s = m.index, e = m.index + m[0].length;
      if (overlaps(spans, s, e)) continue;
      const v = rule.value(m);
      if (v == null) continue;
      (fields as Record<string, unknown>)[rule.field] = v;
      spans.push([s, e, rule.field]);
      break;
    }
  }
}

/** Token-overlap gear match: every query token must appear in the label; longest label wins ties. */
function matchGear(text: string, items: Array<{ id: string; label: string }>): { id: string; span: [number, number] } | null {
  const lower = text.toLowerCase();
  let best: { id: string; span: [number, number]; score: number } | null = null;
  for (const it of items) {
    const toks = it.label.toLowerCase().split(/[^a-z0-9.]+/).filter((t) => t.length >= 2);
    for (const tok of toks) {
      const re = new RegExp(`\\b${tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      const m = re.exec(lower);
      if (!m) continue;
      // Generic tokens ("leica", "mamiya") match; prefer model tokens ("m6", "80mm") by length.
      const score = tok.length + (/\d/.test(tok) ? 2 : 0);
      if (!best || score > best.score) best = { id: it.id, span: [m.index, m.index + tok.length], score };
    }
  }
  return best ? { id: best.id, span: best.span } : null;
}

export function parseTranscript(text: string, gear?: GearIndex): ParseResult {
  const fields: ParsedFields = {};
  const spans: ParseSpan[] = [];
  let command: ParseResult["command"] = null;

  const cm = COMMAND_RE.exec(text);
  if (cm) { command = "delete_last"; spans.push([cm.index, cm.index + cm[0].length, "command"]); }

  // Order matters: explicit forms first so bare numbers don't steal them.
  apply(FRAME_RULES, text, fields, spans);
  apply(SHUTTER_RULES.slice(0, 5), text, fields, spans);
  apply(APERTURE_RULES, text, fields, spans);
  apply(COMP_RULES, text, fields, spans);
  apply(METER_RULES, text, fields, spans);
  apply(SHUTTER_RULES.slice(5), text, fields, spans); // bare-number shutter last

  if (gear) {
    const cam = matchGear(text, gear.cameras);
    if (cam && !overlaps(spans, ...cam.span)) { fields.cameraId = cam.id; spans.push([cam.span[0], cam.span[1], "cameraId"]); }
    const lens = matchGear(text, gear.lenses);
    if (lens && !overlaps(spans, ...lens.span)) { fields.lensId = lens.id; spans.push([lens.span[0], lens.span[1], "lensId"]); }
  }

  spans.sort((a, b) => a[0] - b[0]);
  return { fields, spans, command };
}
```

Then delete the dead `wordsToNumber` function and its `void` line — they exist only to show the pitfall; the grammar in `spokenNumber` is the implementation. Run the tests; iterate on the regexes until every case passes. The expected outcomes in the test file are the contract; the regexes above are a starting point and may need adjusting (e.g. the bare-number shutter rule must not fire on "frame 12" — the frame rule runs first and its span blocks it; "eleven" alone as aperture only when it is the whole remaining phrase after "at" or the entire text).

- [ ] **Step 4: Export and add to coverage**

`packages/shared/src/index.ts`: `export * from "./field-parse.js";`
`vitest.config.ts` coverage include: add `"packages/shared/src/field-parse.ts"`, `"packages/shared/src/field-merge.ts"`, `"packages/shared/src/frame-numbering.ts"`, `"packages/shared/src/field-event.ts"` (the last three arrive in Task 2; vitest tolerates missing files in the include list).

- [ ] **Step 5: Run tests + coverage + build**

Run: `npx vitest run packages/shared/test/field-parse.test.ts && npm run test:coverage && npm run build:shared`
Expected: PASS; thresholds hold (add tests for uncovered branches rather than lowering thresholds).

- [ ] **Step 6: Commit**

```bash
git add packages/shared vitest.config.ts
git commit -m "feat(shared): tier-1 transcript parser for field events" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01Q6jMVz9nSKsnyFxZP939Xi"
```

---

### Task 2: Merge rules, frame numbering, event→frame mapping, types (shared)

**Files:**
- Create: `packages/shared/src/field-merge.ts`, `frame-numbering.ts`, `field-event.ts`
- Create: `packages/shared/test/field-merge.test.ts`, `frame-numbering.test.ts`, `field-event.test.ts`
- Modify: `packages/shared/src/types.ts` (append), `schemas.ts` (append), `index.ts`

**Interfaces:**
- Produces:
  ```ts
  // field-merge.ts
  const PARSED_FIELD_NAMES = ["shutterSpeed","aperture","compensation","meteringMode","lensId","subject","locationName"] as const
  type ParsedFieldName = typeof PARSED_FIELD_NAMES[number]
  interface Tier2Result { fields: Partial<Record<ParsedFieldName, string | null>>; confidence: Partial<Record<ParsedFieldName, number>>; cameraId?: string | null; remarks?: string; sceneDescription?: string; reviewReason?: string | null }
  function mergeParse(current: Record<ParsedFieldName, string | null | undefined>, tier2: Tier2Result, editedFields: string[]): { fields: Partial<Record<ParsedFieldName, string | null>>; changed: ParsedFieldName[] }
  // frame-numbering.ts
  function nextFrameNumber(args: { spoken?: number | null; highestNoted: number | null; format: string }): { frameNumber: number | null; provisional: boolean }
  // field-event.ts
  type FieldEventKind = "voice" | "photo"; type FieldEventStatus = "pending" | "pinned" | "roll_level"
  const SHEET_FORMATS = ["4x5", "8x10"]
  function eventToFrame(e: FieldEventLike, frameNumber: number): FrameFields   // same FrameFields shape as V1 captureToFrame: frameNumber, lensId, shutterSpeed, aperture, compensation, meteringMode, subject, locationName, notes(null), latitude, longitude, shotAt
  ```
  Types: `FieldEvent` (mirrors the table), schemas `createFieldEventSchema`, `updateFieldEventSchema`, `pinFieldEventSchema`, `rollLevelFieldEventSchema`, `fieldEventPhotoMetaSchema`, `reparseFieldEventsSchema`.

- [ ] **Step 1: Types** — append to `packages/shared/src/types.ts` after the `Capture` interface:

```ts
// ── Field events (V2 stream) ──

export type FieldEventKind = "voice" | "photo";
export type FieldEventStatus = "pending" | "pinned" | "roll_level";

/** One thing captured in the field: a voice note (transcript + parsed fields) or a photo. */
export interface FieldEvent extends Timestamps {
  id: string;
  clientId: string;
  userId: string;
  kind: FieldEventKind;
  capturedAt: string;
  latitude?: number;
  longitude?: number;
  rollId?: string;
  cameraId?: string;
  frameNumber?: number;
  frameProvisional: boolean;
  sheetId?: string;
  /** Verbatim dictation. Immutable. */
  transcript?: string;
  fileKey?: string;
  fileUrl?: string;
  mimeType?: string;
  fileSizeBytes?: number;
  widthPx?: number;
  heightPx?: number;
  shutterSpeed?: string;
  aperture?: string;
  compensation?: string;
  meteringMode?: string;
  lensId?: string;
  subject?: string;
  locationName?: string;
  remarks?: string;
  sceneDescription?: string;
  parsedAt?: string;
  parser?: string;
  parseNotes?: string;
  editedFields: string[];
  review: boolean;
  status: FieldEventStatus;
  frameId?: string;
}
```

- [ ] **Step 2: Schemas** — append to `packages/shared/src/schemas.ts`:

```ts
// ── Field events (V2 stream) ──

const parsedFieldSchemas = {
  shutterSpeed: z.string().max(20).nullable().optional(),
  aperture: z.string().max(10).nullable().optional(),
  compensation: z.string().max(10).nullable().optional(),
  meteringMode: z.string().max(30).nullable().optional(),
  lensId: uuid.nullable().optional(),
  subject: z.string().max(500).nullable().optional(),
  locationName: z.string().max(200).nullable().optional(),
};

export const createFieldEventSchema = z.object({
  clientId: uuid,
  kind: z.enum(["voice", "photo"]),
  capturedAt: z.string().datetime().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  rollId: uuid.nullable().optional(),
  cameraId: uuid.nullable().optional(),
  frameNumber: z.number().int().positive().nullable().optional(),
  sheetId: z.string().max(10).nullable().optional(),
  transcript: z.string().max(20000).optional(),
  ...parsedFieldSchemas,
  /** Fields the phone already parsed (tier 1) — recorded as parser "regex". */
  parser: z.enum(["regex"]).optional(),
  /** Fields the user corrected on the phone before sync. */
  editedFields: z.array(z.string()).optional(),
});

export const updateFieldEventSchema = z.object({
  rollId: uuid.nullable().optional(),
  cameraId: uuid.nullable().optional(),
  frameNumber: z.number().int().positive().nullable().optional(),
  sheetId: z.string().max(10).nullable().optional(),
  capturedAt: z.string().datetime().optional(),
  ...parsedFieldSchemas,
  remarks: z.string().max(5000).nullable().optional(),
  sceneDescription: z.string().max(2000).nullable().optional(),
  review: z.boolean().optional(),
});

export const pinFieldEventSchema = z.object({
  rollId: uuid.optional(),
  frameNumber: z.number().int().positive(),
});

export const rollLevelFieldEventSchema = z.object({
  rollId: uuid.optional(),
});

export const fieldEventPhotoMetaSchema = z.object({
  photoTakenAt: z.string().datetime().optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  photoAssetId: z.string().max(100).optional(),
});

export const reparseFieldEventsSchema = z
  .object({
    ids: z.array(uuid).min(1).max(200).optional(),
    rollId: uuid.optional(),
    since: z.string().datetime().optional(),
  })
  .refine((v) => v.ids || v.rollId || v.since, { message: "pass ids, rollId, or since" });
```

- [ ] **Step 3: Failing tests** — `packages/shared/test/field-merge.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mergeParse } from "../src/field-merge.js";

const current = { shutterSpeed: "1/250", aperture: "f/8", compensation: null, meteringMode: null, lensId: null, subject: null, locationName: null };

describe("mergeParse", () => {
  it("fills empty fields from tier 2", () => {
    const r = mergeParse(current, { fields: { subject: "kitchen window", compensation: "+1" }, confidence: { subject: 0.8, compensation: 0.7 } }, []);
    expect(r.fields).toEqual({ subject: "kitchen window", compensation: "+1" });
    expect(r.changed).toEqual(["compensation", "subject"]);
  });
  it("keeps a tier-1 value unless tier-2 confidence >= 0.9", () => {
    const low = mergeParse(current, { fields: { aperture: "f/11" }, confidence: { aperture: 0.6 } }, []);
    expect(low.fields).toEqual({});
    const high = mergeParse(current, { fields: { aperture: "f/11" }, confidence: { aperture: 0.95 } }, []);
    expect(high.fields).toEqual({ aperture: "f/11" });
  });
  it("never touches edited fields", () => {
    const r = mergeParse(current, { fields: { aperture: "f/11", subject: "x" }, confidence: { aperture: 1, subject: 1 } }, ["aperture"]);
    expect(r.fields).toEqual({ subject: "x" });
  });
  it("ignores null and undefined tier-2 values and unknown keys", () => {
    const r = mergeParse(current, { fields: { subject: null, locationName: undefined, bogus: "x" } as never, confidence: {} }, []);
    expect(r.fields).toEqual({});
  });
  it("treats a missing confidence as 0", () => {
    const r = mergeParse(current, { fields: { shutterSpeed: "1/500" }, confidence: {} }, []);
    expect(r.fields).toEqual({});
  });
});
```

`packages/shared/test/frame-numbering.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { nextFrameNumber } from "../src/frame-numbering.js";

describe("nextFrameNumber", () => {
  it("spoken number wins, even out of order", () => {
    expect(nextFrameNumber({ spoken: 12, highestNoted: 4, format: "35mm" })).toEqual({ frameNumber: 12, provisional: false });
    expect(nextFrameNumber({ spoken: 3, highestNoted: 12, format: "35mm" })).toEqual({ frameNumber: 3, provisional: false });
  });
  it("provisional next after the highest noted", () => {
    expect(nextFrameNumber({ highestNoted: 4, format: "35mm" })).toEqual({ frameNumber: 5, provisional: true });
    expect(nextFrameNumber({ highestNoted: null, format: "120" })).toEqual({ frameNumber: 1, provisional: true });
  });
  it("sheet formats never get a provisional number", () => {
    expect(nextFrameNumber({ highestNoted: 2, format: "4x5" })).toEqual({ frameNumber: null, provisional: false });
    expect(nextFrameNumber({ spoken: 3, highestNoted: 2, format: "8x10" })).toEqual({ frameNumber: 3, provisional: false });
  });
});
```

`packages/shared/test/field-event.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { eventToFrame } from "../src/field-event.js";

describe("eventToFrame", () => {
  const e = {
    capturedAt: "2026-09-06T22:45:00.000Z",
    latitude: "47.7531617", longitude: "-122.6557617",
    shutterSpeed: "1/250", aperture: "f/8", compensation: "+1", meteringMode: "spot",
    lensId: "11111111-1111-1111-1111-111111111111", subject: "kitchen window", locationName: "home",
  };
  it("copies settings, uses capturedAt as shotAt, parses numeric strings", () => {
    expect(eventToFrame(e, 7)).toEqual({
      frameNumber: 7, lensId: e.lensId, shutterSpeed: "1/250", aperture: "f/8", compensation: "+1", meteringMode: "spot",
      subject: "kitchen window", locationName: "home", notes: null, latitude: 47.7531617, longitude: -122.6557617,
      shotAt: "2026-09-06T22:45:00.000Z",
    });
  });
  it("maps missing values to null", () => {
    const f = eventToFrame({ capturedAt: new Date("2026-09-06T22:45:00Z") }, 1);
    expect(f.lensId).toBeNull(); expect(f.latitude).toBeNull(); expect(f.shotAt).toBe("2026-09-06T22:45:00.000Z");
  });
});
```

- [ ] **Step 4: Run to see them fail**

Run: `npx vitest run packages/shared/test/field-merge.test.ts packages/shared/test/frame-numbering.test.ts packages/shared/test/field-event.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 5: Implement**

`packages/shared/src/field-merge.ts`:

```ts
/** Merge a tier-2 (model) parse into an event's current fields. Tier 1 wins unless the
 * model is ≥ 0.9 confident; hand-edited fields are never touched; empties are filled. */
export const PARSED_FIELD_NAMES = ["shutterSpeed", "aperture", "compensation", "meteringMode", "lensId", "subject", "locationName"] as const;
export type ParsedFieldName = (typeof PARSED_FIELD_NAMES)[number];

export interface Tier2Result {
  fields: Partial<Record<ParsedFieldName, string | null>>;
  confidence: Partial<Record<ParsedFieldName, number>>;
  cameraId?: string | null;
  remarks?: string;
  sceneDescription?: string;
  reviewReason?: string | null;
}

export const TIER2_OVERRIDE_CONFIDENCE = 0.9;

export function mergeParse(
  current: Record<ParsedFieldName, string | null | undefined>,
  tier2: Tier2Result,
  editedFields: string[],
): { fields: Partial<Record<ParsedFieldName, string | null>>; changed: ParsedFieldName[] } {
  const out: Partial<Record<ParsedFieldName, string | null>> = {};
  const edited = new Set(editedFields);
  for (const name of PARSED_FIELD_NAMES) {
    const v = tier2.fields[name];
    if (v == null || v === "") continue;
    if (edited.has(name)) continue;
    const have = current[name];
    const conf = tier2.confidence[name] ?? 0;
    if (have == null || have === "" || conf >= TIER2_OVERRIDE_CONFIDENCE) {
      if (have !== v) out[name] = v;
    }
  }
  return { fields: out, changed: (Object.keys(out) as ParsedFieldName[]).sort() };
}
```

`packages/shared/src/frame-numbering.ts`:

```ts
import { SHEET_FORMATS } from "./field-event.js";

/** Sparse, provisional numbering: spoken wins; else next after the highest noted; sheets never provisional. */
export function nextFrameNumber(args: { spoken?: number | null; highestNoted: number | null; format: string }): { frameNumber: number | null; provisional: boolean } {
  if (args.spoken != null) return { frameNumber: args.spoken, provisional: false };
  if (SHEET_FORMATS.includes(args.format)) return { frameNumber: null, provisional: false };
  return { frameNumber: (args.highestNoted ?? 0) + 1, provisional: true };
}
```

`packages/shared/src/field-event.ts`:

```ts
import type { FrameFields } from "./capture.js";

export const SHEET_FORMATS = ["4x5", "8x10"];

type Nullable<T> = T | null | undefined;
export interface FieldEventLike {
  capturedAt: string | Date;
  latitude?: Nullable<number | string>;
  longitude?: Nullable<number | string>;
  lensId?: Nullable<string>;
  shutterSpeed?: Nullable<string>;
  aperture?: Nullable<string>;
  compensation?: Nullable<string>;
  meteringMode?: Nullable<string>;
  subject?: Nullable<string>;
  locationName?: Nullable<string>;
}

function num(v: Nullable<number | string>): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** What a pinned event contributes to its frame. `notes` stays null: the transcript goes to a note row, not the frame. */
export function eventToFrame(e: FieldEventLike, frameNumber: number): FrameFields {
  const at = e.capturedAt instanceof Date ? e.capturedAt : new Date(e.capturedAt);
  return {
    frameNumber,
    lensId: e.lensId ?? null,
    shutterSpeed: e.shutterSpeed ?? null,
    aperture: e.aperture ?? null,
    compensation: e.compensation ?? null,
    meteringMode: e.meteringMode ?? null,
    subject: e.subject ?? null,
    locationName: e.locationName ?? null,
    notes: null,
    latitude: num(e.latitude),
    longitude: num(e.longitude),
    shotAt: at.toISOString(),
  };
}
```

(`FrameFields` is exported by V1's `capture.ts`; Task 8 moves that interface into `field-event.ts` when `capture.ts` is deleted.)

`packages/shared/src/index.ts`: add `export * from "./field-merge.js"; export * from "./frame-numbering.js"; export * from "./field-event.js";`

- [ ] **Step 6: Run tests, coverage, build; commit**

Run: `npm run test:coverage && npm run build:shared`
Expected: PASS, thresholds hold.

```bash
git add packages/shared
git commit -m "feat(shared): field-event types, merge rules, provisional frame numbering, event->frame" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01Q6jMVz9nSKsnyFxZP939Xi"
```

---

### Task 3: `field_events` table, config, deps, copy script

**Files:**
- Modify: `packages/server/src/db/schema.ts` (append after `captures`)
- Modify: `packages/server/src/config.ts`
- Create: `packages/server/scripts/migrate-captures-to-field-events.ts`
- Modify: `packages/server/package.json` (dep `@anthropic-ai/sdk`, script `migrate:field-events`)

**Interfaces:**
- Produces: Drizzle table `fieldEvents`; `config.ANTHROPIC_API_KEY?: string`, `config.FIELD_PARSE_MODEL: string`; `npm run -w packages/server migrate:field-events`.

- [ ] **Step 1: Table** — append to `schema.ts`:

```ts
// ── Field events (V2 stream) ──
//
// One row per thing captured in the field. `voice` rows carry the verbatim
// transcript (immutable) plus parsed fields; `photo` rows carry a file. Pinning
// (POST /field-events/:id/pin) turns an event into a frame + note; roll-level
// attaches it to the roll as a note. `client_id` is minted on the phone so sync
// is idempotent.

export const fieldEvents = pgTable(
  "field_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id").notNull(),
    userId: uuid("user_id").notNull().references(() => users.id),
    kind: text("kind").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    latitude: numeric("latitude", { precision: 10, scale: 7 }),
    longitude: numeric("longitude", { precision: 10, scale: 7 }),
    rollId: uuid("roll_id").references(() => rolls.id, { onDelete: "set null" }),
    cameraId: uuid("camera_id").references(() => cameras.id),
    frameNumber: integer("frame_number"),
    frameProvisional: boolean("frame_provisional").notNull().default(false),
    sheetId: text("sheet_id"),
    transcript: text("transcript"),
    fileKey: text("file_key"),
    fileUrl: text("file_url"),
    mimeType: text("mime_type"),
    fileSizeBytes: integer("file_size_bytes"),
    widthPx: integer("width_px"),
    heightPx: integer("height_px"),
    photoAssetId: text("photo_asset_id"),
    shutterSpeed: text("shutter_speed"),
    aperture: text("aperture"),
    compensation: text("compensation"),
    meteringMode: text("metering_mode"),
    lensId: uuid("lens_id").references(() => lenses.id),
    subject: text("subject"),
    locationName: text("location_name"),
    remarks: text("remarks"),
    sceneDescription: text("scene_description"),
    parsedAt: timestamp("parsed_at", { withTimezone: true }),
    parser: text("parser"),
    parseNotes: text("parse_notes"),
    editedFields: text("edited_fields").array().notNull().default([]),
    review: boolean("review").notNull().default(false),
    status: text("status").notNull().default("pending"),
    frameId: uuid("frame_id").references(() => frames.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("field_events_client_id_unique").on(t.clientId),
    index("field_events_user_captured_idx").on(t.userId, t.capturedAt),
    index("field_events_roll_status_idx").on(t.rollId, t.status),
  ]
);
```

Add `index` to the `drizzle-orm/pg-core` import if not present.

- [ ] **Step 2: Config** — in `config.ts` add:

```ts
  /** Enables tier-2 (Claude) parsing of field events. Unset → tier 2 skipped. */
  ANTHROPIC_API_KEY: z.string().optional(),
  FIELD_PARSE_MODEL: z.string().default("claude-haiku-4-5"),
```

- [ ] **Step 3: Dependency + script**

Run: `npm install -w packages/server @anthropic-ai/sdk@latest`
Add to `packages/server/package.json` scripts: `"migrate:field-events": "tsx --env-file-if-exists=../../.env scripts/migrate-captures-to-field-events.ts"`.

- [ ] **Step 4: Copy script** — `packages/server/scripts/migrate-captures-to-field-events.ts`:

```ts
/**
 * One-shot: copy V1 `captures` into `field_events`. Idempotent (skips captures whose
 * id already appears as a field_events.client_id). A capture with a photo also
 * spawns a `photo` event carrying the file. Run with DATABASE_URL set.
 *
 *   npm run -w packages/server migrate:field-events            # copy
 *   npm run -w packages/server migrate:field-events -- --check # counts only
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db/client.js";
import { captures, fieldEvents } from "../src/db/schema.js";

const check = process.argv.includes("--check");

async function main() {
  const rows = await db.select().from(captures);
  const existing = new Set((await db.select({ c: fieldEvents.clientId }).from(fieldEvents)).map((r) => r.c));
  let voice = 0, photo = 0, skipped = 0;
  for (const c of rows) {
    if (existing.has(c.id)) { skipped++; continue; }
    if (check) { voice++; if (c.fileKey) photo++; continue; }
    await db.transaction(async (tx) => {
      const hasSettings = !!(c.shutterSpeed || c.aperture || c.compensation || c.meteringMode);
      await tx.insert(fieldEvents).values({
        clientId: c.id,
        userId: c.userId,
        kind: "voice",
        capturedAt: c.capturedAt,
        latitude: c.latitude,
        longitude: c.longitude,
        rollId: c.rollId,
        cameraId: c.cameraId,
        frameNumber: c.frameNumber,
        frameProvisional: false,
        transcript: [c.subject, c.notes].filter(Boolean).join("\n") || null,
        shutterSpeed: c.shutterSpeed,
        aperture: c.aperture,
        compensation: c.compensation,
        meteringMode: c.meteringMode,
        lensId: c.lensId,
        subject: c.subject,
        locationName: c.locationName,
        remarks: c.notes,
        sceneDescription: c.sceneDescription,
        parsedAt: hasSettings ? c.createdAt : null,
        parser: hasSettings ? "claude-app" : null,
        status: c.status === "assigned" ? "pinned" : "pending",
        frameId: c.frameId,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      });
      voice++;
      if (c.fileKey) {
        await tx.insert(fieldEvents).values({
          clientId: randomUUID(),
          userId: c.userId,
          kind: "photo",
          capturedAt: c.photoTakenAt ?? c.capturedAt,
          latitude: c.latitude,
          longitude: c.longitude,
          rollId: c.rollId,
          cameraId: c.cameraId,
          fileKey: c.fileKey,
          fileUrl: c.fileUrl,
          mimeType: c.mimeType,
          fileSizeBytes: c.fileSizeBytes,
          widthPx: c.widthPx,
          heightPx: c.heightPx,
          photoAssetId: c.photoAssetId,
          status: c.status === "assigned" ? "pinned" : "pending",
          frameId: c.frameId,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        });
        photo++;
      }
    });
  }
  const [{ n }] = await db.select({ n: sql<number>`count(*)` }).from(fieldEvents);
  console.log(`${check ? "would copy" : "copied"} ${voice} voice + ${photo} photo events (${skipped} already present); field_events now ${n} rows`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
```

Note: V1 photo files stay at `uploads/captures/<id>.jpg`; the `photo` event keeps the V1 `fileKey`. New uploads go to `uploads/events/`. Both are under `UPLOADS_DIR` and served by the same static/nginx location.

- [ ] **Step 5: Snapshot, push, copy, verify**

```bash
pg_dump --host=localhost --username=filmlog --dbname=filmlog --clean --if-exists --no-owner --no-privileges > db-backups/pre-field-events-$(date +%Y%m%d-%H%M%S).sql
npm run -w packages/server db:push
npm run -w packages/server migrate:field-events -- --check
npm run -w packages/server migrate:field-events
psql postgres://filmlog:filmlog@localhost:5432/filmlog -c "select kind, status, count(*) from field_events group by 1,2"
```

Expected: table created, no prompts; the dev DB holds one V1 capture (C1, pinned, with photo) → 1 voice + 1 photo event, both `pinned`. Rerun the copy → "0 copied (1 already present)".

- [ ] **Step 6: Build and commit**

```bash
npm run build -w packages/server
git add packages/server db-backups/pre-field-events-*.sql package-lock.json
git commit -m "feat(server): field_events table, tier-2 config, captures copy script" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01Q6jMVz9nSKsnyFxZP939Xi"
```

---

### Task 4: `/field-events` create (idempotent), list, get, patch, delete, photo

**Files:**
- Create: `packages/server/src/routes/field-events.ts`
- Modify: `packages/server/src/index.ts`

**Interfaces:**
- Consumes: shared schemas from Task 2, `parseTranscript`, `nextFrameNumber`; `fieldEvents` table.
- Produces: `POST /api/v1/field-events` (201 new, 200 existing by `clientId`), `GET /` with filters `status|kind|roll_id|since|review|client_ids|limit`, `GET /:id`, `PATCH /:id`, `DELETE /:id`, `POST /:id/photo`. Exports `findEvent(userId, handle)`, `presentEvent(row)`, `eventFilePath(id)`, `highestNotedFrame(rollId)` for Tasks 5–6. Also exports `ROUTE_PREFIX = "/api/v1/field-events"`.

- [ ] **Step 1: Write the route file**

```ts
import multipart from "@fastify/multipart";
import { and, desc, eq, gte, inArray, max, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { imageSize } from "image-size";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createFieldEventSchema,
  fieldEventPhotoMetaSchema,
  nextFrameNumber,
  parseTranscript,
  updateFieldEventSchema,
} from "@tomu/shared";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { cameras, fieldEvents, frames, lenses, rolls } from "../db/schema.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type FieldEventRow = typeof fieldEvents.$inferSelect;

export function presentEvent(row: FieldEventRow) {
  return { ...row, shortId: row.id.slice(0, 8) };
}

/** uuid, uuid prefix (≥ 8 chars), or clientId. */
export async function findEvent(userId: string, handle: string): Promise<FieldEventRow | undefined> {
  const h = handle.trim().toLowerCase();
  if (UUID_RE.test(h)) {
    const [row] = await db.select().from(fieldEvents)
      .where(and(eq(fieldEvents.userId, userId), sql`(${fieldEvents.id} = ${h} or ${fieldEvents.clientId} = ${h})`)).limit(1);
    return row;
  }
  if (/^[0-9a-f]{8,}$/.test(h)) {
    const rows = await db.select().from(fieldEvents)
      .where(and(eq(fieldEvents.userId, userId), sql`${fieldEvents.id}::text like ${h + "%"}`)).limit(2);
    return rows.length === 1 ? rows[0] : undefined;
  }
  return undefined;
}

export function eventFilePath(eventId: string): { key: string; url: string; abs: string } {
  const key = `events/${eventId}.jpg`;
  return { key, url: `/uploads/${key}`, abs: join(config.UPLOADS_DIR, key) };
}

async function userOwnsRoll(userId: string, rollId: string): Promise<{ id: string; format: string; status: string } | null> {
  const [roll] = await db.select({ id: rolls.id, format: rolls.format, status: rolls.status }).from(rolls)
    .where(and(eq(rolls.id, rollId), eq(rolls.userId, userId))).limit(1);
  return roll ?? null;
}

/** Highest frame number noted on a roll across frames and events (pending or pinned). */
export async function highestNotedFrame(rollId: string): Promise<number | null> {
  const [f] = await db.select({ m: max(frames.frameNumber) }).from(frames).where(eq(frames.rollId, rollId));
  const [e] = await db.select({ m: max(fieldEvents.frameNumber) }).from(fieldEvents).where(eq(fieldEvents.rollId, rollId));
  const vals = [f?.m, e?.m].filter((x): x is number => x != null);
  return vals.length ? Math.max(...vals) : null;
}

/** Gear index for tier-1 parsing on the server (Claude-app path sends no parsed fields). */
async function gearIndex(userId: string) {
  const [cams, lens] = await Promise.all([
    db.select({ id: cameras.id, make: cameras.make, model: cameras.model }).from(cameras).where(eq(cameras.userId, userId)),
    db.select({ id: lenses.id, make: lenses.make, model: lenses.model, focalLengthMm: lenses.focalLengthMm }).from(lenses).where(eq(lenses.userId, userId)),
  ]);
  return {
    cameras: cams.map((c) => ({ id: c.id, label: `${c.make} ${c.model}` })),
    lenses: lens.map((l) => ({ id: l.id, label: `${l.make} ${l.model} ${l.focalLengthMm ?? ""}mm` })),
  };
}

export async function fieldEventsRoutes(fastify: FastifyInstance) {
  await fastify.register(multipart, { limits: { fileSize: 25 * 1024 * 1024, files: 1 } });
  await mkdir(join(config.UPLOADS_DIR, "events"), { recursive: true });

  // ── Create (idempotent on clientId) ─────────────────────────────────
  fastify.post("/", async (request, reply) => {
    const body = createFieldEventSchema.parse(request.body);
    const [dup] = await db.select().from(fieldEvents)
      .where(and(eq(fieldEvents.userId, request.userId), eq(fieldEvents.clientId, body.clientId))).limit(1);
    if (dup) return reply.status(200).send({ data: presentEvent(dup) });

    let roll: { id: string; format: string; status: string } | null = null;
    if (body.rollId) {
      roll = await userOwnsRoll(request.userId, body.rollId);
      if (!roll) return reply.status(404).send({ error: "Roll not found" });
    }

    // Tier 1 on the server when the client sent none (Claude-app path / curl).
    let parsed = { shutterSpeed: body.shutterSpeed, aperture: body.aperture, compensation: body.compensation, meteringMode: body.meteringMode, lensId: body.lensId, subject: body.subject, locationName: body.locationName };
    let cameraId = body.cameraId ?? null;
    let spokenFrame = body.frameNumber ?? null;
    let sheetId = body.sheetId ?? null;
    let parser: string | null = body.parser ?? null;
    if (body.kind === "voice" && body.transcript && !body.parser) {
      const r = parseTranscript(body.transcript, await gearIndex(request.userId));
      parsed = {
        shutterSpeed: parsed.shutterSpeed ?? r.fields.shutterSpeed, aperture: parsed.aperture ?? r.fields.aperture,
        compensation: parsed.compensation ?? r.fields.compensation, meteringMode: parsed.meteringMode ?? r.fields.meteringMode,
        lensId: parsed.lensId ?? r.fields.lensId, subject: parsed.subject, locationName: parsed.locationName,
      };
      cameraId = cameraId ?? r.fields.cameraId ?? null;
      spokenFrame = spokenFrame ?? r.fields.frameNumber ?? null;
      sheetId = sheetId ?? r.fields.sheetId ?? null;
      if (Object.keys(r.fields).length) parser = "regex";
    }
    // Camera without a roll → the camera's active roll, if exactly one.
    if (!roll && cameraId) {
      const active = await db.select({ id: rolls.id, format: rolls.format, status: rolls.status }).from(rolls)
        .where(and(eq(rolls.userId, request.userId), eq(rolls.cameraId, cameraId), inArray(rolls.status, ["loaded", "shooting"])));
      if (active.length === 1) roll = active[0];
    }
    let frameNumber: number | null = null, provisional = false;
    if (body.kind === "voice" && roll) {
      const n = nextFrameNumber({ spoken: spokenFrame, highestNoted: await highestNotedFrame(roll.id), format: roll.format });
      frameNumber = n.frameNumber; provisional = n.provisional;
    } else if (spokenFrame != null) {
      frameNumber = spokenFrame;
    }

    const [row] = await db.insert(fieldEvents).values({
      clientId: body.clientId,
      userId: request.userId,
      kind: body.kind,
      capturedAt: body.capturedAt ? new Date(body.capturedAt) : new Date(),
      latitude: body.latitude != null ? String(body.latitude) : null,
      longitude: body.longitude != null ? String(body.longitude) : null,
      rollId: roll?.id ?? null,
      cameraId,
      frameNumber,
      frameProvisional: provisional,
      sheetId,
      transcript: body.kind === "voice" ? (body.transcript ?? null) : null,
      shutterSpeed: parsed.shutterSpeed ?? null,
      aperture: parsed.aperture ?? null,
      compensation: parsed.compensation ?? null,
      meteringMode: parsed.meteringMode ?? null,
      lensId: parsed.lensId ?? null,
      subject: parsed.subject ?? null,
      locationName: parsed.locationName ?? null,
      parser,
      parsedAt: parser ? new Date() : null,
      editedFields: body.editedFields ?? [],
    }).returning();
    return reply.status(201).send({ data: presentEvent(row) });
  });

  // ── List ────────────────────────────────────────────────────────────
  fastify.get<{ Querystring: { status?: string; kind?: string; roll_id?: string; since?: string; review?: string; client_ids?: string; limit?: string } }>("/", async (request, reply) => {
    const q = request.query;
    const conds = [eq(fieldEvents.userId, request.userId)];
    const status = q.status ?? "pending";
    if (status !== "all") {
      if (!["pending", "pinned", "roll_level"].includes(status)) return reply.status(400).send({ error: `Invalid status: ${status}` });
      conds.push(eq(fieldEvents.status, status));
    }
    if (q.kind) {
      if (!["voice", "photo"].includes(q.kind)) return reply.status(400).send({ error: `Invalid kind: ${q.kind}` });
      conds.push(eq(fieldEvents.kind, q.kind));
    }
    if (q.roll_id) {
      if (!UUID_RE.test(q.roll_id)) return reply.status(400).send({ error: `Invalid roll_id: ${q.roll_id}` });
      conds.push(eq(fieldEvents.rollId, q.roll_id));
    }
    if (q.since) {
      const d = new Date(q.since);
      if (Number.isNaN(d.getTime())) return reply.status(400).send({ error: `Invalid since: ${q.since}` });
      conds.push(gte(fieldEvents.capturedAt, d));
    }
    if (q.review === "true") conds.push(eq(fieldEvents.review, true));
    if (q.client_ids) {
      const ids = q.client_ids.split(",").map((s) => s.trim()).filter((s) => UUID_RE.test(s));
      if (!ids.length) return reply.status(400).send({ error: "client_ids must be uuids" });
      conds.push(inArray(fieldEvents.clientId, ids));
    }
    const limit = Math.min(Math.max(Number(q.limit ?? 100) || 100, 1), 500);
    const rows = await db.select().from(fieldEvents).where(and(...conds)).orderBy(desc(fieldEvents.capturedAt)).limit(limit);
    return { data: rows.map(presentEvent) };
  });

  // ── Get one ─────────────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const row = await findEvent(request.userId, request.params.id);
    if (!row) return reply.status(404).send({ error: "Event not found" });
    return { data: presentEvent(row) };
  });

  // ── Patch (transcript immutable; edited fields recorded) ────────────
  fastify.patch<{ Params: { id: string } }>("/:id", async (request, reply) => {
    if (request.body && typeof request.body === "object" && "transcript" in (request.body as object)) {
      return reply.status(400).send({ error: "transcript is immutable" });
    }
    const row = await findEvent(request.userId, request.params.id);
    if (!row) return reply.status(404).send({ error: "Event not found" });
    const body = updateFieldEventSchema.parse(request.body);
    if (body.rollId && !(await userOwnsRoll(request.userId, body.rollId))) return reply.status(404).send({ error: "Roll not found" });
    const set: Partial<typeof fieldEvents.$inferInsert> = { updatedAt: new Date() };
    const edited = new Set(row.editedFields);
    for (const k of ["shutterSpeed", "aperture", "compensation", "meteringMode", "lensId", "subject", "locationName"] as const) {
      if (body[k] !== undefined) { set[k] = body[k]; edited.add(k); }
    }
    for (const k of ["rollId", "cameraId", "sheetId", "remarks", "sceneDescription", "review"] as const) {
      if (body[k] !== undefined) (set as Record<string, unknown>)[k] = body[k];
    }
    if (body.frameNumber !== undefined) { set.frameNumber = body.frameNumber; set.frameProvisional = false; }
    if (body.capturedAt !== undefined) set.capturedAt = new Date(body.capturedAt);
    set.editedFields = [...edited];
    const [updated] = await db.update(fieldEvents).set(set).where(eq(fieldEvents.id, row.id)).returning();
    return { data: presentEvent(updated) };
  });

  // ── Photo upload (PWA or photos:sync) ───────────────────────────────
  fastify.post<{ Params: { id: string } }>("/:id/photo", async (request, reply) => {
    const row = await findEvent(request.userId, request.params.id);
    if (!row) return reply.status(404).send({ error: "Event not found" });
    if (row.kind !== "photo") return reply.status(400).send({ error: "Only photo events take a file" });
    const fields: Record<string, string> = {};
    let fileBuf: Buffer | undefined;
    let mime: string | undefined;
    try {
      for await (const part of request.parts()) {
        if (part.type === "file") {
          if (part.fieldname !== "file") { await part.toBuffer(); continue; }
          mime = part.mimetype;
          fileBuf = await part.toBuffer();
        } else {
          fields[part.fieldname] = String(part.value);
        }
      }
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "FST_REQ_FILE_TOO_LARGE") return reply.status(413).send({ error: "Photo exceeds 25 MB" });
      if (code === "FST_FILES_LIMIT") return reply.status(400).send({ error: "Send exactly one file part named 'file'" });
      throw err;
    }
    if (!fileBuf) return reply.status(400).send({ error: "Missing multipart field 'file'" });
    if (mime !== "image/jpeg") return reply.status(415).send({ error: `Only image/jpeg accepted, got ${mime}` });
    const meta = fieldEventPhotoMetaSchema.parse(fields);
    let dims: { width?: number; height?: number } = {};
    try { dims = imageSize(fileBuf); } catch { /* not fatal */ }
    const { key, url, abs } = eventFilePath(row.id);
    await writeFile(abs, fileBuf);
    const [updated] = await db.update(fieldEvents).set({
      fileKey: key, fileUrl: url, mimeType: mime, fileSizeBytes: fileBuf.length,
      widthPx: dims.width ?? null, heightPx: dims.height ?? null,
      capturedAt: meta.photoTakenAt ? new Date(meta.photoTakenAt) : row.capturedAt,
      latitude: meta.latitude != null ? String(meta.latitude) : row.latitude,
      longitude: meta.longitude != null ? String(meta.longitude) : row.longitude,
      photoAssetId: meta.photoAssetId ?? row.photoAssetId,
      updatedAt: new Date(),
    }).where(eq(fieldEvents.id, row.id)).returning();
    return { data: presentEvent(updated) };
  });

  // ── Delete ──────────────────────────────────────────────────────────
  fastify.delete<{ Params: { id: string }; Querystring: { force?: string } }>("/:id", async (request, reply) => {
    const row = await findEvent(request.userId, request.params.id);
    if (!row) return reply.status(404).send({ error: "Event not found" });
    if (row.status !== "pending" && request.query.force !== "true") {
      return reply.status(409).send({ error: `Event is ${row.status}; pass ?force=true to delete the event record (the frame/note and photo file stay).` });
    }
    await db.delete(fieldEvents).where(eq(fieldEvents.id, row.id));
    if (row.fileKey && row.status === "pending") await rm(join(config.UPLOADS_DIR, row.fileKey), { force: true });
    return reply.status(204).send();
  });
}
```

- [ ] **Step 2: Register** in `index.ts`: `import { fieldEventsRoutes } from "./routes/field-events.js";` and `await fastify.register(fieldEventsRoutes, { prefix: "/api/v1/field-events" });` after the captures line.

- [ ] **Step 3: Smoke test** (start `npm run dev:server` in background; `$TOKEN` from `claude mcp get tomu-dev`; `$ROLL` = an active 35mm roll id from `GET /rolls?status=active`):

```bash
CID=$(uuidgen | tr A-Z a-z)
curl -s localhost:3456/api/v1/field-events -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d "{\"clientId\":\"$CID\",\"kind\":\"voice\",\"rollId\":\"$ROLL\",\"transcript\":\"kitchen window again, two fifty at f eight, plus one, spot\"}" | jq '.data | {status: .status, frameNumber, frameProvisional, shutterSpeed, aperture, compensation, meteringMode, parser}'
# again with the same clientId → 200, same row
curl -s -o /dev/null -w '%{http_code}\n' localhost:3456/api/v1/field-events -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "{\"clientId\":\"$CID\",\"kind\":\"voice\",\"transcript\":\"x\"}"
curl -s "localhost:3456/api/v1/field-events?client_ids=$CID" -H "Authorization: Bearer $TOKEN" | jq '.data | length'
ID=$(curl -s "localhost:3456/api/v1/field-events?client_ids=$CID" -H "Authorization: Bearer $TOKEN" | jq -r '.data[0].id')
curl -s -X PATCH localhost:3456/api/v1/field-events/$ID -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"aperture":"f/11"}' | jq '.data | {aperture, editedFields}'
curl -s -o /dev/null -w '%{http_code}\n' -X PATCH localhost:3456/api/v1/field-events/$ID -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"transcript":"nope"}'
PID=$(uuidgen | tr A-Z a-z); PH=$(curl -s localhost:3456/api/v1/field-events -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "{\"clientId\":\"$PID\",\"kind\":\"photo\"}" | jq -r .data.id)
sips -s format jpeg docs/screenshots/rolls.png --out /tmp/x.jpg >/dev/null; curl -s localhost:3456/api/v1/field-events/$PH/photo -H "Authorization: Bearer $TOKEN" -F file=@/tmp/x.jpg -F photoTakenAt=2026-09-06T22:44:29Z -F latitude=47.75 -F longitude=-122.65 | jq '.data | {fileUrl, widthPx, capturedAt}'
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE localhost:3456/api/v1/field-events/$ID -H "Authorization: Bearer $TOKEN"
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE localhost:3456/api/v1/field-events/$PH -H "Authorization: Bearer $TOKEN"; ls uploads/events | wc -l
```

Expected: 201 with `frameProvisional: true`, `shutterSpeed "1/250"`, `aperture "f/8"`, `compensation "+1"`, `meteringMode "spot"`, `parser "regex"`; then 200; `1`; `{aperture:"f/11", editedFields:["aperture"]}`; `400`; photo JSON with `fileUrl` under `/uploads/events/` and `capturedAt` = the given time; `204`, `204`, `0`. Kill the server.

- [ ] **Step 4: Build, test, commit**

```bash
npm run build -w packages/server && npm test
git add packages/server/src/routes/field-events.ts packages/server/src/index.ts
git commit -m "feat(server): /field-events create (idempotent), list, get, patch, delete, photo" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01Q6jMVz9nSKsnyFxZP939Xi"
```

---

### Task 5: Pin, roll-level, and `unpinnedEvents` on roll detail

**Files:**
- Modify: `packages/server/src/routes/field-events.ts`
- Modify: `packages/server/src/routes/rolls.ts` (`GET /:id`)

**Interfaces:**
- Consumes: `eventToFrame`, `pinFieldEventSchema`, `rollLevelFieldEventSchema`; `findEvent`, `presentEvent`.
- Produces: `POST /field-events/:id/pin`, `POST /field-events/:id/roll-level`; `GET /rolls/:id` → `unpinnedEvents: FieldEvent[]` (status pending, oldest first).

- [ ] **Step 1: Add the two routes** inside `fieldEventsRoutes`, after the photo route. Extra imports: `eventToFrame, pinFieldEventSchema, rollLevelFieldEventSchema` from `@tomu/shared`; `notes` from the schema.

```ts
  // ── Pin: event becomes (or joins) a frame ───────────────────────────
  fastify.post<{ Params: { id: string } }>("/:id/pin", async (request, reply) => {
    const row = await findEvent(request.userId, request.params.id);
    if (!row) return reply.status(404).send({ error: "Event not found" });
    if (row.status !== "pending") return reply.status(409).send({ error: `Event is already ${row.status}` });
    const body = pinFieldEventSchema.parse(request.body);
    const rollId = body.rollId ?? row.rollId;
    if (!rollId) return reply.status(400).send({ error: "Event is not linked to a roll; pass rollId" });
    const roll = await userOwnsRoll(request.userId, rollId);
    if (!roll) return reply.status(404).send({ error: "Roll not found" });

    const [existing] = await db.select().from(frames)
      .where(and(eq(frames.rollId, roll.id), eq(frames.frameNumber, body.frameNumber))).limit(1);

    const result = await db.transaction(async (tx) => {
      let frame = existing;
      if (!frame) {
        const f = eventToFrame(row, body.frameNumber);
        [frame] = await tx.insert(frames).values({
          rollId: roll.id, frameNumber: f.frameNumber, lensId: f.lensId, shutterSpeed: f.shutterSpeed, aperture: f.aperture,
          compensation: f.compensation, meteringMode: f.meteringMode, subject: f.subject, notes: null,
          latitude: f.latitude != null ? String(f.latitude) : null, longitude: f.longitude != null ? String(f.longitude) : null,
          locationName: f.locationName, shotAt: new Date(f.shotAt), tags: [],
        }).returning();
      } else if (row.kind === "voice") {
        // Joining an existing frame (e.g. a photo pinned after the voice note, or two notes on one frame):
        // fill only empty frame fields; never overwrite what is there.
        const f = eventToFrame(row, body.frameNumber);
        const fill: Partial<typeof frames.$inferInsert> = {};
        for (const k of ["lensId", "shutterSpeed", "aperture", "compensation", "meteringMode", "subject", "locationName"] as const) {
          if (frame[k] == null && f[k] != null) (fill as Record<string, unknown>)[k] = f[k];
        }
        if (Object.keys(fill).length) [frame] = await tx.update(frames).set({ ...fill, updatedAt: new Date() }).where(eq(frames.id, frame.id)).returning();
      }
      if (row.kind === "voice" && row.transcript) {
        await tx.insert(notes).values({ userId: request.userId, frameId: frame.id, type: "text", content: row.transcript, latitude: row.latitude, longitude: row.longitude });
      }
      if (row.kind === "photo" && row.fileKey) {
        await tx.insert(notes).values({
          userId: request.userId, frameId: frame.id, type: "photo", content: row.sceneDescription ?? null,
          fileKey: row.fileKey, fileUrl: row.fileUrl, mimeType: row.mimeType, fileSizeBytes: row.fileSizeBytes, latitude: row.latitude, longitude: row.longitude,
        });
      }
      if (roll.status === "loaded") await tx.update(rolls).set({ status: "shooting", updatedAt: new Date() }).where(eq(rolls.id, roll.id));
      const [ev] = await tx.update(fieldEvents)
        .set({ status: "pinned", rollId: roll.id, frameNumber: body.frameNumber, frameProvisional: false, frameId: frame.id, updatedAt: new Date() })
        .where(eq(fieldEvents.id, row.id)).returning();
      return { event: presentEvent(ev), frame, joined: !!existing };
    });
    return reply.status(201).send({ data: result });
  });

  // ── Roll-level: attach as a roll note, no frame ─────────────────────
  fastify.post<{ Params: { id: string } }>("/:id/roll-level", async (request, reply) => {
    const row = await findEvent(request.userId, request.params.id);
    if (!row) return reply.status(404).send({ error: "Event not found" });
    if (row.status !== "pending") return reply.status(409).send({ error: `Event is already ${row.status}` });
    const body = rollLevelFieldEventSchema.parse(request.body ?? {});
    const rollId = body.rollId ?? row.rollId;
    if (!rollId) return reply.status(400).send({ error: "Event is not linked to a roll; pass rollId" });
    const roll = await userOwnsRoll(request.userId, rollId);
    if (!roll) return reply.status(404).send({ error: "Roll not found" });
    const result = await db.transaction(async (tx) => {
      await tx.insert(notes).values({
        userId: request.userId, rollId: roll.id,
        type: row.kind === "photo" ? "photo" : "text",
        content: row.kind === "photo" ? row.sceneDescription ?? null : row.transcript ?? null,
        fileKey: row.fileKey, fileUrl: row.fileUrl, mimeType: row.mimeType, fileSizeBytes: row.fileSizeBytes,
        latitude: row.latitude, longitude: row.longitude,
      });
      const [ev] = await tx.update(fieldEvents).set({ status: "roll_level", rollId: roll.id, updatedAt: new Date() }).where(eq(fieldEvents.id, row.id)).returning();
      return { event: presentEvent(ev) };
    });
    return reply.status(201).send({ data: result });
  });
```

- [ ] **Step 2: `unpinnedEvents` on roll detail** — in `rolls.ts` `GET /:id`, add `fieldEvents` to the schema import and a fourth query in the `Promise.all`:

```ts
      db.select().from(fieldEvents)
        .where(and(eq(fieldEvents.rollId, roll.id), eq(fieldEvents.status, "pending"), eq(fieldEvents.userId, request.userId)))
        .orderBy(asc(fieldEvents.capturedAt)),
```

and in the response: `unpinnedEvents: unpinnedEvents.map((e) => ({ ...e, shortId: e.id.slice(0, 8) })),`. Leave `pendingCaptures` in place for now (removed in Task 8).

- [ ] **Step 3: Smoke test** (server running; `$ROLL` an active roll; create a voice event with transcript as in Task 4 and a photo event with a file):

```bash
curl -s localhost:3456/api/v1/field-events/$ID/pin -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"frameNumber":99}' | jq '.data | {s: .event.status, f: .frame.frameNumber, joined}'
curl -s localhost:3456/api/v1/field-events/$PH/pin -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "{\"rollId\":\"$ROLL\",\"frameNumber\":99}" | jq '.data | {s: .event.status, joined}'
curl -s "localhost:3456/api/v1/rolls/$ROLL" -H "Authorization: Bearer $TOKEN" | jq '{frames: [.data.frames[] | select(.frameNumber==99) | {shutterSpeed, subject}], notes: [.data.frameNotes[] | {type, content: (.content|.[0:30]), fileUrl}], unpinned: (.data.unpinnedEvents|length)}'
curl -s -o /dev/null -w '%{http_code}\n' localhost:3456/api/v1/field-events/$ID/pin -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"frameNumber":98}'
```

Expected: `{s:"pinned", f:99, joined:false}`; `{s:"pinned", joined:true}`; frame 99 with settings, two notes (text with the transcript, photo with `fileUrl`), `unpinned: 0`; `409`. Clean up via psql: delete notes for frame 99, the frame, the two events (`?force=true`), and the file under `uploads/events/`; confirm empty.

- [ ] **Step 4: Build, test, commit**

```bash
npm run build -w packages/server && npm test
git add packages/server/src/routes/field-events.ts packages/server/src/routes/rolls.ts
git commit -m "feat(server): pin / roll-level field events; unpinnedEvents on roll detail" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01Q6jMVz9nSKsnyFxZP939Xi"
```

---

### Task 6: Tier-2 model parse service, reparse route, retry sweep

**Files:**
- Create: `packages/server/src/services/field-parse-model.ts`
- Create: `packages/server/src/services/field-parse-prompt.md`
- Modify: `packages/server/src/routes/field-events.ts` (hook on create; `POST /reparse`)
- Modify: `packages/server/src/index.ts` (sweep timer)

**Interfaces:**
- Consumes: `mergeParse`, `Tier2Result`, `PARSED_FIELD_NAMES` from shared; `config.ANTHROPIC_API_KEY`, `config.FIELD_PARSE_MODEL`.
- Produces: `parseEventWithModel(eventId): Promise<{ skipped: boolean; changed: string[] }>`, `sweepUnparsed(limit = 20): Promise<number>`; `POST /field-events/reparse`.

- [ ] **Step 1: Prompt file** — `packages/server/src/services/field-parse-prompt.md`:

```markdown
You extract structured exposure data from a film photographer's spoken field note.
The note is a verbatim dictation and may ramble; most of it is not about settings.
Never invent values. If a field is not clearly stated, leave it null.

Return, for each field, the value and a confidence 0–1:
- shutterSpeed: "1/250", "2s", "B". Spoken forms: "two fifty" = 1/250, "a sixtieth" = 1/60.
- aperture: "f/8", "f/5.6". Spoken forms: "five six" = f/5.6, "at eight" = f/8.
- compensation: "+1", "-1/3", "+1.5".
- meteringMode: one of incident, spot, average, center, "sunny 16", guess.
- lensId: pick from the lens list only if the note names it (focal length or model); else null.
- subject: a short noun phrase for what was photographed (not the camera settings).
- locationName: a place name if one is spoken.
Also return:
- cameraId: from the camera list if named, else null.
- remarks: sentences worth keeping as notes that are not settings (light, mood, sound, ideas). Verbatim phrases, not paraphrase.
- sceneDescription: if a photo is attached, two sentences describing it; else null.
- reviewReason: a short reason if something was ambiguous or contradictory (e.g. two apertures spoken), else null.
```

- [ ] **Step 2: Service** — `packages/server/src/services/field-parse-model.ts`:

```ts
/**
 * Tier-2 parse: Claude reads the transcript (+ a nearby photo) and fills what the
 * regex could not. Never modifies the transcript; never overwrites hand-edited
 * fields; a failure leaves the event untouched (retried by the sweep).
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { mergeParse, PARSED_FIELD_NAMES, type Tier2Result } from "@tomu/shared";
import { config } from "../config.js";
import { db } from "../db/client.js";
import { cameras, fieldEvents, lenses, rolls } from "../db/schema.js";

const Field = z.object({ value: z.string().nullable(), confidence: z.number().min(0).max(1) });
const Output = z.object({
  shutterSpeed: Field, aperture: Field, compensation: Field, meteringMode: Field,
  lensId: Field, subject: Field, locationName: Field,
  cameraId: z.string().nullable(),
  remarks: z.string().nullable(),
  sceneDescription: z.string().nullable(),
  reviewReason: z.string().nullable(),
});

let promptCache: string | null = null;
async function prompt(): Promise<string> {
  if (!promptCache) promptCache = await readFile(join(config.UPLOADS_DIR, "..", "packages", "server", "src", "services", "field-parse-prompt.md"), "utf8").catch(async () => readFile(new URL("./field-parse-prompt.md", import.meta.url), "utf8"));
  return promptCache;
}

const client = config.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: config.ANTHROPIC_API_KEY }) : null;

export function tier2Enabled(): boolean { return client != null; }

export async function parseEventWithModel(eventId: string): Promise<{ skipped: boolean; changed: string[] }> {
  if (!client) return { skipped: true, changed: [] };
  const [ev] = await db.select().from(fieldEvents).where(eq(fieldEvents.id, eventId)).limit(1);
  if (!ev || ev.kind !== "voice" || !ev.transcript) return { skipped: true, changed: [] };

  const [cams, lens, roll] = await Promise.all([
    db.select({ id: cameras.id, make: cameras.make, model: cameras.model }).from(cameras).where(eq(cameras.userId, ev.userId)),
    db.select({ id: lenses.id, make: lenses.make, model: lenses.model, focalLengthMm: lenses.focalLengthMm }).from(lenses).where(eq(lenses.userId, ev.userId)),
    ev.rollId ? db.select({ format: rolls.format }).from(rolls).where(eq(rolls.id, ev.rollId)).limit(1) : Promise.resolve([]),
  ]);
  // Nearest photo event within 10 min on the same roll (or loose), for the scene description.
  const lo = new Date(ev.capturedAt.getTime() - 10 * 60_000), hi = new Date(ev.capturedAt.getTime() + 10 * 60_000);
  const [photo] = await db.select().from(fieldEvents).where(and(
    eq(fieldEvents.userId, ev.userId), eq(fieldEvents.kind, "photo"), gte(fieldEvents.capturedAt, lo), lte(fieldEvents.capturedAt, hi),
    ev.rollId ? eq(fieldEvents.rollId, ev.rollId) : isNull(fieldEvents.rollId),
  )).orderBy(desc(fieldEvents.capturedAt)).limit(1);

  const context = [
    `Cameras: ${cams.map((c) => `${c.id} = ${c.make} ${c.model}`).join("; ") || "none"}`,
    `Lenses: ${lens.map((l) => `${l.id} = ${l.make} ${l.model} ${l.focalLengthMm ?? ""}mm`).join("; ") || "none"}`,
    `Roll format: ${roll[0]?.format ?? "unknown"}`,
    `Already parsed (keep unless the note clearly says otherwise): ${PARSED_FIELD_NAMES.map((k) => `${k}=${(ev as Record<string, unknown>)[k] ?? "null"}`).join(", ")}`,
  ].join("\n");

  const userContent: Anthropic.MessageParam["content"] = [];
  if (photo?.fileKey) {
    const buf = await readFile(join(config.UPLOADS_DIR, photo.fileKey)).catch(() => null);
    if (buf) userContent.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: buf.toString("base64") } });
  }
  userContent.push({ type: "text", text: `${context}\n\nTranscript:\n"""\n${ev.transcript}\n"""` });

  const res = await client.messages.parse({
    model: config.FIELD_PARSE_MODEL,
    max_tokens: 2000,
    system: [{ type: "text", text: await prompt(), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userContent }],
    output_config: { format: zodOutputFormat(Output) },
  });
  const out = res.parsed_output;
  if (!out) throw new Error("tier-2 parse returned no structured output");

  const tier2: Tier2Result = {
    fields: Object.fromEntries(PARSED_FIELD_NAMES.map((k) => [k, out[k].value])) as Tier2Result["fields"],
    confidence: Object.fromEntries(PARSED_FIELD_NAMES.map((k) => [k, out[k].confidence])) as Tier2Result["confidence"],
    cameraId: out.cameraId, remarks: out.remarks ?? undefined, sceneDescription: out.sceneDescription ?? undefined, reviewReason: out.reviewReason,
  };
  // lensId must be a real lens of this user; drop hallucinated ids.
  if (tier2.fields.lensId && !lens.some((l) => l.id === tier2.fields.lensId)) { tier2.fields.lensId = null; }
  const current = Object.fromEntries(PARSED_FIELD_NAMES.map((k) => [k, (ev as Record<string, unknown>)[k] as string | null])) as Parameters<typeof mergeParse>[0];
  const merged = mergeParse(current, tier2, ev.editedFields);

  const set: Partial<typeof fieldEvents.$inferInsert> = {
    ...merged.fields,
    parsedAt: new Date(),
    parser: `claude:${config.FIELD_PARSE_MODEL}`,
    parseNotes: tier2.reviewReason ?? null,
    review: !!tier2.reviewReason,
    updatedAt: new Date(),
  };
  if (!ev.remarks && tier2.remarks) set.remarks = tier2.remarks;
  if (!ev.sceneDescription && tier2.sceneDescription) set.sceneDescription = tier2.sceneDescription;
  if (!ev.cameraId && tier2.cameraId && cams.some((c) => c.id === tier2.cameraId)) set.cameraId = tier2.cameraId;
  await db.update(fieldEvents).set(set).where(eq(fieldEvents.id, ev.id));
  return { skipped: false, changed: merged.changed };
}

/** Voice events never seen by tier 2 (parser null or "regex"), oldest first. Returns how many were attempted. */
export async function sweepUnparsed(limit = 20): Promise<number> {
  if (!client) return 0;
  const rows = await db.select({ id: fieldEvents.id }).from(fieldEvents)
    .where(and(eq(fieldEvents.kind, "voice"), sql`${fieldEvents.transcript} is not null`, sql`(${fieldEvents.parser} is null or ${fieldEvents.parser} = 'regex')`))
    .orderBy(fieldEvents.capturedAt).limit(limit);
  for (const r of rows) {
    try { await parseEventWithModel(r.id); } catch (err) { console.error(`tier-2 parse failed for ${r.id}:`, (err as Error).message); }
  }
  return rows.length;
}

export async function reparseMany(userId: string, sel: { ids?: string[]; rollId?: string; since?: string }): Promise<{ attempted: number; changed: number }> {
  const conds = [eq(fieldEvents.userId, userId), eq(fieldEvents.kind, "voice")];
  if (sel.ids) conds.push(inArray(fieldEvents.id, sel.ids));
  if (sel.rollId) conds.push(eq(fieldEvents.rollId, sel.rollId));
  if (sel.since) conds.push(gte(fieldEvents.capturedAt, new Date(sel.since)));
  const rows = await db.select({ id: fieldEvents.id }).from(fieldEvents).where(and(...conds)).limit(200);
  let changed = 0;
  for (const r of rows) {
    try { const res = await parseEventWithModel(r.id); if (res.changed.length) changed++; }
    catch (err) { console.error(`reparse failed for ${r.id}:`, (err as Error).message); }
  }
  return { attempted: rows.length, changed };
}
```

Simplify `prompt()`: load once from `new URL("./field-parse-prompt.md", import.meta.url)`; the build must copy the `.md` into `dist/services/` — add to `packages/server/package.json` build script: `"build": "tsc && cp src/services/field-parse-prompt.md dist/services/"`. Remove the `UPLOADS_DIR`-relative fallback from the snippet above.

- [ ] **Step 3: Hook into create + reparse route** — in `field-events.ts`: after the insert in `POST /` add

```ts
    if (row.kind === "voice" && row.transcript && tier2Enabled()) {
      parseEventWithModel(row.id).catch((err) => request.log.warn({ err }, "tier-2 parse failed"));
    }
```

(fire-and-forget; the client polls `GET /field-events?client_ids=` for the result) and add the route:

```ts
  // ── Reparse (tier 2 again) ──────────────────────────────────────────
  fastify.post("/reparse", async (request, reply) => {
    const body = reparseFieldEventsSchema.parse(request.body);
    if (!tier2Enabled()) return reply.status(503).send({ error: "Tier-2 parsing is not configured (ANTHROPIC_API_KEY)" });
    const r = await reparseMany(request.userId, body);
    return { data: r };
  });
```

Register `/reparse` **before** `/:id` routes so Fastify does not treat "reparse" as an id (Fastify matches static routes first anyway, but keep the order explicit).

- [ ] **Step 4: Sweep timer** — in `index.ts` after `fastify.listen`:

```ts
import { sweepUnparsed, tier2Enabled } from "./services/field-parse-model.js";
// ...
if (tier2Enabled()) {
  setInterval(() => { sweepUnparsed().catch((err) => fastify.log.warn({ err }, "tier-2 sweep failed")); }, 5 * 60_000).unref();
  fastify.log.info(`Tier-2 field parsing on (${config.FIELD_PARSE_MODEL})`);
}
```

- [ ] **Step 5: Live check** — with a real `ANTHROPIC_API_KEY` exported in the shell that starts the dev server (do not write it to `.env` unless the owner already keeps one there): create a voice event with the ramble from the Task 1 test plus "on the Mamiya", wait ~5 s, `GET` it: expect `parser` = `claude:claude-haiku-4-5`, `subject` filled, `remarks` containing the fridge sentence verbatim, `cameraId` = the Mamiya, `review` false. Then `POST /field-events/reparse {"ids":[...]}` → `{attempted:1, changed:0}`. Without the key: create → `parser` stays `regex`, `POST /reparse` → 503. Record outputs. Clean up the events.

- [ ] **Step 6: Build, test, commit**

```bash
npm run build -w packages/server && npm test
git add packages/server
git commit -m "feat(server): tier-2 Claude parse for field events (+reparse, sweep)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01Q6jMVz9nSKsnyFxZP939Xi"
```

---

### Task 7: MCP tools re-pointed

**Files:**
- Modify: `packages/mcp/src/server.ts` (replace the `// ── Field captures` section through `tomu_assign_capture`)
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `/field-events` routes (Tasks 4–6); existing helpers `api`, `pickActiveRoll`, `describeRoll`, `fuzzyMatch`, `resolveRollHandle`, `rollLabel` (keep these two from V1).
- Produces tools: `tomu_capture` (writes a voice event; args `transcript` (required), `camera?`, `frameNumber?`, `capturedAt?`), `tomu_field_events` (list), `tomu_edit_event`, `tomu_pin_event` (batch), `tomu_roll_level_event`, `tomu_reparse_events`. Removes `tomu_captures`, `tomu_edit_capture`, `tomu_assign_capture`.

- [ ] **Step 1: Replace the section**

```ts
// ── Field events ──────────────────────────────────────────────────────
//
// The field stream: voice notes (verbatim transcript + parsed fields) and photos.
// This tool path is the Claude-app fallback; the PWA is the primary field surface.
// The photo never passes through Claude.

interface FieldEventRow {
  id: string; shortId: string; clientId: string; kind: "voice" | "photo";
  status: "pending" | "pinned" | "roll_level"; rollId: string | null; cameraId: string | null;
  frameNumber: number | null; frameProvisional: boolean; sheetId: string | null; capturedAt: string;
  transcript: string | null; fileUrl: string | null;
  shutterSpeed: string | null; aperture: string | null; compensation: string | null; meteringMode: string | null;
  subject: string | null; locationName: string | null; remarks: string | null; sceneDescription: string | null;
  parser: string | null; parseNotes: string | null; review: boolean; editedFields: string[];
}

function eventLine(e: FieldEventRow, rollsById: Map<string, AnyRoll>): string {
  const settings = [e.shutterSpeed, e.aperture, e.compensation].filter(Boolean).join(" ");
  const roll = e.rollId ? rollsById.get(e.rollId) : undefined;
  const where = roll ? `roll ${rollLabel(roll)}` : "loose";
  const when = e.capturedAt.slice(0, 16).replace("T", " ");
  const frame = e.frameNumber != null ? ` · frame ${e.frameNumber}${e.frameProvisional ? "?" : ""}` : e.sheetId ? ` · sheet ${e.sheetId}` : "";
  const state = e.status === "pending" ? (e.review ? "NEEDS REVIEW" : "pending") : e.status;
  const head = e.kind === "photo" ? "📷 photo" : settings || "(no settings)";
  return `**${e.shortId}** · ${when} · ${where}${frame} · ${head}${e.subject ? ` · ${e.subject}` : ""} · ${state}`;
}

async function rollsIndex(): Promise<Map<string, AnyRoll>> {
  const { data } = await api<{ data: AnyRoll[] }>("/rolls?status=all");
  return new Map(data.map((r) => [r.id, r]));
}

server.tool(
  "tomu_capture",
  "FIELD USE (fallback when the Tomu app isn't handy). Record a spoken field note verbatim. Pass the user's words as " +
    "`transcript` — do not summarise or reformat them; the server extracts settings and keeps the ramble. " +
    "Do NOT try to upload or attach an image: a photo taken inside the Claude app is not saved anywhere. " +
    "If `camera` names a camera with one active roll the note is linked to it and gets a provisional frame number; " +
    "otherwise it stays loose. Never ask for missing details.",
  {
    transcript: z.string().min(1).describe("The user's words, verbatim"),
    camera: z.string().optional().describe("Camera hint (e.g. 'M6', 'Mamiya'); omit if not said"),
    frameNumber: z.number().int().positive().optional().describe("Only if the user stated it and it is not in the transcript"),
    capturedAt: z.string().optional().describe("ISO time if the shot was earlier than now"),
  },
  async ({ transcript, camera, frameNumber, capturedAt }) => {
    const body: Record<string, unknown> = { clientId: crypto.randomUUID(), kind: "voice", transcript };
    const notesOut: string[] = [];
    if (camera) {
      const { roll, error } = await pickActiveRoll(camera);
      if (roll) { body.rollId = roll.id; if (roll.cameraId) body.cameraId = roll.cameraId; notesOut.push(`roll ${describeRoll(roll)}`); }
      else if (error?.startsWith("Multiple active rolls")) return { content: [{ type: "text" as const, text: error }] };
      else notesOut.push(`no active roll for "${camera}" — loose`);
    }
    if (frameNumber != null) body.frameNumber = frameNumber;
    if (capturedAt) { const d = new Date(capturedAt); if (!Number.isNaN(d.getTime())) body.capturedAt = d.toISOString(); }
    const { data: e } = await api<{ data: FieldEventRow }>("/field-events", { method: "POST", body: JSON.stringify(body) });
    return { content: [{ type: "text" as const, text: `${eventLine(e, await rollsIndex())}${notesOut.length ? `\n${notesOut.join("; ")}` : ""}` }] };
  }
);

server.tool(
  "tomu_field_events",
  "List field events (voice notes and photos). Default: pending ones, newest first. Shows transcript first, then parsed settings.",
  {
    roll: z.string().optional().describe("display id, Dev Id, dev seq, or uuid prefix"),
    status: z.string().optional().describe("'pending' (default), 'pinned', 'roll_level', or 'all'"),
    review: z.boolean().optional().describe("Only events the parser flagged for review"),
    limit: z.number().int().positive().optional().describe("Max rows (default 20)"),
  },
  async ({ roll, status, review, limit }) => {
    const params = new URLSearchParams({ status: status ?? "pending", limit: String(limit ?? 20) });
    if (review) params.set("review", "true");
    if (roll) { const r = await resolveRollHandle(roll); if (!r.roll) return { content: [{ type: "text" as const, text: r.error! }] }; params.set("roll_id", r.roll.id); }
    const { data } = await api<{ data: FieldEventRow[] }>(`/field-events?${params}`);
    if (!data.length) return { content: [{ type: "text" as const, text: "No field events." }] };
    const idx = await rollsIndex();
    const lines = data.map((e) => {
      const extra = [e.transcript ? `  > ${e.transcript}` : "", e.parseNotes ? `  ⚠ ${e.parseNotes}` : "", e.fileUrl ? `  ${e.fileUrl}` : ""].filter(Boolean).join("\n");
      return `- ${eventLine(e, idx)}${extra ? `\n${extra}` : ""}`;
    });
    return { content: [{ type: "text" as const, text: `## Field events (${data.length})\n\n${lines.join("\n")}` }] };
  }
);

server.tool(
  "tomu_edit_event",
  "Correct a field event's parsed fields, roll, or frame number. Edited fields are protected from re-parsing. The transcript cannot be changed.",
  {
    event: z.string().describe("Event id (uuid or ≥8-char prefix)"),
    roll: z.string().optional(), frameNumber: z.number().int().positive().optional(), sheetId: z.string().optional(),
    shutterSpeed: z.string().optional(), aperture: z.string().optional(), compensation: z.string().optional(), meteringMode: z.string().optional(),
    lens: z.string().optional().describe("Lens hint (fuzzy)"), subject: z.string().optional(), locationName: z.string().optional(),
    remarks: z.string().optional(), review: z.boolean().optional().describe("false to clear a review flag"),
  },
  async ({ event, roll, lens, ...rest }) => {
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rest)) if (v !== undefined) body[k] = v;
    if (roll) { const r = await resolveRollHandle(roll); if (!r.roll) return { content: [{ type: "text" as const, text: r.error! }] }; body.rollId = r.roll.id; }
    if (lens) {
      const { data: lenses } = await api<{ data: Array<{ id: string; make: string; model: string; focalLengthMm: number | null }> }>("/lenses");
      const m = lenses.find((l) => fuzzyMatch(lens, `${l.make} ${l.model}`, l.model, String(l.focalLengthMm ?? "")));
      if (!m) return { content: [{ type: "text" as const, text: `No lens matches "${lens}".` }] };
      body.lensId = m.id;
    }
    if (!Object.keys(body).length) return { content: [{ type: "text" as const, text: "Nothing to change." }] };
    const { data: e } = await api<{ data: FieldEventRow }>(`/field-events/${encodeURIComponent(event)}`, { method: "PATCH", body: JSON.stringify(body) });
    return { content: [{ type: "text" as const, text: `Updated ${eventLine(e, await rollsIndex())}` }] };
  }
);

server.tool(
  "tomu_pin_event",
  "After development: pin field events to frame numbers. A voice note becomes (or fills) the frame and its transcript is attached as a note; " +
    "a photo becomes a photo note on that frame. Pass `roll` for loose events. Runs in order, stops at the first failure.",
  {
    pins: z.array(z.object({ event: z.string(), frameNumber: z.number().int().positive() })).min(1),
    roll: z.string().optional(),
  },
  async ({ pins, roll }) => {
    let rollId: string | undefined;
    if (roll) { const r = await resolveRollHandle(roll); if (!r.roll) return { content: [{ type: "text" as const, text: r.error! }] }; rollId = r.roll.id; }
    const done: string[] = [];
    for (const p of pins) {
      try {
        const { data } = await api<{ data: { event: FieldEventRow; frame: { frameNumber: number }; joined: boolean } }>(
          `/field-events/${encodeURIComponent(p.event)}/pin`, { method: "POST", body: JSON.stringify(rollId ? { rollId, frameNumber: p.frameNumber } : { frameNumber: p.frameNumber }) });
        done.push(`${data.event.shortId} → frame ${data.frame.frameNumber}${data.joined ? " (joined)" : ""}`);
      } catch (err) {
        const remaining = pins.slice(done.length + 1).map((x) => x.event);
        return { content: [{ type: "text" as const, text: `${done.length ? `Pinned: ${done.join(", ")}\n` : ""}Failed on ${p.event} (frame ${p.frameNumber}): ${(err as Error).message}${remaining.length ? `\nNot attempted: ${remaining.join(", ")}` : ""}` }] };
      }
    }
    return { content: [{ type: "text" as const, text: `Pinned: ${done.join(", ")}` }] };
  }
);

server.tool(
  "tomu_roll_level_event",
  "Attach a field event to its roll as a note without a frame number (a scene reference photo, a general remark).",
  { event: z.string(), roll: z.string().optional().describe("Required for loose events") },
  async ({ event, roll }) => {
    let rollId: string | undefined;
    if (roll) { const r = await resolveRollHandle(roll); if (!r.roll) return { content: [{ type: "text" as const, text: r.error! }] }; rollId = r.roll.id; }
    const { data } = await api<{ data: { event: FieldEventRow } }>(`/field-events/${encodeURIComponent(event)}/roll-level`, { method: "POST", body: JSON.stringify(rollId ? { rollId } : {}) });
    return { content: [{ type: "text" as const, text: `Attached ${eventLine(data.event, await rollsIndex())}` }] };
  }
);

server.tool(
  "tomu_reparse_events",
  "Run the model parse again over voice events (after a prompt change, or to fill fields). Hand-edited fields are never touched.",
  { events: z.array(z.string()).optional().describe("Event ids"), roll: z.string().optional(), since: z.string().optional().describe("ISO date") },
  async ({ events, roll, since }) => {
    const body: Record<string, unknown> = {};
    if (events?.length) {
      const ids: string[] = [];
      for (const h of events) { const { data } = await api<{ data: FieldEventRow }>(`/field-events/${encodeURIComponent(h)}`); ids.push(data.id); }
      body.ids = ids;
    }
    if (roll) { const r = await resolveRollHandle(roll); if (!r.roll) return { content: [{ type: "text" as const, text: r.error! }] }; body.rollId = r.roll.id; }
    if (since) body.since = new Date(since).toISOString();
    const { data } = await api<{ data: { attempted: number; changed: number } }>("/field-events/reparse", { method: "POST", body: JSON.stringify(body) });
    return { content: [{ type: "text" as const, text: `Reparsed ${data.attempted} event(s); ${data.changed} changed.` }] };
  }
);
```

Delete `CaptureRow`, `captureLine`, and the three old tools. Keep `AnyRoll`, `resolveRollHandle`, `rollLabel`. Ensure `crypto` is available (`import { randomUUID } from "node:crypto"` and use `randomUUID()` instead of `crypto.randomUUID()`).

- [ ] **Step 2: CLAUDE.md** — replace the **Field** line with:

```markdown
- **Field** — `tomu_capture` (verbatim voice note → field event), `tomu_field_events`, `tomu_edit_event`, `tomu_pin_event`, `tomu_roll_level_event`, `tomu_reparse_events`. The PWA `/capture` screen is the primary field surface; photos never pass through Claude.
```

- [ ] **Step 3: Build + stdio check** — `npm run build -w packages/mcp`; with the API running, drive the built server over stdio (same client-script approach as the V1 task): `tomu_capture` with the ramble + `camera: "Mamiya"`, `tomu_field_events`, `tomu_edit_event` setting `aperture`, `tomu_pin_event` to frame 99 on that roll, `tomu_roll_level_event` on a fresh loose event with `roll`, `tomu_reparse_events` (expect 503 text when no key). Record replies. Clean up frames/notes/events.

- [ ] **Step 4: Commit**

```bash
npm test
git add packages/mcp/src/server.ts CLAUDE.md
git commit -m "feat(mcp): field-event tools; tomu_capture writes verbatim voice events" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01Q6jMVz9nSKsnyFxZP939Xi"
```

---

### Task 8: Retire V1 `captures`

**Files:**
- Modify: `scripts/photos-sync.ts`
- Modify: `packages/server/src/db/schema.ts` (remove `captures`), `packages/server/src/index.ts` (unregister), `packages/server/src/routes/rolls.ts` (remove `pendingCaptures`)
- Delete: `packages/server/src/routes/captures.ts`
- Modify: `packages/shared/src/capture.ts` → keep only `FrameFields` (move into `field-event.ts`) and delete the file; remove `Capture*` types/schemas from `types.ts`/`schemas.ts`; `packages/shared/test/capture.test.ts` → delete; `vitest.config.ts` include list.
- Modify: `packages/client/src/services/api.ts` (drop `pendingCaptures`), `RollsPage.tsx` (drop the section; Task 9 adds the new one)

- [ ] **Step 1: `photos:sync` re-point** — in `scripts/photos-sync.ts`:
  - Fetch `GET /field-events?status=all&kind=voice&since=…&limit=500` → candidates = voice events with no photo event within the window (fetch `kind=photo` events for the same range and exclude voice events that have a photo event within ±2 min on the same roll).
  - `usedAssetIds` = all `photoAssetId` from photo events.
  - `--force` keys are event id prefixes instead of `C412` (`parseCaptureId` removed).
  - On match: create a photo event `POST /field-events { clientId: randomUUID(), kind: "photo", rollId: <voice event's rollId>, capturedAt: <photo time> }` then `POST /field-events/:id/photo` with the file + `photoAssetId`.
  - Table columns unchanged except the first is the voice event `shortId`.

- [ ] **Step 2: Remove V1 code** as listed. Move `FrameFields` into `field-event.ts` and update the import in `frame-numbering.ts`/`field-event.ts`. Drop `pendingCaptures` from `rolls.ts`, `api.ts`, and `RollsPage.tsx` (the section is replaced in Task 9). Remove the `captures` table from the schema.

- [ ] **Step 3: Verify the copy, then drop** — with the dev server stopped:

```bash
npm run -w packages/server migrate:field-events -- --check   # expect "would copy 0 … (N already present)"
pg_dump --host=localhost --username=filmlog --dbname=filmlog --clean --if-exists --no-owner --no-privileges > db-backups/pre-drop-captures-$(date +%Y%m%d-%H%M%S).sql
npm run -w packages/server db:push                            # drops captures; answer the prompt only if it is exactly "drop table captures"
```

- [ ] **Step 4: Gate + commit**

```bash
npm run test:coverage && npm run build
git add -A
git commit -m "refactor: retire V1 captures (table, routes, tools, types); photos:sync on field events" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01Q6jMVz9nSKsnyFxZP939Xi"
```

---

### Task 9: Roll detail — unpinned events (transcript first)

**Files:**
- Modify: `packages/client/src/services/api.ts` (`RollDetail.unpinnedEvents: (FieldEvent & { shortId: string })[]`)
- Modify: `packages/client/src/components/rolls/RollsPage.tsx`

- [ ] **Step 1: Section** — where the V1 "Pending captures" block was, render:

```tsx
      {detail.unpinnedEvents.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">
            Field notes ({detail.unpinnedEvents.length}) — pin with tomu_pin_event
          </div>
          <ul className="space-y-2 text-xs">
            {detail.unpinnedEvents.map((e) => {
              const settings = [e.shutterSpeed, e.aperture, e.compensation, e.meteringMode].filter(Boolean).join(" · ");
              const frame = e.frameNumber != null ? `frame ${e.frameNumber}${e.frameProvisional ? "?" : ""}` : e.sheetId ? `sheet ${e.sheetId}` : null;
              return (
                <li key={e.id} className="flex gap-2">
                  {e.kind === "photo" && e.fileUrl ? (
                    <img src={e.fileUrl} alt="" className="h-14 w-14 shrink-0 rounded object-cover" loading="lazy" />
                  ) : (
                    <div className="w-14 shrink-0 text-muted-foreground tabular-nums">{formatTime(e.capturedAt)}</div>
                  )}
                  <div className="flex-1 space-y-0.5">
                    {e.transcript && <div className="text-foreground whitespace-pre-wrap">{e.transcript}</div>}
                    <div className="text-muted-foreground">
                      {[frame, settings, e.review ? "needs review" : null].filter(Boolean).join(" · ")}
                    </div>
                    {e.parseNotes && <div className="text-muted-foreground italic">{e.parseNotes}</div>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
```

- [ ] **Step 2: Build + browser check** at desktop and 390 px with one voice event (long transcript) and one photo event pending on a roll (create via curl; clean up after). `npm run build -w packages/client`.

- [ ] **Step 3: Commit**

```bash
git add packages/client
git commit -m "feat(client): field notes on roll detail, transcript first" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01Q6jMVz9nSKsnyFxZP939Xi"
```

---

### Task 10: Docs, roadmap, deploy notes

**Files:** `ROADMAP.md`, `docs/SELF-HOSTING.md`, `RESTORE.md` (uploads path note now covers `uploads/events/`), `deploy/nginx/tomu.conf` (no change needed; `/uploads/` covers both dirs).

- [ ] **Step 1:** ROADMAP `## Data model`: replace the V1 shipped line's tail with "Superseded by **field events** (V2 part 1, 2026-09): `field_events` stream, tier-1 parser in shared, tier-2 Claude parse server-side (`FIELD_PARSE_MODEL`), pin/roll-level. V2 part 2 = PWA capture screen (spec §2–3)." Add under `## Dev workflow` nothing. Add a `## Field capture` section listing: prod needs `ANTHROPIC_API_KEY` + `FIELD_PARSE_MODEL` in `.env`; migration order: deploy with migrate → `npm run -w packages/server migrate:field-events` on the droplet → verify `--check` → next deploy with migrate drops `captures`.
- [ ] **Step 2:** SELF-HOSTING "Field captures" section rewritten for events: transcript verbatim; tier-2 optional (`ANTHROPIC_API_KEY`); `photos:sync` now a fallback.
- [ ] **Step 3:** Full gate `npm run test:coverage && npm run build`; commit `docs: field events (V2 part 1) roadmap + self-hosting notes`. Controller pushes and opens the PR.

**Owner-gated after merge:** deploy with migrate (creates `field_events` — the `captures` drop happens only after the copy script has run on the droplet, so merge Task 8's schema change in a *second* deploy, or run the copy script before the first migrate deploy and accept the drop in one go — the controller sequences this with the owner); `ANTHROPIC_API_KEY` in the droplet `.env` (pm2 `--update-env`); `mkdir -p ~/filmlog/uploads/events`.

---

## Self-review

**Spec coverage.** §1 table → Task 3 (all columns; `photo_asset_id` added for `photos:sync` idempotency; `remarks`/`scene_description` per §4). §4 tier 1 → Task 1; tier 2 + merge rules + reparse + prompt in repo + key config → Tasks 2, 6. §5 pin/roll-level/PATCH/DELETE/GET filters → Tasks 4–5; MCP names per spec (`tomu_field_events`, `tomu_pin_event`, `tomu_roll_level_event`, `tomu_edit_event`, `tomu_reparse_events`) → Task 7; roll detail read-only → Task 9. §6 migration + `photos:sync` re-point + drop → Tasks 3, 8. §7 error codes → Tasks 4–6. §8 tests → Tasks 1–2 (parser, merge, numbering, mapping); sync-worker tests belong to part 2. §9 rollout order → Tasks 1–10 and the owner notes.

**Deviations, deliberate.** Provisional numbering happens server-side on create (the PWA will compute the same locally in part 2 and send `frameNumber` only when spoken). The "pin joins an existing frame" behaviour (Task 5) is an addition so a photo can be pinned to a frame a voice note already created; spec §5 implied one event per frame. `photos:sync` creates `photo` events rather than attaching to voice events, per the "photo is its own event" decision.

**Type consistency.** `FrameFields` shape reused from V1 until Task 8 moves it; `presentEvent` adds `shortId`, which `FieldEventRow` (MCP) and the client type carry; pin response `{ event, frame, joined }` read identically in `tomu_pin_event`; `reparseMany` signature matches the route and the `reparseFieldEventsSchema` fields; `Tier2Result` fields map 1:1 to `PARSED_FIELD_NAMES`.
