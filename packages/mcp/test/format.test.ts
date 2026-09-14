import { describe, expect, it } from "vitest";
import {
  coerceExpiration,
  describeItem,
  describeLot,
  describeRoll,
  eventLine,
  formatTime,
  groupLabel,
  rollLabel,
  tankLine,
} from "../src/format.js";
import { activeRoll, anyRoll, fieldEvent, inventoryItem, inventoryLot, tank } from "./support/fixtures.js";

describe("coerceExpiration", () => {
  it("keeps a full date, zero-padding it", () => {
    expect(coerceExpiration("2027-3-5")).toBe("2027-03-05");
  });

  // Boxes print month precision. Storing the last day keeps the film good
  // through the printed month.
  it("turns a month into the last day of that month", () => {
    expect(coerceExpiration("2027.12")).toBe("2027-12-31");
    expect(coerceExpiration("2027/04")).toBe("2027-04-30");
  });

  it("knows February in leap years", () => {
    expect(coerceExpiration("2028-02")).toBe("2028-02-29");
    expect(coerceExpiration("2027-02")).toBe("2027-02-28");
  });

  it("turns a bare year into New Year's Eve", () => {
    expect(coerceExpiration("2027")).toBe("2027-12-31");
  });

  it("leaves anything it does not recognise untouched", () => {
    expect(coerceExpiration("soon")).toBe("soon");
  });
});

describe("groupLabel", () => {
  it("counts like spreadsheet columns", () => {
    expect([0, 1, 25, 26, 27, 51, 52].map(groupLabel)).toEqual(["A", "B", "Z", "AA", "AB", "AZ", "BA"]);
  });
});

describe("formatTime", () => {
  it("shows whole minutes as min, and seconds as m:ss", () => {
    expect(formatTime(480)).toBe("8min");
    expect(formatTime(450)).toBe("7:30");
    expect(formatTime(305)).toBe("5:05");
  });

  it("shows ? when there is no time", () => {
    expect(formatTime(null)).toBe("?");
  });
});

describe("describeItem", () => {
  it("counts factory rolls and sheets", () => {
    expect(describeItem(inventoryItem({ quantity: 10 }))).toBe("10 rolls 35mm");
    expect(describeItem(inventoryItem({ form: "sheet", format: "4x5", quantity: 25 }))).toBe("25 sheets 4x5");
  });

  it("measures bulk rolls in feet remaining of the original length", () => {
    const bulk = inventoryItem({ form: "bulk_roll", remainingLengthFt: "37.5", originalLengthFt: "100" });
    expect(describeItem(bulk)).toBe("37.5ft / 100ft bulk 35mm");
  });
});

describe("describeLot", () => {
  it("leads with the display id when the lot has one", () => {
    expect(describeLot(inventoryLot({ displayId: "R001" }))).toMatch(/^\[R001\] .*HP5 Plus — 10 rolls 35mm$/);
  });

  it("falls back to a short id and adds expiry and source", () => {
    const lot = inventoryLot({ id: "abcdef12-3456", expirationDate: "2027-12-31", source: "amazon.com" });
    expect(describeLot(lot)).toMatch(/^\[abcdef12\] .* 10 rolls 35mm, exp 2027-12-31, src amazon\.com$/);
  });
});

describe("describeRoll", () => {
  it("says what is in which camera and how far along it is", () => {
    expect(describeRoll(activeRoll())).toMatch(/HP5 Plus \(35mm\) in Leica M6 — 12\/36 frames$/);
  });

  it("says so when a roll has no camera", () => {
    expect(describeRoll(activeRoll({ cameraMake: null, cameraModel: null }))).toContain("in no camera");
  });
});

describe("rollLabel", () => {
  it("prefers the display id, then the Dev Id, then a short uuid", () => {
    expect(rollLabel(anyRoll({ displayId: "20260906.1" }))).toBe("20260906.1");
    expect(rollLabel(anyRoll({ displayId: null, devDate: "2026-05-12", devSeq: 721 }))).toBe("20260512.0721");
    expect(rollLabel(anyRoll({ displayId: null, id: "0f3c9a1e-7b2d" }))).toBe("0f3c9a1e");
  });
});

describe("eventLine", () => {
  const rolls = new Map([["roll-1", anyRoll({ id: "roll-1", displayId: "20260906.1" })]]);

  it("reads short id, time, where, settings, subject, and state", () => {
    expect(eventLine(fieldEvent({ rollId: "roll-1", frameNumber: 7 }), rolls)).toBe(
      "**K7Q2** · 2026-09-06 14:32 · roll 20260906.1 · frame 7 · 1/250 f/8 · ferry · pending",
    );
  });

  it("marks a provisional frame number with ?", () => {
    expect(eventLine(fieldEvent({ rollId: "roll-1", frameNumber: 7, frameProvisional: true }), rolls)).toContain("frame 7?");
  });

  it("calls an event with no roll loose", () => {
    expect(eventLine(fieldEvent(), rolls)).toContain("· loose ·");
  });

  it("shouts when the parser wants a human to look", () => {
    expect(eventLine(fieldEvent({ review: true }), rolls)).toMatch(/NEEDS REVIEW$/);
  });

  it("labels photos, and events with nothing parsed", () => {
    expect(eventLine(fieldEvent({ kind: "photo", subject: null }), rolls)).toContain("📷 photo");
    expect(eventLine(fieldEvent({ shutterSpeed: null, aperture: null, subject: null }), rolls)).toContain("(no settings)");
  });
});

describe("tankLine", () => {
  it("describes a roll tank by reel units", () => {
    expect(tankLine(tank({ quantity: 2 }))).toBe(
      "- **Paterson 3-reel** ×2 — 1000 ml, 3 reel units (120 = 1.5), inversion",
    );
  });

  it("describes a sheet tank by sheets, and marks a retired one", () => {
    const mod54 = tank({ name: "MOD54", kind: "sheet", reelUnits: null, sheetCapacity: 6, isActive: false });
    expect(tankLine(mod54)).toBe("- **MOD54** [retired] — 1000 ml, 6× 4x5, inversion");
  });
});
