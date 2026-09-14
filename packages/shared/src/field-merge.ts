/** Merge a tier-2 (model) parse into an event's current fields. Tier 1 wins unless the
 * model is ≥ 0.9 confident; hand-edited fields are never touched; empties are filled.
 * A field the model says was taken back is never filled and never cleared — it is
 * reported in `retracted` so the event can go to review (owner decision, 2026-09-14:
 * no model erases a recorded value on its own). */
export const PARSED_FIELD_NAMES = ["shutterSpeed", "aperture", "compensation", "meteringMode", "lensId", "subject", "locationName"] as const;
export type ParsedFieldName = (typeof PARSED_FIELD_NAMES)[number];

export interface Tier2Result {
  fields: Partial<Record<ParsedFieldName, string | null>>;
  confidence: Partial<Record<ParsedFieldName, number>>;
  cameraId?: string | null;
  remarks?: string;
  sceneDescription?: string;
  reviewReason?: string | null;
  /** Fields the speaker explicitly took back ("plus one, never mind"). */
  retracted?: ParsedFieldName[] | null;
}

export const TIER2_OVERRIDE_CONFIDENCE = 0.9;

/**
 * @param threshold Confidence at or above which tier 2 may overwrite a tier-1 value.
 * A parameter only so the eval harness can sweep it (`evals/field-parse`); production
 * always takes the default. Changing the default changes the policy.
 */
export function mergeParse(
  current: Record<ParsedFieldName, string | null | undefined>,
  tier2: Tier2Result,
  editedFields: string[],
  threshold: number = TIER2_OVERRIDE_CONFIDENCE,
): {
  fields: Partial<Record<ParsedFieldName, string | null>>;
  changed: ParsedFieldName[];
  /** Retracted fields that still hold a value and were not hand-edited: review these. */
  retracted: ParsedFieldName[];
} {
  const out: Partial<Record<ParsedFieldName, string | null>> = {};
  const edited = new Set(editedFields);
  const takenBack = new Set(tier2.retracted ?? []);
  for (const name of PARSED_FIELD_NAMES) {
    const v = tier2.fields[name];
    if (v == null || v === "") continue;
    if (edited.has(name) || takenBack.has(name)) continue;
    const have = current[name];
    const conf = tier2.confidence[name] ?? 0;
    if (have == null || have === "" || conf >= threshold) {
      if (have !== v) out[name] = v;
    }
  }
  const retracted = PARSED_FIELD_NAMES.filter((name) => {
    const have = current[name];
    return takenBack.has(name) && !edited.has(name) && have != null && have !== "";
  });
  return { fields: out, changed: (Object.keys(out) as ParsedFieldName[]).sort(), retracted };
}
