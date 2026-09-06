/**
 * Match phone photos to field captures by time.
 *
 * The photographer takes the phone photo, then speaks the settings, so the
 * photo is normally a little *before* the capture's timestamp. Window is
 * [capturedAt − 10 min, capturedAt + 2 min]; nearest wins; on an exact tie the
 * earlier photo wins; if the two nearest candidates are within 30 s of each
 * other the match is ambiguous and left for a human. A photo is given to at
 * most one capture per run.
 */

export interface MatchCapture {
  id: string;
  /** ISO timestamp. */
  capturedAt: string;
}

export interface CandidatePhoto {
  uuid: string;
  /** ISO timestamp (UTC). */
  takenAt: string;
}

export interface MatchOptions {
  windowBeforeMin?: number;
  windowAfterMin?: number;
  /** Two nearest candidates closer than this (seconds) → ambiguous. */
  ambiguitySeconds?: number;
  /** Asset ids already attached to some capture — never candidates. */
  usedAssetIds?: Set<string>;
  /** captureId → photo uuid, decided by a human; bypasses the window. */
  forced?: Map<string, string>;
}

export interface MatchResult {
  captureId: string;
  status: "matched" | "ambiguous" | "none";
  photoUuid?: string;
  /** photo time − capture time, in seconds (negative = photo taken first). */
  deltaSeconds?: number;
  forced?: boolean;
  /** For ambiguous results: the nearest candidates, nearest first. */
  candidates?: Array<{ uuid: string; deltaSeconds: number }>;
}

const DEFAULTS = { windowBeforeMin: 10, windowAfterMin: 2, ambiguitySeconds: 30 };

export function matchPhotos(
  captures: MatchCapture[],
  photos: CandidatePhoto[],
  opts: MatchOptions = {},
): MatchResult[] {
  const o = { ...DEFAULTS, ...opts };
  const used = new Set(o.usedAssetIds ?? []);
  const byUuid = new Map(photos.map((p) => [p.uuid, p]));

  // Pass 1: each capture's ranked candidates (forced pairings resolved first).
  type Ranked = { uuid: string; deltaSeconds: number };
  const ranked = new Map<string, Ranked[]>();
  const results = new Map<string, MatchResult>();

  for (const c of captures) {
    const forcedUuid = o.forced?.get(c.id);
    if (forcedUuid && byUuid.has(forcedUuid)) {
      const t = Date.parse(byUuid.get(forcedUuid)!.takenAt) - Date.parse(c.capturedAt);
      results.set(c.id, { captureId: c.id, status: "matched", photoUuid: forcedUuid, deltaSeconds: Math.round(t / 1000), forced: true });
      used.add(forcedUuid);
      continue;
    }
    const t0 = Date.parse(c.capturedAt);
    const lo = t0 - o.windowBeforeMin * 60_000;
    const hi = t0 + o.windowAfterMin * 60_000;
    const cands: Ranked[] = [];
    for (const p of photos) {
      if (used.has(p.uuid)) continue;
      const tp = Date.parse(p.takenAt);
      if (tp < lo || tp > hi) continue;
      cands.push({ uuid: p.uuid, deltaSeconds: Math.round((tp - t0) / 1000) });
    }
    cands.sort((a, b) => {
      const da = Math.abs(a.deltaSeconds);
      const db = Math.abs(b.deltaSeconds);
      if (da !== db) return da - db;
      return a.deltaSeconds - b.deltaSeconds; // tie → earlier (more negative) first
    });
    ranked.set(c.id, cands);
  }

  // Pass 2: detect photos wanted by more than one capture.
  const claims = new Map<string, string[]>();
  for (const [cid, cands] of ranked) {
    const top = cands[0];
    if (!top) continue;
    claims.set(top.uuid, [...(claims.get(top.uuid) ?? []), cid]);
  }

  for (const c of captures) {
    if (results.has(c.id)) continue;
    const cands = ranked.get(c.id) ?? [];
    const top = cands[0];
    if (!top) {
      results.set(c.id, { captureId: c.id, status: "none" });
      continue;
    }
    const contested = (claims.get(top.uuid)?.length ?? 0) > 1;
    const runnerUp = cands[1];
    const tooClose = runnerUp != null && Math.abs(runnerUp.deltaSeconds - top.deltaSeconds) <= o.ambiguitySeconds;
    if (contested || tooClose) {
      results.set(c.id, { captureId: c.id, status: "ambiguous", candidates: cands.slice(0, 3) });
      continue;
    }
    results.set(c.id, { captureId: c.id, status: "matched", photoUuid: top.uuid, deltaSeconds: top.deltaSeconds });
  }

  return captures.map((c) => results.get(c.id)!);
}
