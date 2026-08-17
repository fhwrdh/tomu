import { describe, expect, it } from "vitest";
import {
  HC110_DILUTIONS,
  MIN_CONCENTRATE_PER_ROLL_ML,
  computeDilution,
  findTank,
  normalizeDilution,
  parseDilutionRatio,
  rollEquivalents,
  TANKS,
} from "../src/dilution.js";

// These two assertions are guardrails, not trivia: human memory got HC-110 "H"
// wrong once (as 1+119) and it cost a 4-sheet LF batch a rescue calc. If this
// table ever regresses, that mistake comes back.
describe("HC-110 dilution table (canonical)", () => {
  it("H is 1+63, not 1+119", () => {
    expect(HC110_DILUTIONS.H).toBe("1+63");
  });
  it("matches Kodak's letter codes A–H", () => {
    expect(HC110_DILUTIONS).toMatchObject({
      A: "1+15",
      B: "1+31",
      C: "1+19",
      D: "1+39",
      E: "1+47",
      F: "1+79",
      G: "1+119",
      H: "1+63",
    });
  });
});

describe("parseDilutionRatio", () => {
  it("parses + and : separators, with or without spaces", () => {
    expect(parseDilutionRatio("1+31")).toEqual({ concentrate: 1, water: 31 });
    expect(parseDilutionRatio("1:31")).toEqual({ concentrate: 1, water: 31 });
    expect(parseDilutionRatio("1 + 31")).toEqual({ concentrate: 1, water: 31 });
  });
  it("resolves HC-110 letters, case-insensitively", () => {
    expect(parseDilutionRatio("B")).toEqual({ concentrate: 1, water: 31 });
    expect(parseDilutionRatio("h")).toEqual({ concentrate: 1, water: 63 });
  });
  it("accepts decimal ratios", () => {
    expect(parseDilutionRatio("1+62.5")).toEqual({ concentrate: 1, water: 62.5 });
  });
  it("returns null for junk", () => {
    expect(parseDilutionRatio("garbage")).toBeNull();
    expect(parseDilutionRatio("")).toBeNull();
    expect(parseDilutionRatio("Z")).toBeNull();
  });
});

describe("normalizeDilution", () => {
  it("canonicalizes to concentrate+water", () => {
    expect(normalizeDilution("HC-110", "1:31")).toBe("1+31");
    expect(normalizeDilution("HC-110", "B")).toBe("1+31");
  });
  it("returns empty string for no dilution", () => {
    expect(normalizeDilution("HC-110", null)).toBe("");
  });
  it("falls back to the trimmed original when unparseable", () => {
    expect(normalizeDilution(null, "  weird  ")).toBe("weird");
  });
});

describe("rollEquivalents", () => {
  it("counts 4 sheets of 4x5 as one roll-equivalent", () => {
    expect(rollEquivalents("4x5", 4)).toBe(1);
    expect(rollEquivalents("4x5", 8)).toBe(2);
  });
  it("counts 35mm and 120 one-for-one", () => {
    expect(rollEquivalents("35mm", 3)).toBe(3);
    expect(rollEquivalents("120", 2)).toBe(2);
  });
});

describe("computeDilution", () => {
  it("splits a target volume by the ratio (docstring example)", () => {
    const r = computeDilution("HC-110", "B", 500, 2);
    expect(r).not.toBeNull();
    expect(r!.dilution).toBe("1+31");
    expect(r!.concentrateMl).toBe(15.6);
    expect(r!.waterMl).toBe(484.4);
    expect(r!.warnings).toEqual([]);
    expect(r!.belowMinConcentrate).toBe(false);
  });

  it("accepts an HC-110 letter as the dilution", () => {
    const r = computeDilution("HC-110", "H", 510);
    expect(r!.dilution).toBe("1+63");
    // 510 / 64 = 7.97 → 8.0 ml concentrate
    expect(r!.concentrateMl).toBe(8);
  });

  it("warns when concentrate falls below the per-roll floor — and forbids a dilution change", () => {
    // Rodinal 1+50 in 300 ml for 1 roll: 300/51 = 5.9 ml < 10 ml floor.
    const r = computeDilution("Rodinal", "1+50", 300, 1);
    expect(r!.belowMinConcentrate).toBe(true);
    expect(r!.warnings).toHaveLength(1);
    expect(r!.warnings[0]).toMatch(/bigger tank/);
    expect(r!.warnings[0]).toMatch(/do not change the dilution/);
  });

  it("does not warn when volume clears the floor", () => {
    // Rodinal 1+50 in 510 ml for 1 roll: 510/51 = 10 ml == floor, ok.
    const r = computeDilution("Rodinal", "1+50", 510, 1);
    expect(r!.belowMinConcentrate).toBe(false);
    expect(r!.warnings).toEqual([]);
  });

  it("returns null on bad input", () => {
    expect(computeDilution("HC-110", "garbage", 500)).toBeNull();
    expect(computeDilution("HC-110", "1+31", 0)).toBeNull();
    expect(computeDilution("HC-110", "1+31", -5)).toBeNull();
  });
});

describe("findTank", () => {
  it("resolves by key, name, and shorthand", () => {
    expect(findTank("sp-445")?.name).toBe("Stearman SP-445");
    expect(findTank("SP445")?.name).toBe("Stearman SP-445");
    expect(findTank("stearman")?.name).toBe("Stearman SP-445");
    expect(findTank("jobo")?.name).toContain("Jobo");
    expect(findTank("mod54")?.name).toContain("MOD54");
    expect(findTank("paterson 3-reel")?.volumeMl).toBe(1000);
    expect(findTank("paterson")?.volumeMl).toBe(500);
  });
  it("returns null when nothing matches", () => {
    expect(findTank("nonexistent tank")).toBeNull();
  });
});

describe("min-concentrate floors", () => {
  it("carry the documented per-roll minimums", () => {
    expect(MIN_CONCENTRATE_PER_ROLL_ML["HC-110"]).toBe(6);
    expect(MIN_CONCENTRATE_PER_ROLL_ML.Rodinal).toBe(10);
  });
  it("the SP-445 holds four 4x5 sheets", () => {
    expect(TANKS["sp-445"].capacity).toEqual([{ format: "4x5", count: 4 }]);
  });
});
