import { describe, expect, it } from "vitest";
import { eventToFrame } from "../src/field-event.js";

describe("eventToFrame", () => {
  const e = {
    capturedAt: "2026-09-06T22:45:00.000Z",
    latitude: "47.7531617", longitude: "-122.6557617",
    shutterSpeed: "1/250", aperture: "f/8", compensation: "+1", meteringMode: "spot",
    lensId: "11111111-1111-1111-1111-111111111111", subject: "kitchen window", locationName: "home",
  };
  it("copies settings, uses capturedAt as shotAt, parses numeric strings", () => {
    expect(eventToFrame(e, 7)).toEqual({
      frameNumber: 7, lensId: e.lensId, shutterSpeed: "1/250", aperture: "f/8", compensation: "+1", meteringMode: "spot",
      subject: "kitchen window", locationName: "home", notes: null, latitude: 47.7531617, longitude: -122.6557617,
      shotAt: "2026-09-06T22:45:00.000Z",
    });
  });
  it("maps missing values to null", () => {
    const f = eventToFrame({ capturedAt: new Date("2026-09-06T22:45:00Z") }, 1);
    expect(f.lensId).toBeNull(); expect(f.latitude).toBeNull(); expect(f.shotAt).toBe("2026-09-06T22:45:00.000Z");
  });
});
