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
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

/**
 * Small grammar for spoken numbers, handling the shapes this parser needs:
 *   "twelve"        → 12
 *   "twenty five"   → 25
 *   "two fifty"     → 250   (ones + tens, spoken as a shutter/time shorthand)
 *   "one sixty"     → 60    (numerator elision: "one" + tens, not 100+tens)
 *   "one twenty five" / "one twenty-fifth" → 125
 */
function spokenNumber(raw: string): number | null {
  const t = raw.toLowerCase().replace(/-/g, " ").trim();
  if (/^\d+$/.test(t)) return Number(t);
  const w = t.split(/\s+/).filter(Boolean);
  if (w.length === 0) return null;
  if (w.length === 1) {
    if (w[0] in ONES) return ONES[w[0]];
    if (w[0] in TENS) return TENS[w[0]];
    return null;
  }
  if (w.length === 2) {
    const [a, b] = w;
    if (a in TENS && b in ONES) return TENS[a] + ONES[b]; // twenty five → 25
    // "one" before a tens word is a numerator elision ("one sixty" = "1/60",
    // said the way "one two-fifty" means "1/250") rather than a multiplier,
    // so it reduces to the tens word alone.
    if (a === "one" && b in TENS) return TENS[b]; // one sixty → 60
    if (a in ONES && b in TENS) return ONES[a] * 100 + TENS[b]; // two fifty → 250
    return null;
  }
  if (w.length === 3) {
    const [a, b, c] = w;
    if (a in ONES && b in TENS && c in ONES) return ONES[a] * 100 + TENS[b] + ONES[c]; // one twenty five → 125
  }
  return null;
}

const NUM_WORD_UNIT = "(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)";
// A spoken number: 1-3 number words, or digits.
const NUM_WORD = `(?:\\d+|${NUM_WORD_UNIT}(?:[\\s-]${NUM_WORD_UNIT}){0,2})`;

interface Rule {
  field: keyof ParsedFields | "command";
  re: RegExp;
  value: (m: RegExpExecArray) => string | number | null;
}

function overlaps(spans: ParseSpan[], s: number, e: number): boolean {
  return spans.some(([a, b]) => s < b && e > a);
}

function apply(rules: Rule[], text: string, fields: ParsedFields, spans: ParseSpan[]) {
  for (const rule of rules) {
    if (fields[rule.field as keyof ParsedFields] !== undefined) continue;
    const re = new RegExp(rule.re.source, rule.re.flags.includes("g") ? rule.re.flags : rule.re.flags + "g");
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const s = m.index;
      const e = m.index + m[0].length;
      if (overlaps(spans, s, e)) {
        if (re.lastIndex === m.index) re.lastIndex++;
        continue;
      }
      const v = rule.value(m);
      if (v == null) {
        if (re.lastIndex === m.index) re.lastIndex++;
        continue;
      }
      (fields as Record<string, unknown>)[rule.field] = v;
      spans.push([s, e, rule.field]);
      break;
    }
  }
}

// ── frame / sheet (run first: an explicit "frame"/"number"/"holder"/"sheet"
// cue must claim its number before the bare-number shutter rule can see it) ──

const FRAME_RULES: Rule[] = [
  {
    field: "frameNumber",
    re: new RegExp(`\\b(?:frame|number|no\\.?|#)\\s+(${NUM_WORD})\\b`, "gi"),
    value: (m) => spokenNumber(m[1]),
  },
  {
    field: "sheetId",
    re: /\b(?:holder|sheet)\s+(\d{1,2})\s*([ab])\b/gi,
    value: (m) => `${m[1]}${m[2].toUpperCase()}`,
  },
];

// ── shutter speed ──

const SHUTTER_ORDINALS: Record<string, number> = {
  "two fiftieth": 250,
  "one twenty fifth": 125,
  "one twentyfifth": 125,
  fifteenth: 15,
  thirtieth: 30,
  sixtieth: 60,
  thousandth: 1000,
  "five hundredth": 500,
};

const SHUTTER_RULES_EXPLICIT: Rule[] = [
  { field: "shutterSpeed", re: /\b1\/(\d{1,5})\b/gi, value: (m) => `1/${m[1]}` },
  { field: "shutterSpeed", re: /\bbulb\b/gi, value: () => "B" },
  { field: "shutterSpeed", re: /\bhalf an?\s+second\b/gi, value: () => "1/2" },
  {
    field: "shutterSpeed",
    re: new RegExp(`\\b(${NUM_WORD})\\s*seconds?\\b`, "gi"),
    value: (m) => {
      const n = spokenNumber(m[1]);
      return n == null ? null : `${n}s`;
    },
  },
  { field: "shutterSpeed", re: /\b(\d+)\s*s\b/gi, value: (m) => `${m[1]}s` },
  {
    field: "shutterSpeed",
    re: /\b(?:a |an )?(two[\s-]fiftieth|one[\s-]twenty[\s-]?fifth|fifteenth|thirtieth|sixtieth|thousandth|five[\s-]hundredth)\b/gi,
    value: (m) => {
      const norm = m[1].toLowerCase().replace(/-/g, " ").replace(/\s+/g, " ");
      const n = SHUTTER_ORDINALS[norm] ?? SHUTTER_ORDINALS[norm.replace(" ", "")];
      return n ? `1/${n}` : null;
    },
  },
];

// A bare number (no "1/" prefix, no "seconds", no spoken ordinal) counts as a
// shutter speed only when it has a shutter cue AND its value is one of the
// standard full-stop denominators — otherwise ordinary numbers in a ramble
// ("sixteen people at the party", "twenty dollars for the print") would be
// misread as shutter speeds. Two cue shapes are recognised: the number is
// preceded by "at "/"speed "/"shutter ", or it is followed (after an optional
// comma and/or "and") by "at", an aperture cue ("f8", "f/8", "f 8", or a bare
// aperture word), or the end of the text.
const STANDARD_SHUTTER_DENOMS = new Set([15, 30, 60, 125, 250, 500, 1000, 2000, 4000, 8000]);

function bareShutterValue(m: RegExpExecArray): string | null {
  const n = spokenNumber(m[1]);
  if (n == null || !STANDARD_SHUTTER_DENOMS.has(n)) return null;
  return `1/${n}`;
}

const SHUTTER_BARE_RULES: Rule[] = [
  {
    field: "shutterSpeed",
    re: new RegExp(`(?<=\\b(?:at|speed|shutter)\\s)\\b(${NUM_WORD})\\b`, "gi"),
    value: bareShutterValue,
  },
  {
    field: "shutterSpeed",
    re: new RegExp(
      `\\b(${NUM_WORD})\\b(?=\\s*,?\\s*(?:and\\s+)?(?:at\\b|f\\/?\\d|f\\/|f\\b|eight\\b|eleven\\b|sixteen\\b|$))`,
      "gi",
    ),
    value: bareShutterValue,
  },
];

// ── aperture ──

const APERTURE_WORDS: Record<string, string> = {
  "one four": "1.4",
  "one point four": "1.4",
  "two point eight": "2.8",
  "two eight": "2.8",
  "five six": "5.6",
  "five point six": "5.6",
  eight: "8",
  eleven: "11",
  sixteen: "16",
  "twenty two": "22",
  "thirty two": "32",
  "forty five": "45",
  "sixty four": "64",
};

const APERTURE_RULES: Rule[] = [
  { field: "aperture", re: /\bf\s*\/\s*(\d{1,2}(?:\.\d)?)\b/gi, value: (m) => `f/${m[1]}` },
  { field: "aperture", re: /\bf\s+(\d{1,2}(?:\.\d)?)\b/gi, value: (m) => `f/${m[1]}` },
  { field: "aperture", re: /\bf(\d{1,2}(?:\.\d)?)\b/gi, value: (m) => `f/${m[1]}` },
  {
    field: "aperture",
    re: new RegExp(`\\bf\\s+(${Object.keys(APERTURE_WORDS).join("|")})\\b`, "gi"),
    value: (m) => `f/${APERTURE_WORDS[m[1].toLowerCase()]}`,
  },
  // spoken f-number without the leading "f": only unambiguous compound
  // fractional/word forms (never a plain integer word — those are ambiguous
  // with shutter/frame numbers).
  {
    field: "aperture",
    re: /\b(five six|five point six|two point eight|two eight|one point four|one four)\b/gi,
    value: (m) => `f/${APERTURE_WORDS[m[1].toLowerCase()]}`,
  },
  {
    field: "aperture",
    re: /\bat\s+(eight|eleven|sixteen)\b/gi,
    value: (m) => `f/${APERTURE_WORDS[m[1].toLowerCase()]}`,
  },
  // A bare word aperture ("eleven") only when it is the *entire* transcript
  // (modulo whitespace) — otherwise it's too ambiguous with other numbers.
  {
    field: "aperture",
    re: /^\s*(eight|eleven|sixteen)\s*$/gi,
    value: (m) => `f/${APERTURE_WORDS[m[1].toLowerCase()]}`,
  },
];

// ── compensation ──

const COMP_FRACTIONS: Record<string, string> = {
  "a third": "1/3",
  "one third": "1/3",
  "two thirds": "2/3",
  "a half": "1/2",
  "one half": "1/2",
  half: "1/2",
};

const COMP_RULES: Rule[] = [
  { field: "compensation", re: /(?<![\w/])([+-])\s?(\d\/\d|\d(?:\.\d)?)\b/g, value: (m) => `${m[1]}${m[2]}` },
  {
    field: "compensation",
    re: /\b(plus|minus)\s+(one|two|three)\s+and\s+(?:a\s+)?half\b/gi,
    value: (m) => `${m[1].toLowerCase() === "plus" ? "+" : "-"}${ONES[m[2].toLowerCase()]}.5`,
  },
  {
    field: "compensation",
    re: /\b(plus|minus)\s+(a third|one third|two thirds|a half|one half|half)\b/gi,
    value: (m) => `${m[1].toLowerCase() === "plus" ? "+" : "-"}${COMP_FRACTIONS[m[2].toLowerCase()]}`,
  },
  {
    field: "compensation",
    re: /\b(plus|minus)\s+(one|two|three|1|2|3)\b/gi,
    value: (m) => `${m[1].toLowerCase() === "plus" ? "+" : "-"}${ONES[m[2].toLowerCase()] ?? m[2]}`,
  },
];

// ── metering ──

const METER_RULES: Rule[] = [
  { field: "meteringMode", re: /\bsunny\s*(?:16|sixteen)\b/gi, value: () => "sunny 16" },
  { field: "meteringMode", re: /\bincident\b/gi, value: () => "incident" },
  { field: "meteringMode", re: /\bspot\b/gi, value: () => "spot" },
  { field: "meteringMode", re: /\baverage\b/gi, value: () => "average" },
  { field: "meteringMode", re: /\bcent(?:er|re)(?:[\s-]weighted)?\b/gi, value: () => "center" },
  { field: "meteringMode", re: /\bguess(?:ed|ing)?\b/gi, value: () => "guess" },
];

const COMMAND_RE = /\b(scratch that|delete (?:last|that)(?: one)?|delete the last(?: one)?)\b/i;

/**
 * Token-overlap gear match: the query label's tokens are checked against the
 * text; the longest (most specific) matching token wins, preferring tokens
 * that include a digit (model numbers, focal lengths) over generic brand
 * words ("leica", "mamiya").
 */
function matchGear(
  text: string,
  items: Array<{ id: string; label: string }>,
): { id: string; span: [number, number] } | null {
  const lower = text.toLowerCase();
  let best: { id: string; span: [number, number]; score: number } | null = null;
  for (const item of items) {
    const rawTokens = item.label.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
    // A token like "80mm" or "f4" also contributes its leading digit run
    // ("80") as its own candidate, so a spoken focal length ("80") matches
    // even though the transcript never says "millimeters".
    const digitTokens = rawTokens
      .map((t) => t.match(/^(\d+)[a-z]+$/)?.[1])
      .filter((t): t is string => !!t && t.length >= 2);
    const tokens = [...rawTokens, ...digitTokens];
    for (const tok of tokens) {
      const re = new RegExp(`\\b${tok.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      const m = re.exec(lower);
      if (!m) continue;
      const score = tok.length + (/\d/.test(tok) ? 10 : 0);
      if (!best || score > best.score) {
        best = { id: item.id, span: [m.index, m.index + tok.length], score };
      }
    }
  }
  return best ? { id: best.id, span: best.span } : null;
}

export function parseTranscript(text: string, gear?: GearIndex): ParseResult {
  const fields: ParsedFields = {};
  const spans: ParseSpan[] = [];
  let command: ParseResult["command"] = null;

  const cm = COMMAND_RE.exec(text);
  if (cm) {
    command = "delete_last";
    spans.push([cm.index, cm.index + cm[0].length, "command"]);
  }

  // Order matters: explicit / cue-based forms first so bare numbers don't
  // steal a span that belongs to a more specific field.
  apply(FRAME_RULES, text, fields, spans);
  apply(SHUTTER_RULES_EXPLICIT, text, fields, spans);
  apply(APERTURE_RULES, text, fields, spans);
  apply(COMP_RULES, text, fields, spans);
  apply(METER_RULES, text, fields, spans);
  apply(SHUTTER_BARE_RULES, text, fields, spans);

  if (gear) {
    const cam = matchGear(text, gear.cameras);
    if (cam && !overlaps(spans, cam.span[0], cam.span[1])) {
      fields.cameraId = cam.id;
      spans.push([cam.span[0], cam.span[1], "cameraId"]);
    }
    const lens = matchGear(text, gear.lenses);
    if (lens && !overlaps(spans, lens.span[0], lens.span[1])) {
      fields.lensId = lens.id;
      spans.push([lens.span[0], lens.span[1], "lensId"]);
    }
  }

  spans.sort((a, b) => a[0] - b[0]);
  return { fields, spans, command };
}
