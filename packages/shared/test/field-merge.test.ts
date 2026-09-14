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
  // The threshold is a parameter only so the eval harness can sweep it
  // (evals/field-parse --sweep). Production always takes the default.
  it("takes an explicit threshold in place of the default", () => {
    const tier2 = { fields: { aperture: "f/11" }, confidence: { aperture: 0.7 } };
    expect(mergeParse(current, tier2, []).fields).toEqual({});
    expect(mergeParse(current, tier2, [], 0.6).fields).toEqual({ aperture: "f/11" });
    expect(mergeParse(current, tier2, [], 0.8).fields).toEqual({});
  });
  it("still refuses a hand-edited field at any threshold", () => {
    const tier2 = { fields: { aperture: "f/11" }, confidence: { aperture: 1 } };
    expect(mergeParse(current, tier2, ["aperture"], 0).fields).toEqual({});
  });
});

// A retraction ("plus one, never mind") is reported, never applied: the merge must not
// erase a value, so the event goes to review and a person decides (owner, 2026-09-14).
describe("mergeParse retractions", () => {
  const withComp = { ...current, compensation: "+1" };

  it("reports a retracted field that still holds a value, and leaves the value alone", () => {
    const r = mergeParse(withComp, { fields: {}, confidence: {}, retracted: ["compensation"] }, []);
    expect(r.fields).toEqual({});
    expect(r.retracted).toEqual(["compensation"]);
  });

  it("does not report a retracted field that is already empty", () => {
    const r = mergeParse(current, { fields: {}, confidence: {}, retracted: ["compensation"] }, []);
    expect(r.retracted).toEqual([]);
  });

  it("does not report a hand-edited field — the person already decided", () => {
    const r = mergeParse(withComp, { fields: {}, confidence: {}, retracted: ["compensation"] }, ["compensation"]);
    expect(r.retracted).toEqual([]);
  });

  it("never fills a field the model says was taken back", () => {
    const r = mergeParse(current, { fields: { compensation: "+1" }, confidence: { compensation: 1 }, retracted: ["compensation"] }, []);
    expect(r.fields).toEqual({});
    expect(r.retracted).toEqual([]);
  });

  it("reports nothing when the model lists no retractions", () => {
    expect(mergeParse(withComp, { fields: {}, confidence: {} }, []).retracted).toEqual([]);
    expect(mergeParse(withComp, { fields: {}, confidence: {}, retracted: null }, []).retracted).toEqual([]);
  });
});
