import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CaptureDb, type LocalEvent } from "../src/offline/db.js";
import { deleteEvent, editField, saveCapture, saveGear, undoDelete } from "../src/offline/store.js";
import { syncOnce, type SyncApi } from "../src/offline/sync.js";

let db: CaptureDb;
let api: { [K in keyof SyncApi]: ReturnType<typeof vi.fn> };

const gear = {
  cameras: [{ id: "cam-m6", label: "Leica M6" }],
  lenses: [],
  activeRolls: [{ id: "roll-1", cameraId: "cam-m6", cameraLabel: "Leica M6", label: "Pan F", framesShot: 0, frameCount: 36 }],
};

/** A server response for an event the API has just accepted. */
function serverRow(ev: LocalEvent, over: Partial<Record<string, unknown>> = {}) {
  return { id: `srv-${ev.clientId.slice(0, 4)}`, clientId: ev.clientId, parser: null, review: false, ...over };
}

beforeEach(async () => {
  db = new CaptureDb(`test-${crypto.randomUUID()}`);
  await db.open();
  await saveGear(db, gear);
  api = {
    createEvent: vi.fn(async (body: { clientId: string }) => ({ id: `srv-${body.clientId.slice(0, 4)}`, clientId: body.clientId, parser: null, review: false })),
    uploadPhoto: vi.fn(async () => ({})),
    fetchEvents: vi.fn(async () => []),
    deleteEvent: vi.fn(async () => {}),
    fetchGear: vi.fn(async () => gear),
  } as never;
});

describe("pushing captures", () => {
  it("sends a queued event and marks it synced with the server id", async () => {
    const ev = await saveCapture(db, { transcript: "fog on the deck", rollId: "roll-1" });

    const result = await syncOnce(db, api as unknown as SyncApi);

    expect(result.pushed).toBe(1);
    expect(api.createEvent).toHaveBeenCalledOnce();
    const sent = api.createEvent.mock.calls[0][0];
    expect(sent.clientId).toBe(ev.clientId);
    expect(sent.transcript).toBe("fog on the deck");
    expect(sent.parser).toBe("regex");

    const after = await db.events.get(ev.clientId);
    expect(after?.syncState).toBe("synced");
    expect(after?.serverId).toBe(serverRow(ev).id);
  });

  it("sends the fields the phone parsed, and which of them were hand-corrected", async () => {
    const ev = await saveCapture(db, { transcript: "at 250 f8" });
    await editField(db, ev.clientId, "aperture", "f/11");

    await syncOnce(db, api as unknown as SyncApi);

    const sent = api.createEvent.mock.calls[0][0];
    expect(sent.shutterSpeed).toBe("1/250");
    expect(sent.aperture).toBe("f/11");
    expect(sent.editedFields).toEqual(["aperture"]);
  });

  it("does not resend an event that is already synced", async () => {
    await saveCapture(db, { transcript: "one" });
    await syncOnce(db, api as unknown as SyncApi);
    await syncOnce(db, api as unknown as SyncApi);

    expect(api.createEvent).toHaveBeenCalledOnce();
  });

  it("uploads the photo only after its event exists on the server", async () => {
    const blob = new Blob(["jpeg"], { type: "image/jpeg" });
    const ev = await saveCapture(db, { kind: "photo", blob });

    await syncOnce(db, api as unknown as SyncApi);

    expect(api.createEvent).toHaveBeenCalledBefore(api.uploadPhoto as never);
    expect(api.uploadPhoto.mock.calls[0][0]).toBe(`srv-${ev.clientId.slice(0, 4)}`);
    expect(api.uploadPhoto.mock.calls[0][2]).toBe("image/jpeg");

    const after = await db.events.get(ev.clientId);
    expect(after?.hasPendingBlob).toBe(false);
    // The local copy is dropped once the server has it — phone storage is scarce.
    expect(await db.blobs.get(ev.clientId)).toBeUndefined();
  });

  it("propagates a delete that happened after the event synced", async () => {
    const ev = await saveCapture(db, { transcript: "scratch that" });
    await syncOnce(db, api as unknown as SyncApi);
    const undo = await deleteEvent(db, ev.clientId);

    // The delete is queued in the store, so it survives the app closing.
    expect(await db.deletes.count()).toBe(1);
    await syncOnce(db, api as unknown as SyncApi);

    expect(api.deleteEvent).toHaveBeenCalledWith(undo.serverId);
    expect(await db.deletes.count()).toBe(0);
  });

  it("queues no server delete for an event that never synced", async () => {
    const ev = await saveCapture(db, { transcript: "typed and scratched" });
    await deleteEvent(db, ev.clientId);

    await syncOnce(db, api as unknown as SyncApi);

    expect(api.deleteEvent).not.toHaveBeenCalled();
    expect(api.createEvent).not.toHaveBeenCalled();
  });

  it("undo cancels a delete that has not gone out yet", async () => {
    const ev = await saveCapture(db, { transcript: "wait, keep it" });
    await syncOnce(db, api as unknown as SyncApi);
    const undo = await deleteEvent(db, ev.clientId);
    await undoDelete(db, undo);

    await syncOnce(db, api as unknown as SyncApi);

    expect(api.deleteEvent).not.toHaveBeenCalled();
    expect(await db.events.get(ev.clientId)).toBeDefined();
  });

  it("keeps retrying a delete the server could not take, but drops it on 404", async () => {
    const ev = await saveCapture(db, { transcript: "gone" });
    await syncOnce(db, api as unknown as SyncApi);
    await deleteEvent(db, ev.clientId);

    api.deleteEvent.mockRejectedValueOnce(new Error("offline"));
    await syncOnce(db, api as unknown as SyncApi);
    expect(await db.deletes.count()).toBe(1);

    api.deleteEvent.mockRejectedValueOnce(Object.assign(new Error("Event not found"), { status: 404 }));
    await syncOnce(db, api as unknown as SyncApi);
    expect(await db.deletes.count()).toBe(0);
  });
});

describe("pulling parse results", () => {
  it("fills tier-2 fields and moves the event to parsed", async () => {
    const ev = await saveCapture(db, { transcript: "fog" });
    await syncOnce(db, api as unknown as SyncApi);

    api.fetchEvents.mockResolvedValue([
      serverRow(ev, { parser: "claude:claude-haiku-4-5", subject: "ferry deck", locationName: "Bainbridge", shutterSpeed: "1/250" }),
    ]);
    await syncOnce(db, api as unknown as SyncApi);

    const after = await db.events.get(ev.clientId);
    expect(after?.syncState).toBe("parsed");
    expect(after?.subject).toBe("ferry deck");
    expect(after?.locationName).toBe("Bainbridge");
    expect(after?.shutterSpeed).toBe("1/250");
  });

  it("flags an event the model wants looked at", async () => {
    const ev = await saveCapture(db, { transcript: "fog" });
    await syncOnce(db, api as unknown as SyncApi);

    api.fetchEvents.mockResolvedValue([
      serverRow(ev, { parser: "claude:x", review: true, parseNotes: "camera named has no active roll" }),
    ]);
    await syncOnce(db, api as unknown as SyncApi);

    const after = await db.events.get(ev.clientId);
    expect(after?.syncState).toBe("needs_review");
    expect(after?.parseNotes).toBe("camera named has no active roll");
  });

  it("leaves an event synced while tier 2 has not run yet", async () => {
    const ev = await saveCapture(db, { transcript: "fog" });
    await syncOnce(db, api as unknown as SyncApi);

    // Tier 2 runs after the create returns, so the first pull often sees regex.
    api.fetchEvents.mockResolvedValue([serverRow(ev, { parser: "regex" })]);
    await syncOnce(db, api as unknown as SyncApi);

    expect((await db.events.get(ev.clientId))?.syncState).toBe("synced");
  });

  it("never lets the server overwrite a hand-edited field", async () => {
    const ev = await saveCapture(db, { transcript: "at 250 f8" });
    await editField(db, ev.clientId, "aperture", "f/11");
    await syncOnce(db, api as unknown as SyncApi);

    api.fetchEvents.mockResolvedValue([
      serverRow(ev, { parser: "claude:x", aperture: "f/2", subject: "a barn" }),
    ]);
    await syncOnce(db, api as unknown as SyncApi);

    const after = await db.events.get(ev.clientId);
    expect(after?.aperture).toBe("f/11");
    expect(after?.subject).toBe("a barn");
  });

  it("never lets the server rewrite the transcript", async () => {
    const ev = await saveCapture(db, { transcript: "the ramble, as spoken" });
    await syncOnce(db, api as unknown as SyncApi);

    api.fetchEvents.mockResolvedValue([
      serverRow(ev, { parser: "claude:x", transcript: "tidied up by a robot" }),
    ]);
    await syncOnce(db, api as unknown as SyncApi);

    expect((await db.events.get(ev.clientId))?.transcript).toBe("the ramble, as spoken");
  });
});

describe("failure handling", () => {
  it("keeps an event queued and backs off after a network failure", async () => {
    const ev = await saveCapture(db, { transcript: "ferry" });
    api.createEvent.mockRejectedValue(new Error("offline"));

    const result = await syncOnce(db, api as unknown as SyncApi);
    expect(result.failed).toBe(1);

    const after = await db.events.get(ev.clientId);
    expect(after?.syncState).toBe("queued");
    expect(after?.attempts).toBe(1);
    expect(after?.nextAttemptAt).toBeGreaterThan(Date.now());
    expect(after?.error).toContain("offline");
  });

  it("backs off further with each failure", async () => {
    const ev = await saveCapture(db, { transcript: "ferry" });
    api.createEvent.mockRejectedValue(new Error("offline"));

    await syncOnce(db, api as unknown as SyncApi);
    const first = (await db.events.get(ev.clientId))!.nextAttemptAt!;
    await db.events.update(ev.clientId, { nextAttemptAt: 0 });
    await syncOnce(db, api as unknown as SyncApi);
    const second = (await db.events.get(ev.clientId))!.nextAttemptAt!;

    expect(second - Date.now()).toBeGreaterThan(first - Date.now());
  });

  it("skips an item that is still backing off, without blocking the others", async () => {
    const waiting = await saveCapture(db, { transcript: "waiting" });
    await db.events.update(waiting.clientId, { nextAttemptAt: Date.now() + 60_000, attempts: 1 });
    await saveCapture(db, { transcript: "ready" });

    const result = await syncOnce(db, api as unknown as SyncApi);

    expect(result.pushed).toBe(1);
    expect(api.createEvent).toHaveBeenCalledOnce();
    expect(api.createEvent.mock.calls[0][0].transcript).toBe("ready");
  });

  it("marks a rejected event as an error and stops retrying it", async () => {
    // A 4xx means the event is wrong, not the network — retrying cannot help.
    const ev = await saveCapture(db, { transcript: "bad" });
    api.createEvent.mockRejectedValue(Object.assign(new Error("Validation failed"), { status: 400 }));

    await syncOnce(db, api as unknown as SyncApi);
    const after = await db.events.get(ev.clientId);
    expect(after?.syncState).toBe("error");

    await syncOnce(db, api as unknown as SyncApi);
    expect(api.createEvent).toHaveBeenCalledOnce();
  });

  it("one failing event does not stop the rest of the queue", async () => {
    await saveCapture(db, { transcript: "first" });
    await saveCapture(db, { transcript: "second" });
    api.createEvent
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ id: "srv-2", clientId: "x", parser: null, review: false });

    const result = await syncOnce(db, api as unknown as SyncApi);

    expect(api.createEvent).toHaveBeenCalledTimes(2);
    expect(result.pushed).toBe(1);
    expect(result.failed).toBe(1);
  });

  it("a failed photo upload leaves the event synced and the blob queued", async () => {
    const blob = new Blob(["jpeg"], { type: "image/jpeg" });
    const ev = await saveCapture(db, { kind: "photo", blob });
    api.uploadPhoto.mockRejectedValue(new Error("timeout"));

    await syncOnce(db, api as unknown as SyncApi);

    const after = await db.events.get(ev.clientId);
    expect(after?.syncState).toBe("synced");
    expect(after?.hasPendingBlob).toBe(true);
    expect(await db.blobs.get(ev.clientId)).toBeDefined();
  });
});

describe("gear cache", () => {
  it("refreshes after a successful sync", async () => {
    await saveCapture(db, { transcript: "x" });
    api.fetchGear.mockResolvedValue({
      ...gear,
      activeRolls: [{ id: "roll-2", cameraId: "cam-m6", cameraLabel: "Leica M6", label: "HP5", framesShot: 3, frameCount: 36 }],
    });

    await syncOnce(db, api as unknown as SyncApi);

    const cached = await db.gear.get("gear");
    expect(cached?.activeRolls[0].id).toBe("roll-2");
  });

  it("keeps the previous cache when the refresh fails", async () => {
    api.fetchGear.mockRejectedValue(new Error("offline"));

    await syncOnce(db, api as unknown as SyncApi);

    const cached = await db.gear.get("gear");
    expect(cached?.activeRolls[0].id).toBe("roll-1");
  });
});
