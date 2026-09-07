/**
 * Schedules sync passes. There is no Background Sync API on iOS, so this runs
 * in the page: on regaining connectivity, on becoming visible again, after each
 * save, and on a slow timer while open. Anything captured in a dead zone waits
 * in IndexedDB until one of those fires — the capture itself never waited.
 */
import { db as defaultDb, type CaptureDb } from "./db.js";
import { syncOnce, type SyncApi, type SyncResult } from "./sync.js";

const IDLE_INTERVAL_MS = 60_000;

export interface Worker {
  /** Run a pass now (after a save, or a pull-to-refresh). Never throws. */
  syncNow(): Promise<SyncResult | null>;
  stop(): void;
}

export function startSyncWorker(
  db: CaptureDb = defaultDb,
  api?: SyncApi,
  onResult?: (result: SyncResult) => void,
): Worker {
  /** The pass in flight, if any. Callers join it rather than starting a second. */
  let current: Promise<SyncResult | null> | null = null;
  let stopped = false;

  // Loaded on first use, not at import: the real implementation reaches for the
  // auth token in localStorage, which not every caller (or test) has.
  const resolveApi = async (): Promise<SyncApi> => api ?? (await import("./api.js")).syncApi;

  async function run(): Promise<SyncResult | null> {
    try {
      const result = await syncOnce(db, await resolveApi());
      onResult?.(result);
      return result;
    } catch {
      // syncOnce already isolates per-item failures; this is the belt and braces.
      return null;
    }
  }

  function pass(): Promise<SyncResult | null> {
    if (stopped) return Promise.resolve(null);
    if (typeof navigator !== "undefined" && navigator.onLine === false) return Promise.resolve(null);
    // One pass at a time — a second would re-send a queue the first is draining.
    // Callers join the pass in flight instead of being told "no".
    if (current) return current;
    current = run().finally(() => { current = null; });
    return current;
  }

  const onOnline = () => void pass();
  const onVisible = () => {
    if (document.visibilityState === "visible") void pass();
  };

  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisible);
  const timer = window.setInterval(() => void pass(), IDLE_INTERVAL_MS);

  void pass();

  return {
    syncNow: pass,
    stop() {
      stopped = true;
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    },
  };
}
