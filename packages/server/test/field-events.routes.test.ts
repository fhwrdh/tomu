import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "../src/db/client.js";
import { makeFixture, resetDb, type Fixture } from "./helpers/app.js";

let f: Fixture;

beforeAll(async () => {
  await resetDb();
  f = await makeFixture();
});

afterAll(async () => {
  await f.app.close();
  await pool.end();
});

/** Rebuilds the base rows between tests; the app instance is reused. */
beforeEach(async () => {
  await resetDb();
  const fresh = await makeFixture();
  await fresh.app.close();
  f = { ...fresh, app: f.app, auth: fresh.auth, token: fresh.token };
});

function create(body: Record<string, unknown>) {
  return f.app.inject({
    method: "POST",
    url: "/api/v1/field-events",
    headers: f.auth,
    payload: { clientId: randomUUID(), kind: "voice", ...body },
  });
}

describe("auth", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await f.app.inject({ method: "GET", url: "/api/v1/field-events" });
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /field-events", () => {
  it("stores the transcript verbatim and parses tier-1 fields from it", async () => {
    const transcript = "frame twelve, one two-fifty at f8, incident, fog on the ferry deck";
    const res = await create({ transcript, rollId: f.rollId });
    expect(res.statusCode).toBe(201);
    const ev = res.json().data;

    expect(ev.transcript).toBe(transcript);
    expect(ev.frameNumber).toBe(12);
    expect(ev.shutterSpeed).toBe("1/250");
    expect(ev.aperture).toBe("f/8");
    expect(ev.meteringMode).toBe("incident");
    expect(ev.status).toBe("pending");
    expect(ev.shortId).toBe(ev.id.slice(0, 8));
  });

  it("is idempotent on clientId — a resent event returns the original, not a duplicate", async () => {
    const clientId = randomUUID();
    const first = await create({ clientId, transcript: "first" });
    expect(first.statusCode).toBe(201);

    const again = await f.app.inject({
      method: "POST",
      url: "/api/v1/field-events",
      headers: f.auth,
      payload: { clientId, kind: "voice", transcript: "first" },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json().data.id).toBe(first.json().data.id);

    const list = await f.app.inject({ method: "GET", url: "/api/v1/field-events", headers: f.auth });
    expect(list.json().data).toHaveLength(1);
  });

  it("saves a note with no roll, no camera, and nothing parseable", async () => {
    const res = await create({ transcript: "the light was doing something strange today" });
    expect(res.statusCode).toBe(201);
    const ev = res.json().data;
    expect(ev.rollId).toBeNull();
    expect(ev.shutterSpeed).toBeNull();
    expect(ev.transcript).toBe("the light was doing something strange today");
  });

  it("returns coordinates as numbers, not the strings pg gives back for numeric", async () => {
    const res = await create({ transcript: "x", latitude: 47.6062, longitude: -122.3321 });
    const ev = res.json().data;
    expect(ev.latitude).toBe(47.6062);
    expect(ev.longitude).toBe(-122.3321);
  });

  it("rejects a body that is not a valid event", async () => {
    const res = await f.app.inject({
      method: "POST",
      url: "/api/v1/field-events",
      headers: f.auth,
      payload: { clientId: "not-a-uuid", kind: "voice" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /field-events", () => {
  beforeEach(async () => {
    await create({ transcript: "loose one" });
    await create({ transcript: "on the roll", rollId: f.rollId });
  });

  it("lists pending events by default, newest first", async () => {
    const res = await f.app.inject({ method: "GET", url: "/api/v1/field-events", headers: f.auth });
    const rows = res.json().data;
    expect(rows).toHaveLength(2);
    expect(new Date(rows[0].capturedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(rows[1].capturedAt).getTime(),
    );
  });

  it("filters by roll", async () => {
    const res = await f.app.inject({
      method: "GET",
      url: `/api/v1/field-events?roll_id=${f.rollId}`,
      headers: f.auth,
    });
    const rows = res.json().data;
    expect(rows).toHaveLength(1);
    expect(rows[0].transcript).toBe("on the roll");
  });

  it("does not leak another user's events", async () => {
    const other = await makeFixture();
    await other.app.inject({
      method: "POST",
      url: "/api/v1/field-events",
      headers: other.auth,
      payload: { clientId: randomUUID(), kind: "voice", transcript: "someone else's note" },
    });
    await other.app.close();

    const res = await f.app.inject({ method: "GET", url: "/api/v1/field-events", headers: f.auth });
    const transcripts = res.json().data.map((r: { transcript: string }) => r.transcript);
    expect(transcripts).not.toContain("someone else's note");
  });
});

describe("PATCH /field-events/:id", () => {
  it("records a corrected field in editedFields", async () => {
    const ev = (await create({ transcript: "at 250 f8" })).json().data;
    const res = await f.app.inject({
      method: "PATCH",
      url: `/api/v1/field-events/${ev.id}`,
      headers: f.auth,
      payload: { aperture: "f/11" },
    });
    expect(res.statusCode).toBe(200);
    const updated = res.json().data;
    expect(updated.aperture).toBe("f/11");
    expect(updated.editedFields).toContain("aperture");
  });

  it("refuses to modify the transcript", async () => {
    const ev = (await create({ transcript: "the original words" })).json().data;
    const res = await f.app.inject({
      method: "PATCH",
      url: `/api/v1/field-events/${ev.id}`,
      headers: f.auth,
      payload: { transcript: "rewritten" },
    });
    expect(res.statusCode).toBe(400);

    const after = await f.app.inject({
      method: "GET",
      url: `/api/v1/field-events/${ev.id}`,
      headers: f.auth,
    });
    expect(after.json().data.transcript).toBe("the original words");
  });
});

describe("POST /field-events/:id/pin", () => {
  it("creates the frame from the event and attaches the transcript as a note", async () => {
    const ev = (await create({
      transcript: "one two-fifty at f8, incident",
      rollId: f.rollId,
      latitude: 47.6,
      longitude: -122.3,
    })).json().data;

    const res = await f.app.inject({
      method: "POST",
      url: `/api/v1/field-events/${ev.id}/pin`,
      headers: f.auth,
      payload: { frameNumber: 7 },
    });
    expect(res.statusCode).toBe(201);
    const { event, frame } = res.json().data;

    expect(event.status).toBe("pinned");
    expect(event.frameId).toBe(frame.id);
    expect(frame.frameNumber).toBe(7);
    expect(frame.shutterSpeed).toBe("1/250");
    expect(frame.aperture).toBe("f/8");

    const notes = await pool.query("select content, type from notes where frame_id = $1", [frame.id]);
    expect(notes.rows).toHaveLength(1);
    expect(notes.rows[0].content).toBe("one two-fifty at f8, incident");
  });

  it("refuses to pin a loose event with no roll to fall back on", async () => {
    const ev = (await create({ transcript: "loose" })).json().data;
    const res = await f.app.inject({
      method: "POST",
      url: `/api/v1/field-events/${ev.id}/pin`,
      headers: f.auth,
      payload: { frameNumber: 3 },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /field-events/:id/roll-level", () => {
  it("attaches to the roll without creating a frame", async () => {
    const ev = (await create({ transcript: "meter battery is dying", rollId: f.rollId })).json().data;
    const res = await f.app.inject({
      method: "POST",
      url: `/api/v1/field-events/${ev.id}/roll-level`,
      headers: f.auth,
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.event.status).toBe("roll_level");

    const frames = await pool.query("select id from frames where roll_id = $1", [f.rollId]);
    expect(frames.rows).toHaveLength(0);
    const notes = await pool.query("select content from notes where roll_id = $1", [f.rollId]);
    expect(notes.rows[0].content).toBe("meter battery is dying");
  });
});

describe("DELETE /field-events/:id", () => {
  it("deletes a pending event", async () => {
    const ev = (await create({ transcript: "scratch that" })).json().data;
    const res = await f.app.inject({
      method: "DELETE",
      url: `/api/v1/field-events/${ev.id}`,
      headers: f.auth,
    });
    expect(res.statusCode).toBe(204);

    const after = await f.app.inject({
      method: "GET",
      url: `/api/v1/field-events/${ev.id}`,
      headers: f.auth,
    });
    expect(after.statusCode).toBe(404);
  });

  it("refuses a pinned event without force, and keeps its frame when forced", async () => {
    const ev = (await create({ transcript: "at 250 f8", rollId: f.rollId })).json().data;
    const pinned = await f.app.inject({
      method: "POST",
      url: `/api/v1/field-events/${ev.id}/pin`,
      headers: f.auth,
      payload: { frameNumber: 4 },
    });
    const frameId = pinned.json().data.frame.id;

    const refused = await f.app.inject({
      method: "DELETE",
      url: `/api/v1/field-events/${ev.id}`,
      headers: f.auth,
    });
    expect(refused.statusCode).toBe(409);

    const forced = await f.app.inject({
      method: "DELETE",
      url: `/api/v1/field-events/${ev.id}?force=true`,
      headers: f.auth,
    });
    expect(forced.statusCode).toBe(204);

    const frames = await pool.query("select id from frames where id = $1", [frameId]);
    expect(frames.rows).toHaveLength(1);
  });

  it("404s on someone else's event", async () => {
    const other = await makeFixture();
    const theirs = await other.app.inject({
      method: "POST",
      url: "/api/v1/field-events",
      headers: other.auth,
      payload: { clientId: randomUUID(), kind: "voice", transcript: "theirs" },
    });
    await other.app.close();

    const res = await f.app.inject({
      method: "DELETE",
      url: `/api/v1/field-events/${theirs.json().data.id}`,
      headers: f.auth,
    });
    expect(res.statusCode).toBe(404);
  });
});
