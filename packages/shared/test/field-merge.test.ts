import { describe, expect, it } from "vitest";
import { mergeParse } from "../src/field-merge.js";

const current = { shutterSpeed: "1/250", aperture: "f/8", compensation: null, meteringMode: null, lensId: null, subject: null, locationName: null };

describe("mergeParse", () => {
  it("fills empty fields from tier 2", () => {
    const r = mergeParse(current, { fields: { subject: "kitchen window", compensation: "+1" }, confidence: { subject: 0.8, compensation: 0.7 } }, []);
    expect(r.fields).toEqual({ subject: "kitchen window", compensation: "+1" });
    expect(r.changed).toEqual(["compensation", "subject"]);
  });
  it("keeps a tier-1 value unless tier-2 confidence >= 0.9", () => {
    const low = mergeParse(current, { fields: { aperture: "f/11" }, confidence: { aperture: 0.6 } }, []);
    expect(low.fields).toEqual({});
    const high = mergeParse(current, { fields: { aperture: "f/11" }, confidence: { aperture: 0.95 } }, []);
    expect(high.fields).toEqual({ aperture: "f/11" });
  });
  it("never touches edited fields", () => {
    const r = mergeParse(current, { fields: { aperture: "f/11", subject: "x" }, confidence: { aperture: 1, subject: 1 } }, ["aperture"]);
    expect(r.fields).toEqual({ subject: "x" });
  });
  it("ignores null and undefined tier-2 values and unknown keys", () => {
    const r = mergeParse(current, { fields: { subject: null, locationName: undefined, bogus: "x" } as never, confidence: {} }, []);
    expect(r.fields).toEqual({});
  });
  it("treats a missing confidence as 0", () => {
    const r = mergeParse(current, { fields: { shutterSpeed: "1/500" }, confidence: {} }, []);
    expect(r.fields).toEqual({});
  });
});
