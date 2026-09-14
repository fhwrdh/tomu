/**
 * Scoring for the field-parse eval. Separate from the runner so the CI gate
 * (`eval.test.ts`) and the CLI report agree on what counts as a mistake.
 *
 * Four outcomes, and the distinction that matters is the last two:
 *   hit       expected a value, got it
 *   miss      expected a value, got nothing
 *   wrong     expected a value, got a different one
 *   spurious  expected nothing, got a value
 *
 * A miss costs a field the photographer can still fill in at the desk. A `wrong` or
 * `spurious` value is a lie in the log that looks like data — the f/50 class. They are
 * summed separately as `harm`, and harm is the number the gate is set against.
 */
export const STRUCTURED_FIELDS = [
  "shutterSpeed", "aperture", "compensation", "meteringMode",
  "frameNumber", "sheetId", "cameraId", "lensId",
] as const;

/**
 * Free text, so exact match is the wrong test — scored by containment, and only when a
 * case states an expectation. A model that volunteers a subject where the corpus says
 * nothing is not making a mistake, so these never score `spurious`.
 */
export const FREE_TEXT_FIELDS = ["subject", "locationName"] as const;

export type Outcome = "hit" | "miss" | "wrong" | "spurious";

export interface EvalCase {
  id: string;
  source: "field" | "reconstructed" | "synthetic";
  provenance: string;
  transcript: string;
  expect: Record<string, string>;
  tier2Expect?: Record<string, string>;
  expectCommand?: string;
}

export interface FieldScore {
  field: string;
  expected: string | null;
  observed: string | null;
  outcome: Outcome;
}

export type Observed = Record<string, string | null | undefined>;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** Containment either way: "kitchen window" vs "the kitchen window again" both pass. */
const textMatches = (expected: string, observed: string) => {
  const [e, o] = [norm(expected), norm(observed)];
  return e.length > 0 && o.length > 0 && (o.includes(e) || e.includes(o));
};

/**
 * Score one case. Structured fields are strict: a field absent from `expect` must come
 * back empty, which is what turns a hallucinated aperture into a reported `spurious`
 * rather than an unnoticed extra.
 */
export function scoreCase(c: EvalCase, observed: Observed): FieldScore[] {
  const out: FieldScore[] = [];

  for (const field of STRUCTURED_FIELDS) {
    const expected = c.expect[field] ?? null;
    const got = observed[field] == null ? null : String(observed[field]);
    if (expected == null && got == null) continue;
    const outcome: Outcome =
      expected == null ? "spurious" : got == null ? "miss" : got === expected ? "hit" : "wrong";
    out.push({ field, expected, observed: got, outcome });
  }

  for (const field of FREE_TEXT_FIELDS) {
    const expected = c.tier2Expect?.[field];
    if (expected == null) continue;
    const got = observed[field] == null ? null : String(observed[field]);
    const outcome: Outcome = got == null ? "miss" : textMatches(expected, got) ? "hit" : "wrong";
    out.push({ field, expected, observed: got, outcome });
  }

  if (c.expectCommand) {
    const got = observed.command == null ? null : String(observed.command);
    out.push({
      field: "command",
      expected: c.expectCommand,
      observed: got,
      outcome: got === c.expectCommand ? "hit" : got == null ? "miss" : "wrong",
    });
  }

  return out;
}

export interface Tally { hit: number; miss: number; wrong: number; spurious: number }

export function tally(scores: FieldScore[]): Tally {
  const t: Tally = { hit: 0, miss: 0, wrong: 0, spurious: 0 };
  for (const s of scores) t[s.outcome]++;
  return t;
}

/** Values that are not true. The metric to minimise; a missing field is not in it. */
export const harm = (t: Tally) => t.wrong + t.spurious;
export const scored = (t: Tally) => t.hit + t.miss + t.wrong + t.spurious;
