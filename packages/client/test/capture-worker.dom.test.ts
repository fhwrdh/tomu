/**
 * The sync worker's scheduling. Lives in the `client-dom` project (jsdom) for
 * `window`/`document`; the store and sync tests stay in node so IndexedDB can
 * hold real Blobs.
 */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CaptureDb } from "../src/offline/db.js";
import { saveCapture } from "../src/offline/store.js";
import { startSyncWorker, type Worker } from "../src/offline/worker.js";
import type { SyncApi } from "../src/offline/sync.js";

let db: CaptureDb;
let api: SyncApi;
let createEvent: ReturnType<typeof vi.fn>;
let worker: Worker | undefined;

beforeEach(async () => {
  db = new CaptureDb(`test-${crypto.randomUUID()}`);
  await db.open();
  createEvent = vi.fn(async (body: { clientId: string }) => ({
    id: `srv-${body.clientId.slice(0, 4)}`, clientId: body.clientId, parser: null, review: false,
  }));
  api = {
    createEvent,
    uploadPhoto: vi.fn(async () => ({})),
    fetchEvents: vi.fn(async () => []),
    deleteEvent: vi.fn(async () => {}),
    fetchGear: vi.fn(async () => ({ cameras: [], lenses: [], activeRolls: [] })),
  } as unknown as SyncApi;
});

afterEach(() => {
  worker?.stop();
  worker = undefined;
  vi.unstubAllGlobals();
});

describe("startSyncWorker", () => {
  it("syncs the queue as soon as it starts", async () => {
    await saveCapture(db, { transcript: "note" });
    worker = startSyncWorker(db, api);

    const result = await worker.syncNow();

    expect(result?.pushed).toBe(1);
    expect(createEvent).toHaveBeenCalledOnce();
  });

  it("syncs when connectivity comes back", async () => {
    worker = startSyncWorker(db, api);
    await worker.syncNow();
    createEvent.mockClear();
    await saveCapture(db, { transcript: "captured in a dead zone" });

    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(createEvent).toHaveBeenCalledOnce());
  });

  it("does nothing while the browser says it is offline", async () => {
    vi.stubGlobal("navigator", { ...window.navigator, onLine: false });
    await saveCapture(db, { transcript: "no signal" });
    worker = startSyncWorker(db, api);

    expect(await worker.syncNow()).toBeNull();
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("joins the pass already in flight instead of starting a second", async () => {
    await saveCapture(db, { transcript: "note" });
    let release: () => void = () => {};
    createEvent.mockImplementation(
      () => new Promise((resolve) => { release = () => resolve({ id: "srv-1", clientId: "x", parser: null, review: false }); }),
    );
    worker = startSyncWorker(db, api);

    const first = worker.syncNow();
    const second = worker.syncNow();
    // The pass reaches the network on a later microtask, so wait for the call
    // before releasing it.
    await vi.waitFor(() => expect(createEvent).toHaveBeenCalled());
    release();
    const [a, b] = await Promise.all([first, second]);

    // Both callers get the same pass, and the queue is sent once.
    expect(a).toBe(b);
    expect(createEvent).toHaveBeenCalledOnce();
  });

  it("stops listening once stopped", async () => {
    worker = startSyncWorker(db, api);
    await worker.syncNow();
    worker.stop();
    createEvent.mockClear();

    await saveCapture(db, { transcript: "after stop" });
    window.dispatchEvent(new Event("online"));

    expect(createEvent).not.toHaveBeenCalled();
  });
});
