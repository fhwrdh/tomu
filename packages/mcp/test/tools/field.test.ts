import { describe, expect, it } from "vitest";
import { useFakeApi } from "../support/fake-api.js";
import { activeRoll, anyRoll, camera, fieldEvent, lens } from "../support/fixtures.js";
import { useTomu } from "../support/tomu-client.js";

const api = useFakeApi();
const tomu = useTomu();

const EVENT = fieldEvent();
const ROLL = anyRoll({ id: "roll-1", displayId: "20260906.1" });

describe("tomu_capture", () => {
  it("records the transcript word for word as a voice note", async () => {
    const transcript = "uh, two fifty at f eight — no wait, f eleven — the ferry coming in";
    api.answer("POST", "/field-events", { data: EVENT }).answer("GET", "/rolls?status=all", { data: [] });

    const reply = await tomu.call("tomu_capture", { transcript });

    const body = api.sent("POST", "/field-events") as Record<string, unknown>;
    expect(body.transcript).toBe(transcript);
    expect(body.kind).toBe("voice");
    expect(body.clientId).toMatch(/^[0-9a-f-]{36}$/);
    expect(reply).toMatch(/^\*\*K7Q2\*\*/);
  });

  it("links the note to the roll in the named camera", async () => {
    api
      .answer("GET", "/rolls?status=active", { data: [activeRoll({ id: "roll-m6", cameraId: "cam-m6" })] })
      .answer("POST", "/field-events", { data: EVENT })
      .answer("GET", "/rolls?status=all", { data: [] });

    const reply = await tomu.call("tomu_capture", { transcript: "ferry", camera: "M6" });

    expect(api.sent("POST", "/field-events")).toMatchObject({ rollId: "roll-m6", cameraId: "cam-m6" });
    expect(reply).toMatch(/roll .*HP5 Plus \(35mm\) in Leica M6/);
  });

  it("keeps the note loose, but still names the camera, when nothing is loaded in it", async () => {
    api
      .answer("GET", "/rolls?status=active", { data: [] })
      .answer("GET", "/cameras", { data: [camera({ id: "cam-m6" })] })
      .answer("POST", "/field-events", { data: EVENT })
      .answer("GET", "/rolls?status=all", { data: [] });

    const reply = await tomu.call("tomu_capture", { transcript: "ferry", camera: "M6" });

    const body = api.sent("POST", "/field-events") as Record<string, unknown>;
    expect(body.cameraId).toBe("cam-m6");
    expect(body).not.toHaveProperty("rollId");
    expect(reply).toContain("no active roll — loose");
  });

  it("asks which roll rather than guessing when the camera hint matches two", async () => {
    api.answer("GET", "/rolls?status=active", {
      data: [activeRoll({ id: "roll-a" }), activeRoll({ id: "roll-b" })],
    });

    const reply = await tomu.call("tomu_capture", { transcript: "ferry", camera: "Leica" });

    expect(reply).toMatch(/^Multiple active rolls/);
    expect(api.wasSent("POST", "/field-events")).toBe(false);
  });
});

describe("tomu_field_events", () => {
  it("lists pending events by default, transcript under each", async () => {
    api
      .answer("GET", "/field-events?status=pending&limit=20", { data: [EVENT] })
      .answer("GET", "/rolls?status=all", { data: [] });

    const reply = await tomu.call("tomu_field_events");

    expect(reply).toContain("## Field events (1)");
    expect(reply).toContain("  > two fifty at f eight, the ferry");
  });

  it("filters by roll handle", async () => {
    api
      .answer("GET", "/rolls?status=all", { data: [ROLL] })
      .answer("GET", "/field-events?status=all&limit=5&roll_id=roll-1", { data: [] });

    expect(await tomu.call("tomu_field_events", { roll: "20260906.1", status: "all", limit: 5 })).toBe("No field events.");
  });
});

describe("tomu_edit_event", () => {
  it("sends only the fields being corrected", async () => {
    api
      .answer("PATCH", `/field-events/${EVENT.id}`, { data: fieldEvent({ aperture: "f/11" }) })
      .answer("GET", "/rolls?status=all", { data: [] });

    const reply = await tomu.call("tomu_edit_event", { event: EVENT.id, aperture: "f/11" });

    expect(api.sent("PATCH", `/field-events/${EVENT.id}`)).toEqual({ aperture: "f/11" });
    expect(reply).toMatch(/^Updated \*\*K7Q2\*\*.*f\/11/);
  });

  it("resolves a lens hint to its id", async () => {
    api
      .answer("GET", "/lenses", { data: [lens({ id: "lens-35" })] })
      .answer("PATCH", `/field-events/${EVENT.id}`, { data: EVENT })
      .answer("GET", "/rolls?status=all", { data: [] });

    await tomu.call("tomu_edit_event", { event: EVENT.id, lens: "summicron" });

    expect(api.sent("PATCH", `/field-events/${EVENT.id}`)).toEqual({ lensId: "lens-35" });
  });

  it("changes nothing when given nothing to change", async () => {
    expect(await tomu.call("tomu_edit_event", { event: EVENT.id })).toBe("Nothing to change.");
  });
});

describe("tomu_pin_event", () => {
  it("pins in order and stops at the first failure, naming what was not attempted", async () => {
    const pinned = { event: fieldEvent({ shortId: "AAAA" }), frame: { frameNumber: 1 }, joined: false };
    api
      .answer("POST", "/field-events/e1/pin", { data: pinned })
      .fail("POST", "/field-events/e2/pin", 409, "frame 2 already has a note");

    const reply = await tomu.call("tomu_pin_event", {
      pins: [
        { event: "e1", frameNumber: 1 },
        { event: "e2", frameNumber: 2 },
        { event: "e3", frameNumber: 3 },
      ],
    });

    expect(reply).toBe(
      "Pinned: AAAA → frame 1\nFailed on e2 (frame 2): API error 409: frame 2 already has a note\nNot attempted: e3",
    );
    expect(api.wasSent("POST", "/field-events/e3/pin")).toBe(false);
  });

  it("pins a loose event to the named roll", async () => {
    api
      .answer("GET", "/rolls?status=all", { data: [ROLL] })
      .answer("POST", "/field-events/e1/pin", { data: { event: EVENT, frame: { frameNumber: 7 }, joined: true } });

    const reply = await tomu.call("tomu_pin_event", { pins: [{ event: "e1", frameNumber: 7 }], roll: "20260906.1" });

    expect(api.sent("POST", "/field-events/e1/pin")).toEqual({ rollId: "roll-1", frameNumber: 7 });
    expect(reply).toBe("Pinned: K7Q2 → frame 7 (joined)");
  });
});

describe("tomu_roll_level_event", () => {
  it("attaches an event to its own roll when no roll is named", async () => {
    api
      .answer("POST", "/field-events/e1/roll-level", { data: { event: fieldEvent({ status: "roll_level" }) } })
      .answer("GET", "/rolls?status=all", { data: [] });

    const reply = await tomu.call("tomu_roll_level_event", { event: "e1" });

    expect(api.sent("POST", "/field-events/e1/roll-level")).toEqual({});
    expect(reply).toMatch(/^Attached .*roll_level$/);
  });
});

describe("tomu_reparse_events", () => {
  it("resolves each event handle before asking for a reparse", async () => {
    api
      .answer("GET", "/field-events/K7Q2", { data: EVENT })
      .answer("POST", "/field-events/reparse", { data: { attempted: 1, changed: 0 } });

    const reply = await tomu.call("tomu_reparse_events", { events: ["K7Q2"] });

    expect(api.sent("POST", "/field-events/reparse")).toEqual({ ids: [EVENT.id] });
    expect(reply).toBe("Reparsed 1 event(s); 0 changed.");
  });

  it("rejects a since date it cannot read", async () => {
    expect(await tomu.call("tomu_reparse_events", { since: "last tuesday-ish" })).toBe("since is not a parseable date");
  });
});

describe("tomu_delete_event", () => {
  it("looks the event up, then deletes it by its full id", async () => {
    api
      .answer("GET", "/field-events/K7Q2", { data: EVENT })
      .answer("GET", "/rolls?status=all", { data: [] })
      .answer("DELETE", `/field-events/${EVENT.id}`, null, 204);

    const reply = await tomu.call("tomu_delete_event", { event: "K7Q2" });

    expect(api.wasSent("DELETE", `/field-events/${EVENT.id}`)).toBe(true);
    expect(reply).toMatch(/^Deleted \*\*K7Q2\*\*/);
  });

  it("passes force through for an event that is already pinned", async () => {
    api
      .answer("GET", "/field-events/K7Q2", { data: fieldEvent({ status: "pinned" }) })
      .answer("GET", "/rolls?status=all", { data: [] })
      .answer("DELETE", `/field-events/${EVENT.id}?force=true`, null, 204);

    await tomu.call("tomu_delete_event", { event: "K7Q2", force: true });

    expect(api.wasSent("DELETE", `/field-events/${EVENT.id}?force=true`)).toBe(true);
  });
});
