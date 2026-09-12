/**
 * The eval's own gate. Three jobs, in order of how much they'd cost to get wrong:
 *
 * 1. Tier 1 must produce no wrong or spurious value on the whole corpus. This is the
 *    f/50 regression, generalised: tier 1 runs offline on every note, so a value it
 *    invents is a lie in the log that nothing else will catch.
 * 2. The scorer must be right, since (1) is only as good as the thing counting.
 * 3. Corpus hygiene: every case carries a provenance, so "here is my eval set" can be
 *    answered with where each row came from.
 *
 * Tier-2 assertions run only when recordings exist (they need one model call each, so
 * they are not in the committed state — see the eval README).
 */
import { describe, expect, it } from "vitest";
import { PARSED_FIELD_NAMES, TIER2_OVERRIDE_CONFIDENCE, mergeParse } from "@tomu/shared";
import { harm, scoreCase, tally, type EvalCase } from "./score.js";
import { CASES, MODEL, currentFrom, keyFor, loadRecordings, mergedOf, tier1Of } from "./observe.js";

const { byKey, all } = loadRecordings();

describe("scorer", () => {
  const base: EvalCase = {
    id: "t", source: "synthetic", provenance: "unit test", transcript: "x",
    expect: { aperture: "f/8" },
  };

  it("scores an exact structured match as a hit", () => {
    expect(scoreCase(base, { aperture: "f/8" })).toEqual([
      { field: "aperture", expected: "f/8", observed: "f/8", outcome: "hit" },
    ]);
  });

  it("distinguishes a miss from a wrong value", () => {
    expect(scoreCase(base, {})[0].outcome).toBe("miss");
    expect(scoreCase(base, { aperture: "f/11" })[0].outcome).toBe("wrong");
  });

  it("calls an unexpected structured value spurious — the f/50 class", () => {
    const c: EvalCase = { ...base, expect: {} };
    const scores = scoreCase(c, { aperture: "f/50" });
    expect(scores).toHaveLength(1);
    expect(scores[0].outcome).toBe("spurious");
    expect(harm(tally(scores))).toBe(1);
  });

  it("does not score a field that is empty and expected to be", () => {
    expect(scoreCase({ ...base, expect: {} }, {})).toEqual([]);
  });

  it("counts a miss as no harm — a blank is not a lie", () => {
    expect(harm(tally(scoreCase(base, {})))).toBe(0);
  });

  it("scores free text by containment, in either direction", () => {
    const c: EvalCase = { ...base, expect: {}, tier2Expect: { subject: "kitchen window" } };
    expect(scoreCase(c, { subject: "the kitchen window again" })[0].outcome).toBe("hit");
    expect(scoreCase(c, { subject: "window" })[0].outcome).toBe("hit");
    expect(scoreCase(c, { subject: "a ferry deck" })[0].outcome).toBe("wrong");
    expect(scoreCase(c, {})[0].outcome).toBe("miss");
  });

  it("never scores free text the corpus does not ask for", () => {
    expect(scoreCase(base, { aperture: "f/8", subject: "volunteered" })).toHaveLength(1);
  });
});

describe("tier 1 over the corpus", () => {
  it("invents nothing: no wrong or spurious value in any case", () => {
    const offenders = CASES.flatMap((c) =>
      scoreCase(c, tier1Of(c))
        .filter((s) => s.outcome === "wrong" || s.outcome === "spurious")
        .map((s) => `${c.id}: ${s.field} expected ${s.expected ?? "—"}, got ${s.observed}`),
    );
    expect(offenders).toEqual([]);
  });

  it("misses only fields tier 1 cannot produce", () => {
    // Every structured field is tier 1's job; subject and locationName are tier 2's.
    // If this list grows a structured field, tier 1 regressed.
    const missed = new Set(
      CASES.flatMap((c) => scoreCase(c, tier1Of(c)).filter((s) => s.outcome === "miss").map((s) => s.field)),
    );
    expect([...missed].sort()).toEqual(["locationName", "subject"]);
  });
});

describe("corpus hygiene", () => {
  it("has unique ids", () => {
    expect(new Set(CASES.map((c) => c.id)).size).toBe(CASES.length);
  });

  it.each(CASES.map((c) => [c.id, c] as const))("%s states a transcript and its provenance", (_id, c) => {
    expect(c.transcript.trim().length).toBeGreaterThan(0);
    expect(["field", "reconstructed", "synthetic"]).toContain(c.source);
    // "field" means the wording itself is real, so it has to say where it is preserved.
    expect(c.provenance.trim().length).toBeGreaterThan(20);
  });
});

describe.skipIf(all.length === 0)("recordings", () => {
  it("are keyed by the model and prompt they were made under", () => {
    // A recording whose filename key disagrees with its contents would be scored
    // against the wrong prompt; the runner reports these as stale instead.
    for (const r of all) {
      expect(byKey.get(keyFor(r.model, r.promptSha, r.transcript))).toBe(r);
    }
  });

  it("carry every merged field", () => {
    for (const r of all) {
      for (const field of PARSED_FIELD_NAMES) expect(r.result.fields).toHaveProperty(field);
    }
  });

  it("never let the merge overwrite a hand-edited field", () => {
    for (const r of all) {
      const c = CASES.find((x) => x.id === r.caseId);
      if (!c) continue;
      const current = currentFrom(tier1Of(c));
      for (const field of PARSED_FIELD_NAMES) {
        const merged = mergeParse(current, r.result, [field], TIER2_OVERRIDE_CONFIDENCE);
        expect(merged.fields).not.toHaveProperty(field);
      }
    }
  });

  it("do not make the merged result more harmful than tier 1 alone", () => {
    for (const r of all) {
      const c = CASES.find((x) => x.id === r.caseId);
      if (!c) continue;
      const t1 = harm(tally(scoreCase(c, tier1Of(c))));
      const merged = harm(tally(scoreCase(c, mergedOf(c, r, TIER2_OVERRIDE_CONFIDENCE))));
      expect(merged, `${c.id}: merging ${MODEL} made it worse`).toBeLessThanOrEqual(t1);
    }
  });
});
