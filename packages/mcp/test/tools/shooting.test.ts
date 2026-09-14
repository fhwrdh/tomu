import { afterEach, describe, expect, it, vi } from "vitest";
import { useFakeApi } from "../support/fake-api.js";
import { activeRoll, camera, lens, stock } from "../support/fixtures.js";
import { useTomu } from "../support/tomu-client.js";

const api = useFakeApi();
const tomu = useTomu();

const HP5 = stock();
const TRIX = stock({ id: "stock-trix", manufacturer: "Kodak", name: "Tri-X 400" });
const M6 = camera();
const MAMIYA = camera({ id: "cam-m7", make: "Mamiya", model: "7", format: "120" });
const LOADED = { id: "roll-new", format: "35mm", form: "factory_roll", frameCount: 36, ratedIso: 400 };

describe("tomu_load", () => {
  it("loads the matched stock into the matched camera", async () => {
    api
      .answer("GET", "/film-stocks", { data: [HP5, TRIX] })
      .answer("GET", "/cameras", { data: [M6, MAMIYA] })
      .answer("POST", "/rolls", { data: LOADED });

    const reply = await tomu.call("tomu_load", { film: "hp5", camera: "m6" });

    expect(api.sent("POST", "/rolls")).toEqual({ filmStockId: "stock-hp5", format: "35mm", cameraId: "cam-m6" });
    expect(reply).toMatch(/^Loaded \*\*.*HP5 Plus\*\* \(35mm, factory roll, ISO 400\) into \*\*Leica M6\*\* — 36 frames\.$/);
  });

  it("shows box and rated ISO when the roll is rated differently", async () => {
    api
      .answer("GET", "/film-stocks", { data: [HP5] })
      .answer("GET", "/cameras", { data: [M6] })
      .answer("POST", "/rolls", { data: { ...LOADED, ratedIso: 1600 } });

    const reply = await tomu.call("tomu_load", { film: "hp5", camera: "m6", ratedIso: 1600 });

    expect(api.sent("POST", "/rolls")).toMatchObject({ ratedIso: 1600 });
    expect(reply).toContain("box 400, rated 1600");
  });

  it("saves a load-time note on the new roll", async () => {
    api
      .answer("GET", "/film-stocks", { data: [HP5] })
      .answer("GET", "/cameras", { data: [M6] })
      .answer("POST", "/rolls", { data: LOADED })
      .answer("POST", "/rolls/roll-new/notes", { data: {} });

    const reply = await tomu.call("tomu_load", { film: "hp5", camera: "m6", note: "for the ferry series" });

    expect(api.sent("POST", "/rolls/roll-new/notes")).toEqual({ content: "for the ferry series" });
    expect(reply).toMatch(/Note saved\.$/);
  });

  it("refuses a camera hint that fits two cameras equally", async () => {
    api
      .answer("GET", "/film-stocks", { data: [HP5] })
      .answer("GET", "/cameras", { data: [M6, camera({ id: "cam-m3", model: "M3" })] });

    const reply = await tomu.call("tomu_load", { film: "hp5", camera: "Leica" });

    expect(reply).toBe('Camera "Leica" is ambiguous. Tied matches: Leica M6, Leica M3.');
    expect(api.wasSent("POST", "/rolls")).toBe(false);
  });

  it("lists the known stocks when the film is not one of them", async () => {
    api.answer("GET", "/film-stocks", { data: [HP5] });
    expect(await tomu.call("tomu_load", { film: "Portra", camera: "m6" })).toMatch(/^Film stock "Portra" not found\. Known stocks: .*HP5 Plus/);
  });
});

describe("tomu_shoot", () => {
  it("logs a frame with only the settings that were said", async () => {
    api
      .answer("GET", "/rolls?status=active", { data: [activeRoll()] })
      .answer("POST", "/rolls/roll-m6/frames", { data: { frameNumber: 13, shutterSpeed: "1/250", aperture: "f/8" } });

    const reply = await tomu.call("tomu_shoot", { shutterSpeed: "1/250", aperture: "f/8", subject: "the ferry" });

    expect(api.sent("POST", "/rolls/roll-m6/frames")).toEqual({ shutterSpeed: "1/250", aperture: "f/8", subject: "the ferry" });
    expect(reply).toMatch(/^Frame 13\/36 logged on .*HP5 Plus in Leica M6 — 1\/250 f\/8 — the ferry\.$/);
  });

  it("attaches the lens a hint names", async () => {
    api
      .answer("GET", "/rolls?status=active", { data: [activeRoll()] })
      .answer("GET", "/lenses", { data: [lens()] })
      .answer("POST", "/rolls/roll-m6/frames", { data: { frameNumber: 13, shutterSpeed: null, aperture: null } });

    await tomu.call("tomu_shoot", { lens: "35" });

    expect(api.sent("POST", "/rolls/roll-m6/frames")).toEqual({ lensId: "lens-35" });
  });

  it("says to load a roll first when none is active", async () => {
    api.answer("GET", "/rolls?status=active", { data: [] });
    expect(await tomu.call("tomu_shoot", {})).toBe("No active rolls. Load one first with tomu_load.");
  });
});

describe("tomu_unload", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // The display id is dated by the user's clock, not the server's.
  it("unloads with the local date and reports the new display id", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 6, 23, 30));
    api
      .answer("GET", "/rolls?status=active", { data: [activeRoll()] })
      .answer("POST", "/rolls/roll-m6/unload", { data: { displayId: "20260906.1", unloadedAt: "2026-09-07T06:30:00.000Z" } });

    const reply = await tomu.call("tomu_unload", {});

    expect(api.sent("POST", "/rolls/roll-m6/unload")).toEqual({ localDate: "2026-09-06" });
    expect(reply).toMatch(/ID: \*\*20260906\.1\*\* \(12 frames logged\)\.$/);
  });
});

describe("tomu_note", () => {
  it("notes the roll, or a frame on it", async () => {
    api
      .answer("GET", "/rolls?status=active", { data: [activeRoll()] })
      .answer("POST", "/rolls/roll-m6/notes", { data: {} })
      .answer("POST", "/rolls/roll-m6/frames/4/notes", { data: {} });

    expect(await tomu.call("tomu_note", { content: "light leak?" })).toMatch(/^Note added to .*HP5 Plus in Leica M6\.$/);
    expect(await tomu.call("tomu_note", { content: "bracketed", frameNumber: 4 })).toMatch(/^Note added to frame 4 of .*HP5 Plus\.$/);
    expect(api.sent("POST", "/rolls/roll-m6/frames/4/notes")).toEqual({ content: "bracketed" });
  });
});

describe("tomu_undo_load", () => {
  it("deletes the roll and warns when logged frames go with it", async () => {
    api
      .answer("GET", "/rolls?status=active", { data: [activeRoll({ framesShot: 3 })] })
      .answer("DELETE", "/rolls/roll-m6", null, 204);

    const reply = await tomu.call("tomu_undo_load", {});

    expect(api.request("DELETE", "/rolls/roll-m6").headers).not.toHaveProperty("Content-Type");
    expect(reply).toMatch(/Inventory restored\. \*\*Deleted 3 logged frame\(s\)\*\* along with the roll\.$/);
  });
});

describe("tomu_rolls", () => {
  it("turns a dev date into a from/to range, and says 'dev filter' when empty", async () => {
    api.answer("GET", "/rolls?dev_date_from=2026-05-12&dev_date_to=2026-05-12", { data: [] });
    expect(await tomu.call("tomu_rolls", { devDate: "2026-05-12" })).toBe("No rolls found (dev filter).");
  });

  it("labels a developed roll by its Dev Id and hides the plan once developed", async () => {
    api.answer("GET", "/rolls?status=developed", {
      data: [
        {
          ...activeRoll({ status: "developed", framesShot: 36, cameraMake: null, cameraModel: null }),
          displayId: null,
          unloadedAt: null,
          devId: "20260512.0721",
          devDate: "2026-05-12",
          devSeq: 721,
          intendedDeveloper: "HC-110",
          intendedDilution: "B",
          intendedDevTimeSeconds: 390,
        },
      ],
    });

    const reply = await tomu.call("tomu_rolls", { status: "developed" });

    expect(reply).toMatch(/^## Rolls \(developed: 1\)/);
    expect(reply).toMatch(/- \*\*20260512\.0721\*\* — .*HP5 Plus \(35mm\) in — \[developed\] — 36\/36 — Dev 20260512\.0721$/);
    expect(reply).not.toContain("plan:");
  });
});

describe("tomu_log_shot_roll", () => {
  it("assumes HC-110 when the dev shorthand is an HC-110 letter code", async () => {
    api
      .answer("GET", "/film-stocks", { data: [HP5] })
      .answer("POST", "/rolls/log-shot", { data: { id: "roll-new", displayId: "20250506.07", ratedIso: 400 } });

    const reply = await tomu.call("tomu_log_shot_roll", { film: "hp5", shotDate: "2025-05-06", fieldSeq: 7, devShorthand: "B7.5" });

    expect(api.sent("POST", "/rolls/log-shot")).toEqual({
      filmStockId: "stock-hp5",
      format: "35mm",
      shotDate: "2025-05-06",
      fieldSeq: 7,
      devShorthand: "B7.5",
      intendedDeveloper: "HC-110",
    });
    expect(reply).toMatch(/^Logged \*\*20250506\.07\*\*: .*HP5 Plus \(35mm, ISO 400\)\. Status: shot\.$/);
  });

  it("keeps a developer that was named outright", async () => {
    api
      .answer("GET", "/film-stocks", { data: [HP5] })
      .answer("POST", "/rolls/log-shot", { data: { id: "roll-new", displayId: null, ratedIso: 400 } });

    const reply = await tomu.call("tomu_log_shot_roll", { film: "hp5", devShorthand: "B7.5", intendedDeveloper: "Rodinal" });

    expect(api.sent("POST", "/rolls/log-shot")).toMatchObject({ intendedDeveloper: "Rodinal" });
    expect(reply).toContain("no displayId yet — pass shotDate to assign one");
  });
});

describe("tomu_correct_roll", () => {
  it("says when no roll has that display id", async () => {
    api.answer("GET", "/rolls?status=all", { data: [] });
    expect(await tomu.call("tomu_correct_roll", { displayId: "20260101.01", ratedIso: 800 })).toBe('No roll with displayId "20260101.01".');
  });

  it("patches only what is being corrected", async () => {
    api
      .answer("GET", "/rolls?status=all", { data: [{ id: "roll-1", displayId: "20260816.01" }] })
      .answer("PATCH", "/rolls/roll-1", { data: {} });

    const reply = await tomu.call("tomu_correct_roll", { displayId: "20260816.01", newDisplayId: "20260815.01", ratedIso: 800 });

    expect(api.sent("PATCH", "/rolls/roll-1")).toEqual({ ratedIso: 800, displayId: "20260815.01" });
    expect(reply).toBe("Roll **20260816.01** corrected: rated ISO → 800; display ID → 20260815.01.");
  });

  it("refuses a call that corrects nothing", async () => {
    api.answer("GET", "/rolls?status=all", { data: [{ id: "roll-1", displayId: "20260816.01" }] });
    expect(await tomu.call("tomu_correct_roll", { displayId: "20260816.01" })).toMatch(/^Nothing to change\./);
  });
});
