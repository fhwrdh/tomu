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
