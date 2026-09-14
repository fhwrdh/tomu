import { describe, expect, it } from "vitest";
import { buildGearPatch, describeChanges, normalizeFormat } from "../src/gear-update.js";

describe("normalizeFormat", () => {
  it.each([
    ["35mm", "35mm"],
    ["35MM", "35mm"],
    ["35 mm", "35mm"],
    ["35", "35mm"],
    ["120", "120"],
    ["4X5", "4x5"],
    ["4 x 5", "4x5"],
    ["8x10", "8x10"],
    ["Other", "other"],
  ])("%s → %s", (input, want) => {
    expect(normalizeFormat(input)).toBe(want);
  });

  it("returns null for a format Tomu does not know", () => {
    expect(normalizeFormat("6x9")).toBeNull();
    expect(normalizeFormat("")).toBeNull();
  });
});

describe("buildGearPatch", () => {
  it("sends only the fields that were given, with the format normalised", () => {
    expect(buildGearPatch("camera", { format: "35MM" })).toEqual({ body: { format: "35mm" } });
    expect(buildGearPatch("camera", { make: "Chroma", notes: "35mm pinhole, no lens" })).toEqual({
      body: { make: "Chroma", notes: "35mm pinhole, no lens" },
    });
  });

  it("carries isActive, so gear can be retired without deleting its history", () => {
    expect(buildGearPatch("lens", { isActive: false })).toEqual({ body: { isActive: false } });
  });

  it("keeps camera-only and lens-only fields on their own kind", () => {
    expect(buildGearPatch("lens", { focalLengthMm: 40, maxAperture: "1.4", format: "35mm" })).toEqual({
      body: { focalLengthMm: 40, maxAperture: "1.4" },
    });
    expect(buildGearPatch("camera", { frameCount: 36, focalLengthMm: 40 })).toEqual({ body: { frameCount: 36 } });
  });

  it("explains an unknown format instead of sending it", () => {
    const r = buildGearPatch("camera", { format: "6x9" });
    expect(r.body).toBeUndefined();
    expect(r.error).toContain("6x9");
    expect(r.error).toContain("35mm");
  });

  it("says so when there is nothing to change", () => {
    const r = buildGearPatch("camera", {});
    expect(r.body).toBeUndefined();
    expect(r.error).toMatch(/nothing to change/i);
  });
});

describe("describeChanges", () => {
  it("names each field that changed, old to new", () => {
    const before = { make: "Chroma", model: "Cube", format: "4x5", notes: null };
    const after = { make: "Chroma", model: "Cube", format: "35mm", notes: "pinhole" };
    expect(describeChanges(before, after, ["format", "notes"])).toBe("format 4x5 → 35mm; notes — → pinhole");
  });

  it("reports a field that was sent but already had that value", () => {
    expect(describeChanges({ format: "35mm" }, { format: "35mm" }, ["format"])).toBe("format already 35mm");
  });
});
