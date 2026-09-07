import { describe, expect, it } from "vitest";
import { captureToFrame, formatCaptureId, parseCaptureId } from "../src/capture.js";

describe("formatCaptureId", () => {
  it("prefixes with C and no padding", () => {
    expect(formatCaptureId(412)).toBe("C412");
    expect(formatCaptureId(1)).toBe("C1");
  });
});

describe("parseCaptureId", () => {
  it("accepts C412, c412, 412, and whitespace", () => {
    expect(parseCaptureId("C412")).toBe(412);
    expect(parseCaptureId("c412")).toBe(412);
    expect(parseCaptureId("412")).toBe(412);
    expect(parseCaptureId("  C412 ")).toBe(412);
  });
  it("rejects anything else", () => {
    expect(parseCaptureId("")).toBeNull();
    expect(parseCaptureId("C")).toBeNull();
    expect(parseCaptureId("C-412")).toBeNull();
    expect(parseCaptureId("20260906.1")).toBeNull();
    expect(parseCaptureId("0")).toBeNull();
  });
});

describe("captureToFrame", () => {
  const base = {
    lensId: "11111111-1111-1111-1111-111111111111",
    shutterSpeed: "1/250",
    aperture: "f/8",
    compensation: "+1",
    meteringMode: "spot",
    subject: "courtyard",
    locationName: "Kyoto",
    notes: "hazy",
    sceneDescription: "stone lantern by a pond",
    capturedAt: "2026-09-06T10:00:00.000Z",
    photoTakenAt: "2026-09-06T09:58:30.000Z",
    latitude: 35.0116,
    longitude: 135.7681,
  };

  it("copies settings and uses the photo time as shotAt", () => {
    const f = captureToFrame(base, 7);
    expect(f).toEqual({
      frameNumber: 7,
      lensId: base.lensId,
      shutterSpeed: "1/250",
      aperture: "f/8",
      compensation: "+1",
      meteringMode: "spot",
      subject: "courtyard",
      locationName: "Kyoto",
      notes: "hazy",
      latitude: 35.0116,
      longitude: 135.7681,
      shotAt: "2026-09-06T09:58:30.000Z",
    });
  });

  it("falls back to capturedAt when there is no photo time", () => {
    const f = captureToFrame({ ...base, photoTakenAt: undefined }, 7);
    expect(f.shotAt).toBe("2026-09-06T10:00:00.000Z");
  });

  it("maps null and undefined fields to null", () => {
    const f = captureToFrame({ capturedAt: base.capturedAt, shutterSpeed: null }, 1);
    expect(f.shutterSpeed).toBeNull();
    expect(f.lensId).toBeNull();
    expect(f.latitude).toBeNull();
  });
});
