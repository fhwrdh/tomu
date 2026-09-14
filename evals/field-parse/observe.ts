/**
 * Corpus loading, recording lookup, and the three observation functions the eval
 * scores. Shared by the CLI runner and the CI gate so both see the same numbers.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mergeParse, parseTranscript, type GearIndex, type Tier2Result } from "@tomu/shared";
import type { EvalCase, Observed } from "./score.js";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export const CASES: EvalCase[] = JSON.parse(readFileSync(here("./cases.json"), "utf8"));
export const GEAR: GearIndex = JSON.parse(readFileSync(here("./gear.json"), "utf8"));
export const RECORDINGS_DIR = here("./recordings/");
export const MODEL = process.env.FIELD_PARSE_MODEL || "claude-haiku-4-5";

export interface Recording {
  caseId: string;
  model: string;
  promptSha: string;
  transcript: string;
  recordedAt: string;
  /** Wall-clock for the model call, so "tier 1 is 45 µs" has something to sit next to. */
  latencyMs?: number;
  result: Tier2Result;
}

/** A recording is valid only for the exact (model, prompt, transcript) it was made under. */
export const keyFor = (model: string, promptSha: string, transcript: string) =>
  createHash("sha256").update(`${model}\n${promptSha}\n${transcript}`).digest("hex").slice(0, 16);

export function loadRecordings(): { byKey: Map<string, Recording>; all: Recording[] } {
  mkdirSync(RECORDINGS_DIR, { recursive: true });
  const all = readdirSync(RECORDINGS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(RECORDINGS_DIR + f, "utf8")) as Recording);
  return { byKey: new Map(all.map((r) => [keyFor(r.model, r.promptSha, r.transcript), r])), all };
}

/** The fields the merge policy reads, as production would hand them over. */
export function currentFrom(t1: Observed) {
  return {
    shutterSpeed: t1.shutterSpeed ?? null,
    aperture: t1.aperture ?? null,
    compensation: t1.compensation ?? null,
    meteringMode: t1.meteringMode ?? null,
    lensId: t1.lensId ?? null,
    subject: null,
    locationName: null,
  };
}

/** Tier 1's output, as the string values the scorer compares. */
export function tier1Of(c: EvalCase): Observed {
  const { fields, command } = parseTranscript(c.transcript, GEAR);
  const out: Observed = { command };
  for (const [k, v] of Object.entries(fields)) out[k] = v == null ? null : String(v);
  return out;
}

/** The model's answer on its own. `cameraId` sits outside `fields` in a Tier2Result. */
export function tier2Of(r: Recording): Observed {
  const out: Observed = {};
  for (const [k, v] of Object.entries(r.result.fields)) out[k] = v ?? null;
  if (r.result.cameraId) out.cameraId = r.result.cameraId;
  return out;
}

/** What the event would actually hold: tier 1, with the merge policy applied at `threshold`. */
export function mergedOf(c: EvalCase, r: Recording, threshold: number): Observed {
  const t1 = tier1Of(c);
  const merged = mergeParse(currentFrom(t1), r.result, [], threshold);
  const out: Observed = { ...t1 };
  for (const [k, v] of Object.entries(merged.fields)) out[k] = v ?? null;
  // The merge policy covers neither of these; production takes the model's cameraId only
  // when the event has none, and validates it against the user's gear.
  if (!out.cameraId && r.result.cameraId && GEAR.cameras.some((g) => g.id === r.result.cameraId)) {
    out.cameraId = r.result.cameraId;
  }
  return out;
}
