import { useCallback, useEffect, useRef, useState } from "react";
import { db } from "../offline/db.js";
import { startSyncWorker, type Worker } from "../offline/worker.js";
import type { SyncApi, SyncResult } from "../offline/sync.js";

/**
 * Owns the sync worker for as long as the screen is mounted, and reports
 * whether a pass is in flight so the UI can say so honestly — on iOS nothing
 * syncs while the app is closed, and pretending otherwise would be a lie the
 * user only discovers when a note is missing.
 */
export function useSyncWorker(api?: SyncApi) {
  const worker = useRef<Worker | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);

  useEffect(() => {
    worker.current = startSyncWorker(db, api, setLastResult);
    return () => {
      worker.current?.stop();
      worker.current = null;
    };
  }, [api]);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    try {
      return await worker.current?.syncNow();
    } finally {
      setSyncing(false);
    }
  }, []);

  return { syncNow, syncing, lastResult };
}
