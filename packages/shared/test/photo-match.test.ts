import { describe, expect, it } from "vitest";
import { matchPhotos, type CandidatePhoto, type MatchCapture } from "../src/photo-match.js";

const T0 = Date.parse("2026-09-06T10:00:00Z");
const min = (m: number) => m * 60_000;
const sec = (s: number) => s * 1000;

function cap(id: string, offsetMs = 0, extra: Partial<MatchCapture> = {}): MatchCapture {
  return { id, capturedAt: new Date(T0 + offsetMs).toISOString(), ...extra };
}
function photo(uuid: string, offsetMs: number): CandidatePhoto {
  return { uuid, takenAt: new Date(T0 + offsetMs).toISOString() };
}

describe("matchPhotos", () => {
  it("matches the single photo inside the window", () => {
    const r = matchPhotos([cap("a")], [photo("p1", -min(3))]);
    expect(r).toEqual([{ captureId: "a", status: "matched", photoUuid: "p1", deltaSeconds: -180 }]);
  });

  it("ignores photos outside [-10 min, +2 min]", () => {
    const r = matchPhotos([cap("a")], [photo("p1", -min(11)), photo("p2", min(3))]);
    expect(r[0].status).toBe("none");
  });

  it("accepts the window edges inclusively", () => {
    const r = matchPhotos([cap("a")], [photo("p1", -min(10))]);
    expect(r[0].status).toBe("matched");
    const r2 = matchPhotos([cap("b")], [photo("p2", min(2))]);
    expect(r2[0].status).toBe("matched");
  });

  it("picks the nearest photo, preferring before on a tie", () => {
    const r = matchPhotos([cap("a")], [photo("before", -sec(40)), photo("after", sec(40))]);
    expect(r[0]).toMatchObject({ status: "matched", photoUuid: "before" });
  });

  it("is ambiguous when the two nearest are within 30 s of each other", () => {
    const r = matchPhotos([cap("a")], [photo("p1", -sec(60)), photo("p2", -sec(80))]);
    expect(r[0]).toMatchObject({ status: "ambiguous" });
    expect(r[0].candidates?.map((c) => c.uuid)).toEqual(["p1", "p2"]);
  });

  it("is not ambiguous when the runner-up is more than 30 s further away", () => {
    const r = matchPhotos([cap("a")], [photo("p1", -sec(60)), photo("p2", -sec(100))]);
    expect(r[0]).toMatchObject({ status: "matched", photoUuid: "p1" });
  });

  it("skips photos already attached to another capture", () => {
    const r = matchPhotos([cap("a")], [photo("p1", -min(1))], { usedAssetIds: new Set(["p1"]) });
    expect(r[0].status).toBe("none");
  });

  it("never gives one photo to two captures — both become ambiguous", () => {
    const r = matchPhotos([cap("a"), cap("b", sec(30))], [photo("p1", -sec(10))]);
    expect(r.map((x) => x.status)).toEqual(["ambiguous", "ambiguous"]);
  });

  it("assigns distinct photos to distinct captures in order", () => {
    const r = matchPhotos([cap("a"), cap("b", min(5))], [photo("p1", -sec(20)), photo("p2", min(5) - sec(20))]);
    expect(r.map((x) => [x.captureId, x.photoUuid])).toEqual([["a", "p1"], ["b", "p2"]]);
  });

  it("honours a forced pairing regardless of time", () => {
    const r = matchPhotos([cap("a")], [photo("far", min(60))], { forced: new Map([["a", "far"]]) });
    expect(r[0]).toMatchObject({ status: "matched", photoUuid: "far", forced: true });
  });

  it("respects custom window sizes", () => {
    const r = matchPhotos([cap("a")], [photo("p1", -min(20))], { windowBeforeMin: 30, windowAfterMin: 0 });
    expect(r[0].status).toBe("matched");
  });

  it("prevents cross-capture double-assignment when forced and unforced share a photo", () => {
    const r = matchPhotos([cap("a"), cap("b", sec(30))], [photo("p1", -sec(10))], { forced: new Map([["b", "p1"]]) });
    expect(r.map((x) => [x.captureId, x.status, x.photoUuid, x.forced])).toEqual([
      ["a", "none", undefined, undefined],
      ["b", "matched", "p1", true],
    ]);
  });

  it("forced pairing overrides usedAssetIds", () => {
    const r = matchPhotos([cap("a")], [photo("p1", -sec(10))], { usedAssetIds: new Set(["p1"]), forced: new Map([["a", "p1"]]) });
    expect(r[0]).toMatchObject({ status: "matched", photoUuid: "p1", forced: true });
  });

  it("throws when two captures have forced pairings to the same photo", () => {
    expect(() => {
      matchPhotos([cap("a"), cap("b")], [photo("p1", -sec(10))], { forced: new Map([["a", "p1"], ["b", "p1"]]) });
    }).toThrow(/Forced pairing conflict.*p1.*a.*b/);
  });

  it("handles empty input", () => {
    const r = matchPhotos([], []);
    expect(r).toEqual([]);
  });
});
