import { describe, expect, it } from "vitest";
import { useFakeApi } from "../support/fake-api.js";
import { candidateGroup, candidateRoll, devSession, planLoad, planRoll, sessionRoll } from "../support/fixtures.js";
import { useTomu } from "../support/tomu-client.js";

const api = useFakeApi();
const tomu = useTomu();

describe("tomu_dilution", () => {
  it("computes concentrate and water for an HC-110 letter", async () => {
    const reply = await tomu.call("tomu_dilution", { developer: "HC-110", dilution: "E", volumeMl: 1000 });
    expect(reply).toContain("**HC-110 1+47** in 1000 ml");
    expect(reply).toContain("Concentrate: **20.8 ml**");
    expect(reply).toContain("Water: **979.2 ml**");
  });

  it("takes the volume from a named tank", async () => {
    const reply = await tomu.call("tomu_dilution", { developer: "HC-110", dilution: "1+47", tank: "SP-445" });
    expect(reply).toContain("in Stearman SP-445 (475 ml)");
    expect(reply).toContain("Concentrate: **9.9 ml**");
  });

  it("warns when there is too little concentrate for the rolls", async () => {
    const reply = await tomu.call("tomu_dilution", { developer: "HC-110", dilution: "E", tank: "SP-445", rolls: 4 });
    expect(reply).toContain("⚠️");
    expect(reply).toContain("minimum is 24 ml");
  });

  it("lists the known tanks when given neither a tank nor a volume", async () => {
    const reply = await tomu.call("tomu_dilution", { developer: "HC-110", dilution: "B" });
    expect(reply).toMatch(/^Need a tank or volumeMl\. Known tanks: .*Stearman SP-445 \(475 ml\)/);
  });

  it("explains a dilution it cannot read", async () => {
    const reply = await tomu.call("tomu_dilution", { developer: "HC-110", dilution: "strong", volumeMl: 500 });
    expect(reply).toMatch(/^Couldn't parse dilution "strong"/);
  });
});

describe("tomu_dev_candidates", () => {
  it("says so when nothing is waiting", async () => {
    api.answer("GET", "/dev-sessions/candidates", { data: [] });
    expect(await tomu.call("tomu_dev_candidates")).toBe("No rolls awaiting development.");
  });

  it("orders groups by tier and letters them in that order", async () => {
    const pushed = candidateRoll({ id: "roll-hp5", displayId: "20260602.01", manufacturer: "Ilford", stockName: "HP5 Plus", stockIso: 400, ratedIso: 1600 });
    api.answer("GET", "/dev-sessions/candidates", {
      data: [
        candidateGroup({ tier: "stock-iso", recipe: null, rolls: [pushed] }),
        candidateGroup({ tier: "intended" }),
      ],
    });

    const reply = await tomu.call("tomu_dev_candidates");

    expect(reply.indexOf("Tier 1 — intended")).toBeLessThan(reply.indexOf("Tier 4 — no recipe yet"));
    expect(reply).toContain("**Group A** — HC-110 E 7:30 @ 20.0°C  (1)");
    expect(reply).toMatch(/\*\*Group B\*\* — .*HP5 Plus @ 1600 {2}\(1\)/);
    expect(reply).toContain("**20260602.01**");
  });
});

describe("tomu_dev_session", () => {
  describe("list", () => {
    it("shows only sessions still open", async () => {
      api.answer("GET", "/dev-sessions", {
        data: [
          devSession({ displayId: "20260914.01", tank: "Stearman SP-445" }),
          devSession({ id: "session-0", displayId: "20260801.01", completedAt: "2026-08-01T21:00:00.000Z" }),
        ],
      });
      const reply = await tomu.call("tomu_dev_session", { action: "list" });
      expect(reply).toContain("**20260914.01** — HC-110 1+47 7:30 in Stearman SP-445");
      expect(reply).not.toContain("20260801.01");
    });
  });

  describe("complete", () => {
    it("closes the most recently developed open session by default", async () => {
      api
        .answer("GET", "/dev-sessions", {
          data: [
            devSession({ id: "session-older", displayId: "20260910.01", developedAt: "2026-09-10T19:00:00.000Z" }),
            devSession({ id: "session-newer", displayId: "20260912.01", developedAt: "2026-09-12T19:00:00.000Z" }),
          ],
        })
        .answer("POST", "/dev-sessions/session-newer/complete", { data: {} })
        .answer("GET", "/dev-sessions/session-newer", {
          data: devSession({ id: "session-newer", displayId: "20260912.01", rolls: [sessionRoll({ devId: "20260912.0736" })] }),
        });

      const reply = await tomu.call("tomu_dev_session", { action: "complete", resultsRating: 4 });

      expect(api.sent("POST", "/dev-sessions/session-newer/complete")).toEqual({ resultsRating: 4 });
      expect(reply).toContain("Completed **20260912.01**");
      expect(reply).toContain("Dev **20260912.0736**");
    });

    it("names the open sessions when asked for one that is not open", async () => {
      api.answer("GET", "/dev-sessions", { data: [devSession({ displayId: "20260914.01" })] });
      const reply = await tomu.call("tomu_dev_session", { action: "complete", sessionDisplayId: "20260101.01" });
      expect(reply).toBe('No open session with display id "20260101.01". Open: 20260914.01.');
    });
  });

  describe("create", () => {
    const shotSheets = [
      { id: "roll-a", displayId: "20260906.1", format: "4x5", status: "shot" },
      { id: "roll-b", displayId: "20260906.2", format: "4x5", status: "shot" },
    ];

    it("needs rolls and a developer", async () => {
      expect(await tomu.call("tomu_dev_session", { action: "create", developer: "HC-110" })).toBe(
        "create needs `rolls` (display ids) and `developer`.",
      );
    });

    it("refuses when a roll is not in the shot backlog, and creates nothing", async () => {
      api.answer("GET", "/rolls?status=shot", { data: shotSheets });
      const reply = await tomu.call("tomu_dev_session", { action: "create", developer: "HC-110", rolls: ["20260906.1", "20990101.1"] });
      expect(reply).toMatch(/^Not found among 'shot' rolls: 20990101\.1\./);
      expect(api.wasSent("POST", "/dev-sessions")).toBe(false);
    });

    it("starts the session and gives the mix for the tank", async () => {
      api
        .answer("GET", "/rolls?status=shot", { data: shotSheets })
        .answer("POST", "/dev-sessions", { data: { id: "session-new" } })
        .answer("GET", "/dev-sessions/session-new", {
          data: devSession({
            id: "session-new",
            tank: "Stearman SP-445",
            rolls: [sessionRoll({ id: "roll-a", format: "4x5" }), sessionRoll({ id: "roll-b", displayId: "20260906.2", format: "4x5", devId: "20260914.0737" })],
          }),
        });

      const reply = await tomu.call("tomu_dev_session", {
        action: "create",
        rolls: ["20260906.1", "20260906.2"],
        developer: "HC-110",
        dilution: "E",
        devTimeSeconds: 450,
        tank: "sp445",
      });

      expect(api.sent("POST", "/dev-sessions")).toEqual({
        rollIds: ["roll-a", "roll-b"],
        developer: "HC-110",
        dilution: "E",
        devTimeSeconds: 450,
        tank: "Stearman SP-445",
      });
      expect(reply).toContain("## Dev session **20260914.01** started");
      expect(reply).toContain("Mix for Stearman SP-445 (475 ml): **9.9 ml HC-110 + 465.1 ml water** (1+47)");
      expect(reply).not.toContain("⚠️");
    });

    it("warns about a development time under five minutes", async () => {
      api
        .answer("GET", "/rolls?status=shot", { data: shotSheets })
        .answer("POST", "/dev-sessions", { data: { id: "session-new" } })
        .answer("GET", "/dev-sessions/session-new", { data: devSession({ id: "session-new", devTimeSeconds: 270 }) });

      const reply = await tomu.call("tomu_dev_session", { action: "create", rolls: ["20260906.1"], developer: "HC-110", shorthand: "B4.5" });

      expect(reply).toContain("⚠️ Dev time 4:30 is under 5 minutes");
    });
  });
});

describe("tomu_tank_plan", () => {
  it("passes the constraints through to the planner", async () => {
    api.answer("POST", "/tanks/plan", { data: { loads: [], remainder: [], warnings: [] } });
    await tomu.call("tomu_tank_plan", { maxTanks: 2, excludeTanks: ["Jobo"] });
    expect(api.sent("POST", "/tanks/plan")).toEqual({ maxTanks: 2, excludeTanks: ["Jobo"] });
  });

  it("says the backlog is empty when there is nothing to pack", async () => {
    api.answer("POST", "/tanks/plan", { data: { loads: [], remainder: [], warnings: [] } });
    expect(await tomu.call("tomu_tank_plan")).toBe("Backlog is empty — nothing to plan.");
  });

  it("lays out each load with its recipe source, fill, and mix", async () => {
    api.answer("POST", "/tanks/plan", { data: { loads: [planLoad()], remainder: [], warnings: [] } });

    const reply = await tomu.call("tomu_tank_plan");

    expect(reply).toContain("### Load 1 — Paterson 3-reel — HC-110 1+47 7:30 @ 20.0°C  [tier 1: intended (labels)]");
    expect(reply).toContain("← oldest: 2026-04-20");
    expect(reply).toContain("- Fill: 3/3 reel units");
    expect(reply).toContain("- Mix: **20.8 ml** HC-110 + **979.2 ml** water (1+47) in 1000 ml");
    expect(reply).toContain("_To run a load: tomu_dev_session action=create");
  });

  it("groups what did not fit by the reason it did not fit", async () => {
    const reason = "fleet exhausted (no roll tanks left)";
    api.answer("POST", "/tanks/plan", {
      data: {
        loads: [],
        remainder: [
          { roll: planRoll({ displayId: "20260420.02" }), reason },
          { roll: planRoll({ id: "roll-2", displayId: "20260420.03" }), reason },
        ],
        warnings: [],
      },
    });

    const reply = await tomu.call("tomu_tank_plan");

    expect(reply).toContain("### Waiting (2)");
    expect(reply).toContain(`**${reason}** (2):\n20260420.02, 20260420.03`);
    expect(reply).not.toContain("_To run a load");
  });
});
