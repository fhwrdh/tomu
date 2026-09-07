import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { CaptureDb } from "../src/offline/db.js";
import { deleteEvent, editField, listEvents, saveCapture, saveGear, undoDelete } from "../src/offline/store.js";

let db: CaptureDb;

const gear = {
  cameras: [{ id: "cam-m6", label: "Leica M6" }],
  lenses: [{ id: "lens-35", label: "Leica Summicron 35mm" }],
  activeRolls: [
    { id: "roll-1", cameraId: "cam-m6", cameraLabel: "Leica M6", label: "Pan F", framesShot: 11, frameCount: 36 },
  ],
};

beforeEach(async () => {
  db = new CaptureDb(`test-${crypto.randomUUID()}`);
  await db.open();
  await saveGear(db, gear);
});

describe("saveCapture", () => {
  it("stores the transcript verbatim and queues it", async () => {
    const ev = await saveCapture(db, { transcript: "  fog on the ferry deck  " });

    expect(ev.transcript).toBe("  fog on the ferry deck  ");
    expect(ev.syncState).toBe("queued");
    expect(ev.clientId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await db.events.count()).toBe(1);
  });

  it("parses tier-1 fields on the device", async () => {
    const ev = await saveCapture(db, { transcript: "frame twelve, one two-fifty at f8, incident" });

    expect(ev.frameNumber).toBe(12);
    expect(ev.frameProvisional).toBe(false);
    expect(ev.shutterSpeed).toBe("1/250");
    expect(ev.aperture).toBe("f/8");
    expect(ev.meteringMode).toBe("incident");
  });

  it("matches gear from the cache, so a spoken camera works offline", async () => {
    const ev = await saveCapture(db, { transcript: "on the m6 with the summicron" });

    expect(ev.cameraId).toBe("cam-m6");
    expect(ev.lensId).toBe("lens-35");
  });

  it("assigns a provisional frame number when none is spoken", async () => {
    const ev = await saveCapture(db, { transcript: "just the light", rollId: "roll-1" });

    // 11 shot on the cached roll, so this is a provisional 12.
    expect(ev.frameNumber).toBe(12);
    expect(ev.frameProvisional).toBe(true);
  });

  it("counts local unsynced events when picking the next frame number", async () => {
    await saveCapture(db, { transcript: "one", rollId: "roll-1" });
    const second = await saveCapture(db, { transcript: "two", rollId: "roll-1" });

    expect(second.frameNumber).toBe(13);
  });

  it("saves with no roll, no gear match, and nothing parseable", async () => {
    const ev = await saveCapture(db, { transcript: "the light was strange today" });

    expect(ev.rollId).toBeNull();
    expect(ev.shutterSpeed).toBeUndefined();
    expect(ev.syncState).toBe("queued");
  });

  it("records a photo capture with its blob", async () => {
    const blob = new Blob(["jpeg bytes"], { type: "image/jpeg" });
    const ev = await saveCapture(db, { kind: "photo", blob, capturedAt: "2026-09-07T18:00:00.000Z" });

    expect(ev.kind).toBe("photo");
    expect(ev.hasPendingBlob).toBe(true);
    expect(ev.capturedAt).toBe("2026-09-07T18:00:00.000Z");
    // The mime type rides on the event as well as the Blob, so the upload never
    // depends on storage preserving it.
    expect(ev.mimeType).toBe("image/jpeg");
    const stored = (await db.blobs.get(ev.clientId))?.blob;
    expect(await stored?.text()).toBe("jpeg bytes");
  });
});

describe("editField", () => {
  it("records the field as hand-edited so re-parse leaves it alone", async () => {
    const ev = await saveCapture(db, { transcript: "at 250 f8" });
    const updated = await editField(db, ev.clientId, "aperture", "f/11");

    expect(updated.aperture).toBe("f/11");
    expect(updated.editedFields).toContain("aperture");
  });

  it("clearing a field still marks it edited", async () => {
    const ev = await saveCapture(db, { transcript: "at 250 f8" });
    const updated = await editField(db, ev.clientId, "aperture", null);

    expect(updated.aperture).toBeNull();
    expect(updated.editedFields).toContain("aperture");
  });

  it("re-queues an already-synced event so the correction goes up", async () => {
    const ev = await saveCapture(db, { transcript: "at 250 f8" });
    await db.events.update(ev.clientId, { syncState: "parsed", serverId: "srv-1" });

    const updated = await editField(db, ev.clientId, "aperture", "f/11");
    expect(updated.syncState).toBe("queued");
  });
});

describe("listEvents", () => {
  it("returns newest first", async () => {
    await saveCapture(db, { transcript: "older", capturedAt: "2026-09-07T10:00:00.000Z" });
    await saveCapture(db, { transcript: "newer", capturedAt: "2026-09-07T12:00:00.000Z" });

    const rows = await listEvents(db);
    expect(rows.map((r) => r.transcript)).toEqual(["newer", "older"]);
  });

  it("can filter to a single day", async () => {
    await saveCapture(db, { transcript: "today", capturedAt: "2026-09-07T12:00:00.000Z" });
    await saveCapture(db, { transcript: "yesterday", capturedAt: "2026-09-06T12:00:00.000Z" });

    const rows = await listEvents(db, { day: "2026-09-07" });
    expect(rows).toHaveLength(1);
    expect(rows[0].transcript).toBe("today");
  });
});

describe("deleteEvent and undo", () => {
  it("removes the event and its blob", async () => {
    const blob = new Blob(["x"], { type: "image/jpeg" });
    const ev = await saveCapture(db, { kind: "photo", blob });

    await deleteEvent(db, ev.clientId);

    expect(await db.events.count()).toBe(0);
    expect(await db.blobs.get(ev.clientId)).toBeUndefined();
  });

  it("restores exactly what was deleted", async () => {
    const ev = await saveCapture(db, { transcript: "scratch that" });
    const undo = await deleteEvent(db, ev.clientId);

    await undoDelete(db, undo);

    const back = await db.events.get(ev.clientId);
    expect(back?.transcript).toBe("scratch that");
  });

  it("keeps a synced event's server id in the undo record", async () => {
    const ev = await saveCapture(db, { transcript: "already up" });
    await db.events.update(ev.clientId, { syncState: "synced", serverId: "srv-9" });

    const undo = await deleteEvent(db, ev.clientId);
    expect(undo.serverId).toBe("srv-9");
  });
});
