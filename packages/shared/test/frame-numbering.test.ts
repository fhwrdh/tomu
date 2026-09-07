import { describe, expect, it } from "vitest";
import { nextFrameNumber } from "../src/frame-numbering.js";

describe("nextFrameNumber", () => {
  it("spoken number wins, even out of order", () => {
    expect(nextFrameNumber({ spoken: 12, highestNoted: 4, format: "35mm" })).toEqual({ frameNumber: 12, provisional: false });
    expect(nextFrameNumber({ spoken: 3, highestNoted: 12, format: "35mm" })).toEqual({ frameNumber: 3, provisional: false });
  });
  it("provisional next after the highest noted", () => {
    expect(nextFrameNumber({ highestNoted: 4, format: "35mm" })).toEqual({ frameNumber: 5, provisional: true });
    expect(nextFrameNumber({ highestNoted: null, format: "120" })).toEqual({ frameNumber: 1, provisional: true });
  });
  it("sheet formats never get a provisional number", () => {
    expect(nextFrameNumber({ highestNoted: 2, format: "4x5" })).toEqual({ frameNumber: null, provisional: false });
    expect(nextFrameNumber({ spoken: 3, highestNoted: 2, format: "8x10" })).toEqual({ frameNumber: 3, provisional: false });
  });
});
