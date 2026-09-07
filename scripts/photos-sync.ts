#!/usr/bin/env tsx
/**
 * Attach iPhone photos (via the Mac Photos library) to Tomu field events by time.
 *
 * A voice event with no nearby photo event is a sync candidate. On match, this
 * creates a `photo` field event (linked to the voice event's roll, if any) and
 * uploads the exported jpeg to it.
 *
 * Needs: `pip install osxphotos`, and TOMU_API_URL + TOMU_API_TOKEN in .env.
 * Usage: npm run photos:sync -- [--dry-run] [--since 14] [--force <eventIdPrefix>=<photo-uuid>]...
 *        [--window-before 10] [--window-after 2]
 */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { matchPhotos, type CandidatePhoto, type MatchCapture } from "@tomu/shared";

const run = promisify(execFile);
const API = process.env.TOMU_API_URL || "http://localhost:3456/api/v1";
const TOKEN = process.env.TOMU_API_TOKEN || "";
if (!TOKEN) { console.error("TOMU_API_TOKEN missing (.env)"); process.exit(2); }

// ── args ──
const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(n);
const opt = (n: string, d: string) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const dryRun = flag("--dry-run");
const sinceDays = Number(opt("--since", "14"));
const windowBeforeMin = Number(opt("--window-before", "10"));
const windowAfterMin = Number(opt("--window-after", "2"));
const forcedArg = new Map<string, string>();
argv.forEach((a, i) => {
  if (a !== "--force" || !argv[i + 1]) return;
  const raw = argv[i + 1];
  const eq = raw.indexOf("=");
  const c = eq < 0 ? raw : raw.slice(0, eq);
  const u = eq < 0 ? "" : raw.slice(eq + 1);
  if (!c || !u) { console.error(`warning: --force ${raw} ignored: malformed (expected <eventIdPrefix>=<photo-uuid>)`); return; }
  if (c.length < 8) { console.error(`warning: --force ${raw} ignored: event id prefix must be at least 8 characters`); return; }
  forcedArg.set(c.toLowerCase(), u);
});

interface FieldEvent {
  id: string;
  shortId: string;
  clientId: string;
  kind: "voice" | "photo";
  capturedAt: string;
  rollId: string | null;
  photoAssetId: string | null;
  fileKey: string | null;
}
interface OsxPhoto { uuid: string; date: string; latitude: number | null; longitude: number | null; original_filename: string; ismissing: boolean }

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, ...(init.headers as Record<string, string> ?? {}) } });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

function isoMinus(ms: number, from = Date.now()) { return new Date(from - ms).toISOString(); }

/**
 * Deterministic clientId for a photo event, derived from the Photos asset uuid (uuid-v5
 * style: sha1 over a fixed namespace string, version nibble + variant bits set). Same
 * asset uuid always yields the same clientId, so re-running photos:sync hits the
 * idempotent create (200, existing row) instead of duplicating a photo event.
 */
function photoClientId(assetUuid: string): string {
  const hash = createHash("sha1").update(`tomu-photo:${assetUuid}`).digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant RFC 4122
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

async function osxQuery(fromIso: string, toIso: string): Promise<OsxPhoto[]> {
  const { stdout } = await run("osxphotos", ["query", "--json", "--only-photos", "--from-date", fromIso, "--to-date", toIso], { maxBuffer: 64 * 1024 * 1024 });
  return stdout.trim() ? (JSON.parse(stdout) as OsxPhoto[]) : [];
}

async function osxExport(uuid: string, dir: string): Promise<string> {
  await run("osxphotos", ["export", dir, "--uuid", uuid, "--convert-to-jpeg", "--jpeg-quality", "0.9", "--download-missing", "--filename", "{uuid}", "--overwrite"]);
  const files = (await readdir(dir)).filter((f) => {
    const l = f.toLowerCase();
    return l.startsWith(uuid.toLowerCase()) && (l.endsWith(".jpeg") || l.endsWith(".jpg"));
  });
  if (!files.length) throw new Error(`export produced no jpeg for ${uuid}`);
  return join(dir, files[0]);
}

async function main() {
  const since = isoMinus(sinceDays * 86_400_000);
  const [{ data: voiceEvents }, { data: photoEvents }] = await Promise.all([
    api<{ data: FieldEvent[] }>(`/field-events?status=all&kind=voice&since=${encodeURIComponent(since)}&limit=500`),
    api<{ data: FieldEvent[] }>(`/field-events?status=all&kind=photo&since=${encodeURIComponent(since)}&limit=500`),
  ]);
  const usedAssetIds = new Set(photoEvents.map((e) => e.photoAssetId).filter((x): x is string => !!x));

  // A voice event that already has an uploaded photo event (same asymmetric window used for
  // matching) on the same roll is done. A photo event with no fileKey (create succeeded,
  // upload failed) doesn't count here — it's retryable, so the voice event stays a candidate
  // and the retry below reuses that row via the deterministic clientId.
  const todo = voiceEvents.filter((v) => {
    const t = Date.parse(v.capturedAt);
    return !photoEvents.some((p) => {
      if (p.rollId !== v.rollId || !p.fileKey) return false;
      const dt = Date.parse(p.capturedAt) - t;
      return dt >= -windowBeforeMin * 60_000 && dt <= windowAfterMin * 60_000;
    });
  });

  // Resolve --force event-id prefixes against candidate voice events now, so a missing one is
  // reported even when there's nothing else to sync.
  const forceCaps = new Map<string, { ev: FieldEvent; uuid: string }>();
  for (const [prefix, uuid] of forcedArg) {
    const ev = todo.find((e) => e.id.toLowerCase().startsWith(prefix));
    if (!ev) { console.error(`warning: --force ${prefix}=${uuid} ignored: no candidate voice event matching ${prefix}`); continue; }
    forceCaps.set(prefix, { ev, uuid });
  }

  if (!todo.length) { console.log("Nothing to sync: every voice event in range already has a photo."); return; }

  // One osxphotos query spanning all candidates (cheaper than one per event).
  const times = todo.map((e) => Date.parse(e.capturedAt));
  const from = isoMinus(windowBeforeMin * 60_000, Math.min(...times));
  const to = new Date(Math.max(...times) + windowAfterMin * 60_000).toISOString();
  const photos = await osxQuery(from, to);
  const byUuid = new Map(photos.map((p) => [p.uuid, p]));
  const cands: CandidatePhoto[] = photos.map((p) => ({ uuid: p.uuid, takenAt: new Date(p.date).toISOString() }));

  const forced = new Map<string, string>();
  for (const [prefix, { ev, uuid }] of forceCaps) {
    if (!byUuid.has(uuid)) { console.error(`warning: --force ${prefix}=${uuid} ignored: photo ${uuid} not among queried candidates`); continue; }
    forced.set(ev.id, uuid);
  }
  const caps: MatchCapture[] = todo.map((e) => ({ id: e.id, capturedAt: e.capturedAt }));
  const results = matchPhotos(caps, cands, { usedAssetIds, forced, windowBeforeMin, windowAfterMin });

  const tmp = await mkdtemp(join(tmpdir(), "tomu-photos-"));
  const rows: string[][] = [["capture", "captured at", "status", "photo", "delta"]];
  try {
    for (const r of results) {
      const ev = todo.find((e) => e.id === r.captureId)!;
      const when = ev.capturedAt.slice(0, 16).replace("T", " ");
      if (r.status === "none") { rows.push([ev.shortId, when, "no photo", "", ""]); continue; }
      if (r.status === "ambiguous") {
        rows.push([ev.shortId, when, "AMBIGUOUS", (r.candidates ?? []).map((c) => `${c.uuid.slice(0, 8)} (${c.deltaSeconds}s)`).join(" | "), ""]);
        continue;
      }
      const p = byUuid.get(r.photoUuid!)!;
      if (dryRun) { rows.push([ev.shortId, when, "would create", p.original_filename, `${r.deltaSeconds}s`]); continue; }
      const file = await osxExport(p.uuid, tmp);
      const photoTakenAt = new Date(p.date).toISOString();
      const { data: photoEvent } = await api<{ data: FieldEvent }>("/field-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: photoClientId(p.uuid),
          kind: "photo",
          rollId: ev.rollId ?? undefined,
          capturedAt: photoTakenAt,
        }),
      });
      const form = new FormData();
      form.set("file", new Blob([await readFile(file)], { type: "image/jpeg" }), `${p.uuid}.jpg`);
      form.set("photoTakenAt", photoTakenAt);
      if (p.latitude != null) form.set("latitude", String(p.latitude));
      if (p.longitude != null) form.set("longitude", String(p.longitude));
      form.set("photoAssetId", p.uuid);
      await api(`/field-events/${photoEvent.id}/photo`, { method: "POST", body: form });
      rows.push([ev.shortId, when, "created", p.original_filename, `${r.deltaSeconds}s`]);
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }

  const w = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  for (const r of rows) console.log(r.map((c, i) => c.padEnd(w[i])).join("  "));
  const amb = results.filter((r) => r.status === "ambiguous").length;
  if (amb) console.log(`\n${amb} ambiguous — resolve with: npm run photos:sync -- --force <eventIdPrefix>=<photo-uuid>`);
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
