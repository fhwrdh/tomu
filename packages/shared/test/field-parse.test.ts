import { describe, expect, it } from "vitest";
import { parseTranscript } from "../src/field-parse.js";

const gear = {
  cameras: [
    { id: "cam-m6", label: "Leica M6" },
    { id: "cam-m7", label: "Mamiya 7" },
    { id: "cam-crown", label: "Graflex Crown Graphic" },
  ],
  lenses: [
    { id: "lens-35", label: "Leica Summicron 35mm" },
    { id: "lens-80", label: "Mamiya 80mm f/4" },
  ],
};

describe("shutter", () => {
  it.each([
    ["1/250", "1/250"],
    ["at 250", "1/250"],
    ["a two-fiftieth", "1/250"],
    ["two fifty", "1/250"],
    ["one sixty", "1/60"],
    ["1/1000", "1/1000"],
    ["two seconds", "2s"],
    ["2s", "2s"],
    ["half a second", "1/2"],
    ["bulb", "B"],
  ])("%s → %s", (text, want) => {
    expect(parseTranscript(text).fields.shutterSpeed).toBe(want);
  });
});

describe("aperture", () => {
  it.each([
    ["f8", "f/8"],
    ["f/8", "f/8"],
    ["f 8", "f/8"],
    ["at f eight", "f/8"],
    ["five six", "f/5.6"],
    ["f5.6", "f/5.6"],
    ["two point eight", "f/2.8"],
    ["f/2.8", "f/2.8"],
    ["eleven", "f/11"],
    ["wide open", undefined],
  ])("%s → %s", (text, want) => {
    expect(parseTranscript(text).fields.aperture).toBe(want);
  });
});

describe("compensation and metering", () => {
  it("reads plus/minus fractions", () => {
    expect(parseTranscript("plus one").fields.compensation).toBe("+1");
    expect(parseTranscript("+1").fields.compensation).toBe("+1");
    expect(parseTranscript("minus a third").fields.compensation).toBe("-1/3");
    expect(parseTranscript("-2/3").fields.compensation).toBe("-2/3");
    expect(parseTranscript("plus two thirds").fields.compensation).toBe("+2/3");
    expect(parseTranscript("plus one and a half").fields.compensation).toBe("+1.5");
  });
  it("reads metering words", () => {
    expect(parseTranscript("spot on the wall").fields.meteringMode).toBe("spot");
    expect(parseTranscript("incident reading").fields.meteringMode).toBe("incident");
    expect(parseTranscript("sunny sixteen").fields.meteringMode).toBe("sunny 16");
    expect(parseTranscript("sunny 16").fields.meteringMode).toBe("sunny 16");
    expect(parseTranscript("just a guess").fields.meteringMode).toBe("guess");
  });
});

describe("frame and sheet", () => {
  it("reads spoken frame numbers only with a frame/number cue", () => {
    expect(parseTranscript("frame 12 of the lake").fields.frameNumber).toBe(12);
    expect(parseTranscript("number twelve").fields.frameNumber).toBe(12);
    expect(parseTranscript("twelve people on the beach").fields.frameNumber).toBeUndefined();
  });
  it("reads sheet holder ids", () => {
    expect(parseTranscript("holder 3 a").fields.sheetId).toBe("3A");
    expect(parseTranscript("sheet 3b").fields.sheetId).toBe("3B");
  });
});

describe("gear", () => {
  it("matches camera and lens by fuzzy tokens", () => {
    const r = parseTranscript("on the m6 with the summicron, two fifty at f8", gear);
    expect(r.fields.cameraId).toBe("cam-m6");
    expect(r.fields.lensId).toBe("lens-35");
    expect(r.fields.shutterSpeed).toBe("1/250");
    expect(r.fields.aperture).toBe("f/8");
  });
  it("matches the Mamiya by model name and the 80 by focal length", () => {
    const r = parseTranscript("mamiya, 80, one twenty-fifth at eleven", gear);
    expect(r.fields.cameraId).toBe("cam-m7");
    expect(r.fields.lensId).toBe("lens-80");
    expect(r.fields.shutterSpeed).toBe("1/125");
    expect(r.fields.aperture).toBe("f/11");
  });
  it("leaves gear unset with no index", () => {
    expect(parseTranscript("m6 250 f8").fields.cameraId).toBeUndefined();
  });
});

describe("commands and spans", () => {
  it("detects delete phrases", () => {
    expect(parseTranscript("scratch that").command).toBe("delete_last");
    expect(parseTranscript("Delete last").command).toBe("delete_last");
    expect(parseTranscript("delete that one").command).toBe("delete_last");
    expect(parseTranscript("the last light").command).toBeNull();
  });
  it("reports consumed spans in order", () => {
    const text = "frame 12, 1/250 at f/8, spot";
    const r = parseTranscript(text);
    const consumed = r.spans.map(([s, e, f]) => [text.slice(s, e), f]);
    expect(consumed).toEqual([
      ["frame 12", "frameNumber"],
      ["1/250", "shutterSpeed"],
      ["f/8", "aperture"],
      ["spot", "meteringMode"],
    ]);
  });
  it("parses a ramble without touching it", () => {
    const text =
      "okay so this is the kitchen window again, um, two fifty at f eight, plus one because of the backlight, " +
      "the sound of the fridge is in this one somehow, frame nine I think";
    const r = parseTranscript(text);
    expect(r.fields).toMatchObject({ shutterSpeed: "1/250", aperture: "f/8", compensation: "+1", frameNumber: 9 });
    expect(r.command).toBeNull();
  });
  it("returns nothing for text with no settings", () => {
    const r = parseTranscript("just a note about the light");
    expect(r.fields).toEqual({});
    expect(r.spans).toEqual([]);
  });
});

// Additional coverage for branches the brief's contract cases don't exercise
// (spoken-number edge shapes, and the remaining metering words).
describe("additional coverage", () => {
  it("reads a bare tens word as a shutter speed", () => {
    expect(parseTranscript("sixty").fields.shutterSpeed).toBe("1/60");
  });
  it("ignores an unrecognised single word", () => {
    expect(parseTranscript("hello").fields.shutterSpeed).toBeUndefined();
  });
  it("ignores an unrecognised three-word number", () => {
    expect(parseTranscript("frame two two two").fields.frameNumber).toBeUndefined();
  });
  it("reads the remaining metering words", () => {
    expect(parseTranscript("average of the scene").fields.meteringMode).toBe("average");
    expect(parseTranscript("center weighted").fields.meteringMode).toBe("center");
  });
});
