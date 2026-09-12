#!/usr/bin/env tsx
/**
 * Field-note parser explorer. Type a spoken field note the way dictation would write
 * it and see exactly what tier 1 extracts, which characters it consumed, and what the
 * tier-1/tier-2 merge policy would do with a given set of model values.
 *
 * Everything here is the real code: `parseTranscript` from @tomu/shared is the same
 * function the phone runs on every keystroke, and `mergeParse` is the same 35-line
 * policy the server applies to a model result. Nothing calls a model and nothing
 * touches the network — tier-2 values in `:tier2` are yours to invent, so the merge
 * column shows the policy's decision, not a model's opinion.
 *
 * Usage: npm run parse -- "two fifty at f eight, plus one, frame nine"
 *        npm run parse                (interactive; :help lists commands)
 */
import { createInterface } from "node:readline/promises";
import {
  mergeParse,
  parseTranscript,
  PARSED_FIELD_NAMES,
  TIER2_OVERRIDE_CONFIDENCE,
  type GearIndex,
  type ParsedFieldName,
  type ParsedFields,
  type ParseSpan,
  type Tier2Result,
} from "@tomu/shared";

// ── presentation ──

const plain = !!process.env.NO_COLOR || !process.stdout.isTTY;
const sgr = (code: string) => (s: string) => (plain ? s : `\x1b[${code}m${s}\x1b[0m`);
const bold = sgr("1");
const dim = sgr("2");
const cyan = sgr("36");
const green = sgr("32");
const yellow = sgr("33");
const red = sgr("31");

/** The gear a note can name. Mirrors the fixture in packages/shared/test/field-parse.test.ts. */
const GEAR: GearIndex = {
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
const gearLabel = (id: string) =>
  [...GEAR.cameras, ...GEAR.lenses].find((g) => g.id === id)?.label ?? id;

/** Fields the capture screen always renders a chip for, dashed when empty (V2 spec §2). */
const EXPECTED = ["cameraId", "frameNumber", "shutterSpeed", "aperture"] as const;
const FIELD_ORDER = [
  "cameraId", "lensId", "frameNumber", "sheetId",
  "shutterSpeed", "aperture", "compensation", "meteringMode",
] as const;

/**
 * A `~~~~` rule under every character a rule consumed, so it is obvious what the
 * parser read and — more usefully — what it ignored. `spans` come back from the
 * parser itself; the UI uses the same ranges to underline the transcript.
 */
function spanRule(text: string, spans: ParseSpan[]): string {
  const marks = Array.from(text, () => " ");
  for (const [start, end] of spans) {
    for (let i = start; i < end && i < marks.length; i++) marks[i] = "~";
  }
  return marks.join("").replace(/\s+$/, "");
}

const quoted = (text: string, spans: ParseSpan[], field: string) => {
  const hit = spans.find((s) => s[2] === field);
  return hit ? text.slice(hit[0], hit[1]) : null;
};

// ── state the REPL carries between lines ──

/** Hypothetical tier-2 values: `field -> { value, confidence }`, set by `:tier2`. */
const tier2: Partial<Record<ParsedFieldName, { value: string; confidence: number }>> = {};
/** Fields marked hand-corrected, set by `:edit`. The merge must never touch these. */
const editedFields = new Set<string>();

/**
 * Median of 20 runs after a warm-up. A single cold call measures regex compilation and
 * JIT, which is ~9 ms and says nothing useful; steady state is the number that matters,
 * because this runs on every keystroke.
 */
function timedParse(text: string): { result: ReturnType<typeof parseTranscript>; micros: number } {
  parseTranscript(text, GEAR);
  const runs: number[] = [];
  let result = parseTranscript(text, GEAR);
  for (let i = 0; i < 20; i++) {
    const started = process.hrtime.bigint();
    result = parseTranscript(text, GEAR);
    runs.push(Number(process.hrtime.bigint() - started) / 1000);
  }
  runs.sort((a, b) => a - b);
  return { result, micros: runs[10] };
}

function showParse(text: string): void {
  const { result: { fields, spans, command }, micros } = timedParse(text);

  console.log();
  console.log(`  ${text}`);
  const rule = spanRule(text, spans);
  if (rule.trim()) console.log(`  ${plain ? rule : cyan(rule)}`);
  console.log();

  if (command) {
    console.log(`  ${yellow("command")}  ${command}  ${dim(`◂ "${quoted(text, spans, "command")}"`)}`);
    console.log(`  ${dim("a command deletes the note in progress; nothing is parsed from it")}`);
    console.log();
    return;
  }

  for (const field of FIELD_ORDER) {
    const raw = fields[field];
    const value = raw == null ? null : field === "cameraId" || field === "lensId" ? gearLabel(String(raw)) : String(raw);
    if (value == null && !EXPECTED.includes(field as (typeof EXPECTED)[number])) continue;
    const label = field.padEnd(13);
    if (value == null) {
      console.log(`  ${dim(label)}${dim("· · ·")}`);
      continue;
    }
    const src = quoted(text, spans, field);
    console.log(`  ${label}${green(value.padEnd(22))}${src ? dim(`◂ "${src}"`) : ""}`);
  }

  const found = Object.keys(fields).length;
  console.log();
  console.log(
    `  ${dim(`tier 1: ${found} field${found === 1 ? "" : "s"} in ${micros.toFixed(0)} µs (median of 20), on device, nothing sent anywhere`)}`,
  );

  if (Object.keys(tier2).length || editedFields.size) showMerge(fields);
  console.log();
}

/**
 * Run the real merge policy over the tier-1 result and the hypothetical tier-2 values,
 * then explain each row. The decision comes from `mergeParse`; the explanation is
 * derived from its output and the inputs, so this view cannot drift from the policy.
 */
function showMerge(tier1: ParsedFields): void {
  // `subject` and `locationName` are in the merge policy but not in tier 1's output,
  // so the lookup has to tolerate a field tier 1 can never set.
  const tier1Any = tier1 as Record<string, string | number | undefined>;
  const current = Object.fromEntries(
    PARSED_FIELD_NAMES.map((k) => [k, tier1Any[k] == null ? null : String(tier1Any[k])]),
  ) as Parameters<typeof mergeParse>[0];

  const result: Tier2Result = {
    fields: Object.fromEntries(
      PARSED_FIELD_NAMES.map((k) => [k, tier2[k]?.value ?? null]),
    ) as Tier2Result["fields"],
    confidence: Object.fromEntries(
      PARSED_FIELD_NAMES.map((k) => [k, tier2[k]?.confidence ?? 0]),
    ) as Tier2Result["confidence"],
  };
  const merged = mergeParse(current, result, [...editedFields]);

  console.log();
  console.log(`  ${bold("merge")} ${dim(`— your tier-2 numbers, the real policy (field-merge.ts)`)}`);
  console.log(
    `  ${dim("field".padEnd(13) + "tier 1".padEnd(16) + "tier 2".padEnd(22) + "result".padEnd(16) + "why")}`,
  );

  for (const field of PARSED_FIELD_NAMES) {
    const have = current[field] ?? null;
    const proposed = tier2[field];
    if (!have && !proposed && !editedFields.has(field)) continue;

    const took = field in merged.fields;
    const value = took ? merged.fields[field] : have;
    let why: string;
    if (editedFields.has(field)) why = red("blocked — hand-edited, never re-parsed");
    else if (!proposed) why = dim("no tier-2 value");
    else if (took && !have) why = green("filled — tier 1 had nothing");
    else if (took) why = yellow(`tier-2 override — conf ≥ ${TIER2_OVERRIDE_CONFIDENCE}`);
    else if (have === proposed.value) why = dim("agree");
    else why = `tier 1 stands — conf < ${TIER2_OVERRIDE_CONFIDENCE}`;

    const t2 = proposed ? `${proposed.value} (${proposed.confidence.toFixed(2)})` : "—";
    const shownValue = field === "lensId" && value ? gearLabel(value) : (value ?? "—");
    console.log(
      `  ${field.padEnd(13)}${(have ?? "—").padEnd(16)}${t2.padEnd(22)}${String(shownValue).padEnd(16)}${why}`,
    );
  }
  console.log();
  console.log(`  ${dim("the transcript itself is never modified by either tier")}`);
}

// ── commands ──

const HELP = `
  ${bold("commands")}
    <anything>                     parse it as a field note
    :tier2 <field>=<value>@<conf>  propose a tier-2 value (repeatable; quote values with spaces)
    :edit <field>                  mark a field hand-corrected (blocks re-parsing)
    :clear                         drop all tier-2 values and edits
    :gear                          list the gear a note can name
    :fields                        list the fields the merge policy covers
    :help  :quit

  ${bold("try")}
    okay so this is the kitchen window again, um, two fifty at f eight, plus one because of the backlight, frame nine I think
    Ilford Pan F50, frame 1, f/2, one twenty-fifth        ${dim("← the film name is not an aperture (93ad38a)")}
    sixteen people at the party                           ${dim("← not a shutter speed")}
    holder 3b on the Crown Graphic, incident, plus a third
    scratch that
    :tier2 aperture=f/2@0.95                              ${dim("← then re-parse the Pan F50 line")}
`;

/** `:tier2 aperture=f/2@0.95 subject="kitchen window"@0.6` */
function setTier2(rest: string): void {
  const re = /(\w+)=(?:"([^"]*)"|([^\s@]+))@([0-9.]+)/g;
  let any = false;
  for (const m of rest.matchAll(re)) {
    const field = m[1] as ParsedFieldName;
    if (!(PARSED_FIELD_NAMES as readonly string[]).includes(field)) {
      console.log(`  ${red(`not a merged field: ${field}`)} ${dim(`(:fields lists them)`)}`);
      continue;
    }
    tier2[field] = { value: m[2] ?? m[3], confidence: Number(m[4]) };
    any = true;
  }
  if (!any) console.log(`  ${dim('usage: :tier2 aperture=f/2@0.95 subject="kitchen window"@0.6')}`);
  else console.log(`  ${dim("set. parse a note to see the merge.")}`);
}

/** One REPL line. Returns false to end the session. */
function handle(line: string): boolean {
  if (line === ":quit" || line === ":q" || line === ":exit") return false;
  if (line === ":help" || line === ":h") { console.log(HELP); return true; }
  if (line === ":gear") {
    for (const c of GEAR.cameras) console.log(`  camera  ${c.label}`);
    for (const l of GEAR.lenses) console.log(`  lens    ${l.label}`);
    return true;
  }
  if (line === ":fields") {
    console.log(`  ${PARSED_FIELD_NAMES.join(", ")}`);
    console.log(`  ${dim("frameNumber and sheetId are tier-1 only; subject and locationName are tier-2 only")}`);
    return true;
  }
  if (line === ":clear") {
    for (const k of Object.keys(tier2)) delete tier2[k as ParsedFieldName];
    editedFields.clear();
    console.log(`  ${dim("cleared")}`);
    return true;
  }
  if (line.startsWith(":tier2")) { setTier2(line.slice(6)); return true; }
  if (line.startsWith(":edit")) {
    const field = line.slice(5).trim();
    if (!(PARSED_FIELD_NAMES as readonly string[]).includes(field)) {
      console.log(`  ${red(`not a merged field: ${field || "(none given)"}`)}`);
      return true;
    }
    editedFields.add(field);
    console.log(`  ${dim(`${field} marked hand-edited — the merge must now leave it alone`)}`);
    return true;
  }
  if (line.startsWith(":")) { console.log(`  ${red(`unknown command ${line.split(" ")[0]}`)}`); return true; }
  showParse(line);
  return true;
}

async function main(): Promise<void> {
  const oneShot = process.argv.slice(2).filter((a) => !a.startsWith("-")).join(" ");
  if (oneShot) {
    showParse(oneShot);
    return;
  }

  console.log(`\n  ${bold("Tomu field-note parser")} ${dim("— tier 1 is real; tier-2 values are yours. :help")}`);
  // Async-iterator form rather than repeated `question()`: it ends cleanly at EOF, so the
  // same loop serves an interactive terminal and a piped script of commands.
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  const PROMPT = `\n  ${cyan("field note ▸")} `;
  rl.setPrompt(PROMPT);
  rl.prompt();
  for await (const raw of rl) {
    const line = raw.trim();
    if (line && !handle(line)) break;
    rl.prompt();
  }
  rl.close();
}

await main();
