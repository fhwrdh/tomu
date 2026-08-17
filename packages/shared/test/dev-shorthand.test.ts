import { describe, expect, it } from "vitest";
import { parseDevShorthand } from "../src/dev-shorthand.js";

describe("parseDevShorthand — HC-110 letter codes", () => {
  it("parses a letter + decimal minutes", () => {
    // B7.5 → dilution B, 7m30s
    expect(parseDevShorthand("B7.5")).toEqual({ raw: "B7.5", dilution: "B", devTimeSeconds: 450 });
  });
  it("parses a letter + M:SS time", () => {
    expect(parseDevShorthand("E10:40")).toEqual({ raw: "E10:40", dilution: "E", devTimeSeconds: 640 });
  });
  it("uppercases the letter", () => {
    expect(parseDevShorthand("h10").dilution).toBe("H");
  });
});

describe("parseDevShorthand — Massive Dev ratio form", () => {
  it("parses ratio / minutes", () => {
    expect(parseDevShorthand("1:50/8mins")).toEqual({
      raw: "1:50/8mins",
      dilution: "1:50",
      devTimeSeconds: 480,
    });
  });
  it("tolerates spaces around the slash and unit", () => {
    expect(parseDevShorthand("1:25 / 13 mins")).toMatchObject({ dilution: "1:25", devTimeSeconds: 780 });
  });
});

describe("parseDevShorthand — bare time", () => {
  it("reads a bare decimal as minutes", () => {
    expect(parseDevShorthand("7.5")).toEqual({ raw: "7.5", dilution: null, devTimeSeconds: 450 });
  });
  it("reads M:SS", () => {
    expect(parseDevShorthand("10:40")).toMatchObject({ dilution: null, devTimeSeconds: 640 });
  });
  it("reads a minutes unit", () => {
    expect(parseDevShorthand("8mins")).toMatchObject({ dilution: null, devTimeSeconds: 480 });
  });
});

describe("parseDevShorthand — unparseable", () => {
  it("returns null fields but always preserves the raw string", () => {
    expect(parseDevShorthand("no idea")).toEqual({ raw: "no idea", dilution: null, devTimeSeconds: null });
  });
  it("rejects an out-of-range seconds component", () => {
    // 61 seconds is invalid in M:SS
    expect(parseDevShorthand("10:61").devTimeSeconds).toBeNull();
  });
});
