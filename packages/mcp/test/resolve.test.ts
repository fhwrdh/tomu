import { describe, expect, it } from "vitest";
import { pickActiveRoll, resolveLot, resolveRollHandle } from "../src/resolve.js";
import { useFakeApi } from "./support/fake-api.js";
import { activeRoll, anyRoll, inventoryLot } from "./support/fixtures.js";

const api = useFakeApi();

describe("pickActiveRoll", () => {
  const m6 = activeRoll({ id: "roll-m6" });
  const mamiya = activeRoll({ id: "roll-m7", cameraId: "cam-m7", cameraMake: "Mamiya", cameraModel: "7", format: "120" });

  it("says to load a roll when none is active", async () => {
    api.answer("GET", "/rolls?status=active", { data: [] });
    expect(await pickActiveRoll()).toEqual({ error: "No active rolls. Load one first with tomu_load." });
  });

  it("needs no hint when only one roll is loaded", async () => {
    api.answer("GET", "/rolls?status=active", { data: [m6] });
    expect((await pickActiveRoll()).roll?.id).toBe("roll-m6");
  });

  it("asks for a camera when several rolls are loaded", async () => {
    api.answer("GET", "/rolls?status=active", { data: [m6, mamiya] });
    expect((await pickActiveRoll()).error).toMatch(/^Multiple active rolls — specify a camera/);
  });

  it("picks by camera hint", async () => {
    api.answer("GET", "/rolls?status=active", { data: [m6, mamiya] });
    expect((await pickActiveRoll("mamiya")).roll?.id).toBe("roll-m7");
  });

  // A camera-less roll (loaded 4x5 sheets) has empty make and model, and an empty
  // string is "contained" in every hint — so it used to match all of them.
  it("does not let a camera-less roll match every hint", async () => {
    const sheets = activeRoll({ id: "roll-4x5", cameraId: null, cameraMake: null, cameraModel: null, format: "4x5" });
    api.answer("GET", "/rolls?status=active", { data: [sheets, m6] });
    expect((await pickActiveRoll("M6")).roll?.id).toBe("roll-m6");
  });

  it("lists what is loaded when the hint matches nothing", async () => {
    api.answer("GET", "/rolls?status=active", { data: [m6] });
    expect((await pickActiveRoll("Hasselblad")).error).toBe('No active roll matching camera "Hasselblad". Active: Leica M6');
  });
});

describe("resolveRollHandle", () => {
  const roll = anyRoll({ id: "0f3c9a1e-7b2d-4c55-9e01-aa11bb22cc33", displayId: "20260906.1", devDate: "2026-09-12", devSeq: 741 });

  it.each([
    ["a display id", "20260906.1"],
    ["a Dev Id", "20260912.0741"],
    ["a bare dev sequence", "741"],
    ["a uuid prefix of 8 or more characters", "0f3c9a1e"],
    ["any of those with stray whitespace", "  20260906.1 "],
  ])("finds a roll by %s", async (_, handle) => {
    api.answer("GET", "/rolls?status=all", { data: [roll] });
    expect((await resolveRollHandle(handle)).roll?.id).toBe(roll.id);
  });

  it("will not match a uuid prefix shorter than 8 characters", async () => {
    api.answer("GET", "/rolls?status=all", { data: [roll] });
    expect((await resolveRollHandle("0f3c9a")).error).toMatch(/^No roll matches "0f3c9a"/);
  });

  it("refuses to choose between rolls that share a handle", async () => {
    const twin = anyRoll({ id: "0f3c9a1e-ffff-4000-8000-000000000000", displayId: "20260907.1" });
    api.answer("GET", "/rolls?status=all", { data: [roll, twin] });
    expect((await resolveRollHandle("0f3c9a1e")).error).toBe('"0f3c9a1e" matches 2 rolls: 20260906.1, 20260907.1');
  });
});

describe("resolveLot", () => {
  const hp5in35 = inventoryLot({ id: "lot-35", displayId: "R001" });
  const hp5in120 = inventoryLot({ id: "lot-120", displayId: "R002", format: "120" });

  it("finds a lot by display id", async () => {
    api.answer("GET", "/inventory", { data: [hp5in35, hp5in120] });
    expect(await resolveLot({ displayId: "R002" })).toEqual({ lot: hp5in120 });
  });

  it("explains when a display id does not exist", async () => {
    api.answer("GET", "/inventory", { data: [hp5in35] });
    expect(await resolveLot({ displayId: "R999" })).toEqual({ text: 'No inventory lot with displayId "R999".' });
  });

  it("refuses to guess when a film name matches several lots, and lists them", async () => {
    api.answer("GET", "/inventory", { data: [hp5in35, hp5in120] });
    const result = await resolveLot({ film: "hp5" });
    expect(result).toHaveProperty("text");
    expect((result as { text: string }).text).toMatch(/^Multiple lots match — narrow with format\/form/);
    expect((result as { text: string }).text).toContain("[R001]");
    expect((result as { text: string }).text).toContain("[R002]");
  });

  it("narrows a film name by format", async () => {
    api.answer("GET", "/inventory", { data: [hp5in35, hp5in120] });
    expect(await resolveLot({ film: "hp5", format: "120" })).toEqual({ lot: hp5in120 });
  });

  it("says when the stock matched but no lot has that format", async () => {
    api.answer("GET", "/inventory", { data: [hp5in35] });
    expect(await resolveLot({ film: "hp5", format: "4x5" })).toEqual({
      text: "Matched the stock, but no lot with that format/form. Drop the format/form filter to see options.",
    });
  });
});
