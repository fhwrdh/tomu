import { describe, expect, it } from "vitest";
import { useFakeApi } from "../support/fake-api.js";
import { camera, lens, tank } from "../support/fixtures.js";
import { useTomu } from "../support/tomu-client.js";

const api = useFakeApi();
const tomu = useTomu();

describe("tomu_gear", () => {
  it("lists cameras and lenses with their specs", async () => {
    api.answer("GET", "/cameras", { data: [camera()] }).answer("GET", "/lenses", { data: [lens()] });

    const reply = await tomu.call("tomu_gear", { action: "list" });

    expect(reply).toContain("- **Leica M6** (35mm)");
    expect(reply).toContain("- **Leica Summicron** (35mm f/2)");
  });

  it("filters the list by a query", async () => {
    api
      .answer("GET", "/cameras", { data: [camera(), camera({ id: "cam-m7", make: "Mamiya", model: "7", format: "120" })] })
      .answer("GET", "/lenses", { data: [lens()] });

    const reply = await tomu.call("tomu_gear", { action: "list", query: "mamiya" });

    expect(reply).toContain("**Mamiya 7**");
    expect(reply).not.toContain("Leica");
  });

  it("adds a camera, defaulting to 35mm", async () => {
    api.answer("POST", "/cameras", { data: camera({ make: "Nikon", model: "F3" }) });

    const reply = await tomu.call("tomu_gear", { action: "add_camera", make: "Nikon", model: "F3" });

    expect(api.sent("POST", "/cameras")).toEqual({ make: "Nikon", model: "F3", format: "35mm" });
    expect(reply).toBe("Added camera: **Nikon F3** (35mm)");
  });

  it("needs a make and model to add anything", async () => {
    expect(await tomu.call("tomu_gear", { action: "add_lens", make: "Leica" })).toBe("Need make and model to add a lens.");
  });
});

describe("tomu_gear updates", () => {
  const cube = camera({ id: "cam-cube", make: "Chroma", model: "Cube", format: "4x5" });

  it("corrects a camera found by fuzzy name, sending only what changed", async () => {
    api
      .answer("GET", "/cameras", { data: [camera(), cube] })
      .answer("PATCH", "/cameras/cam-cube", { data: { ...cube, format: "35mm" } });

    const reply = await tomu.call("tomu_gear", { action: "update_camera", name: "chroma cube", format: "35MM" });

    expect(api.sent("PATCH", "/cameras/cam-cube")).toEqual({ format: "35mm" });
    expect(reply).toBe("Updated camera **Chroma Cube**: format 4x5 → 35mm");
  });

  it("retires a lens without deleting it", async () => {
    const nokton = lens({ id: "lens-40", make: "Voigtlander", model: "Nokton", focalLengthMm: 40, maxAperture: "1.4" });
    api
      .answer("GET", "/lenses", { data: [lens(), nokton] })
      .answer("PATCH", "/lenses/lens-40", { data: { ...nokton, isActive: false } });

    const reply = await tomu.call("tomu_gear", { action: "update_lens", name: "nokton", isActive: false });

    expect(api.sent("PATCH", "/lenses/lens-40")).toEqual({ isActive: false });
    expect(reply).toBe("Updated lens **Voigtlander Nokton**: isActive — → false");
  });

  it("refuses to guess when the name matches more than one camera", async () => {
    api.answer("GET", "/cameras", {
      data: [camera({ id: "cam-f3", make: "Nikon", model: "F3" }), camera({ id: "cam-ftn", make: "Nikon", model: "FTn2" })],
    });

    const reply = await tomu.call("tomu_gear", { action: "update_camera", name: "Nikon", notes: "x" });

    expect(reply).toBe('"Nikon" is ambiguous: Nikon F3, Nikon FTn2.');
    expect(api.requests.some((r) => r.method === "PATCH")).toBe(false);
  });

  it("says when nothing matches", async () => {
    api.answer("GET", "/cameras", { data: [camera()] });
    expect(await tomu.call("tomu_gear", { action: "update_camera", name: "hasselblad", notes: "x" })).toBe(
      'No camera matching "hasselblad".',
    );
  });

  it("explains an unknown format without calling the API", async () => {
    const reply = await tomu.call("tomu_gear", { action: "update_camera", name: "cube", format: "6x9" });

    expect(reply).toContain('"6x9" is not a format Tomu knows');
    expect(api.requests).toHaveLength(0);
  });

  it("needs a name and at least one field", async () => {
    expect(await tomu.call("tomu_gear", { action: "update_lens", notes: "x" })).toBe("update_lens needs a name to find the lens.");
    expect(await tomu.call("tomu_gear", { action: "update_camera", name: "cube" })).toBe(
      "Nothing to change: give at least one camera field to update.",
    );
  });
});

describe("tomu_tanks", () => {
  it("lists the fleet", async () => {
    api.answer("GET", "/tanks", { data: [tank()] });
    expect(await tomu.call("tomu_tanks", { action: "list" })).toBe(
      "## Tank fleet\n\n- **Paterson 3-reel** — 1000 ml, 3 reel units (120 = 1.5), inversion",
    );
  });

  it("adds a tank with one owned and inversion agitation unless told otherwise", async () => {
    api.answer("POST", "/tanks", { data: tank({ name: "Paterson 2-reel", volumeMl: 500, reelUnits: "2.0" }) });

    await tomu.call("tomu_tanks", { action: "add", name: "Paterson 2-reel", kind: "roll", volumeMl: 500, reelUnits: 2 });

    expect(api.sent("POST", "/tanks")).toEqual({
      name: "Paterson 2-reel",
      kind: "roll",
      volumeMl: 500,
      reelUnits: 2,
      quantity: 1,
      agitation: "inversion",
    });
  });

  it("updates the one tank a name matches, sending only what changed", async () => {
    api
      .answer("GET", "/tanks", { data: [tank({ id: "tank-p2", name: "Paterson 2-reel" }), tank()] })
      .answer("PATCH", "/tanks/tank-p3", { data: tank({ quantity: 2 }) });

    const reply = await tomu.call("tomu_tanks", { action: "update", name: "3-reel", quantity: 2 });

    expect(api.sent("PATCH", "/tanks/tank-p3")).toEqual({ quantity: 2 });
    expect(reply).toContain("Updated:\n- **Paterson 3-reel** ×2");
  });

  it("refuses to update when the name matches more than one tank", async () => {
    api.answer("GET", "/tanks", { data: [tank({ id: "tank-p2", name: "Paterson 2-reel" }), tank()] });

    const reply = await tomu.call("tomu_tanks", { action: "update", name: "Paterson", quantity: 2 });

    expect(reply).toBe('"Paterson" is ambiguous: Paterson 2-reel, Paterson 3-reel.');
    expect(api.requests.some((r) => r.method === "PATCH")).toBe(false);
  });
});
