import { describe, expect, it } from "vitest";
import { formatDevId, parseDevSeqRange } from "../src/dev-id.js";

describe("formatDevId", () => {
  it("formats a Dev Id as YYYYMMDD.NNNN", () => {
    expect(formatDevId("2026-08-15", 721)).toBe("20260815.0721");
  });

  it("zero-pads the sequence to four digits", () => {
    expect(formatDevId("2026-08-15", 1)).toBe("20260815.0001");
    expect(formatDevId("2026-08-15", 42)).toBe("20260815.0042");
  });

  it("keeps five-digit sequences intact", () => {
    expect(formatDevId("2026-08-15", 12345)).toBe("20260815.12345");
  });

  it("takes only the date portion of an ISO timestamp", () => {
    expect(formatDevId("2026-08-15T10:30:00.000Z", 721)).toBe("20260815.0721");
  });

  it("returns null unless both parts are present", () => {
    expect(formatDevId(null, 721)).toBeNull();
    expect(formatDevId(undefined, 721)).toBeNull();
    expect(formatDevId("2026-08-15", null)).toBeNull();
    expect(formatDevId("2026-08-15", undefined)).toBeNull();
  });

  it("treats seq 0 as present (not null)", () => {
    expect(formatDevId("2026-08-15", 0)).toBe("20260815.0000");
  });
});

describe("parseDevSeqRange", () => {
  it("parses a hyphenated range", () => {
    expect(parseDevSeqRange("717-735")).toEqual([717, 735]);
  });

  it("parses zero-padded bounds", () => {
    expect(parseDevSeqRange("0717-0735")).toEqual([717, 735]);
  });

  it("parses an en-dash range", () => {
    expect(parseDevSeqRange("717–735")).toEqual([717, 735]);
  });

  it("normalizes a reversed range to ascending", () => {
    expect(parseDevSeqRange("735-717")).toEqual([717, 735]);
  });

  it("treats a single number as a one-element range", () => {
    expect(parseDevSeqRange("721")).toEqual([721, 721]);
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseDevSeqRange("  717 - 735  ")).toEqual([717, 735]);
  });

  it("returns null for unparseable input", () => {
    expect(parseDevSeqRange("abc")).toBeNull();
    expect(parseDevSeqRange("717-")).toBeNull();
    expect(parseDevSeqRange("")).toBeNull();
  });
});
