// ── Display helpers ──
//
// Tools return markdown, not JSON: the reader is a model that should not have to
// re-derive presentation from rows. These are the shared pieces of that.

import { formatDevId } from "@tomu/shared";
import type {
  ActiveRoll,
  AnyRoll,
  CandidateGroup,
  FieldEventRow,
  InventoryItem,
  InventoryRow,
  PlanLoad,
  TankRow,
} from "./types.js";
import { displayStock } from "./matching.js";

export function describeItem(item: InventoryItem): string {
  if (item.form === "bulk_roll") {
    const remaining = item.remainingLengthFt ? Number(item.remainingLengthFt) : 0;
    const original = item.originalLengthFt ? Number(item.originalLengthFt) : 0;
    return `${remaining}ft / ${original}ft bulk ${item.format}`;
  }
  if (item.form === "sheet") {
    return `${item.quantity} sheets ${item.format}`;
  }
  return `${item.quantity} rolls ${item.format}`;
}

// ── Tool: tomu_inventory ──


/**
 * Normalize a loose expiration string to YYYY-MM-DD. Film boxes print month
 * precision ("2027.12" / "2027-12") or just a year; we store the *last day* of
 * that month/year so the stock counts as good through the printed period and
 * string-compares correctly against the expiring-soon cutoff.
 */
export function coerceExpiration(input: string): string {
  const s = input.trim().replace(/[./]/g, "-");
  const ymd = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymd) {
    const [, y, m, d] = ymd;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const ym = s.match(/^(\d{4})-(\d{1,2})$/);
  if (ym) {
    const [, y, m] = ym;
    const lastDay = new Date(Number(y), Number(m), 0).getDate();
    return `${y}-${m.padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  }
  const yOnly = s.match(/^(\d{4})$/);
  if (yOnly) return `${yOnly[1]}-12-31`;
  return input; // leave anything unexpected untouched
}

/** One-line rendering of a lot, for disambiguation lists and delete confirmations. */
export function describeLot(r: InventoryRow): string {
  const id = r.displayId ? `[${r.displayId}] ` : `[${r.id.slice(0, 8)}] `;
  const exp = r.expirationDate ? `, exp ${r.expirationDate}` : "";
  const src = r.source ? `, src ${r.source}` : "";
  return `${id}${displayStock(r.manufacturer, r.stockName)} — ${describeItem(r as unknown as InventoryItem)}${exp}${src}`;
}

export function describeRoll(r: ActiveRoll): string {
  const cam = r.cameraMake ? `${r.cameraMake} ${r.cameraModel}` : "no camera";
  return `${displayStock(r.manufacturer, r.stockName)} (${r.format}) in ${cam} — ${r.framesShot}/${r.frameCount} frames`;
}

// ── Tool: tomu_load ───────────────────────────────────────────────────

export function rollLabel(r: { displayId?: string | null; devDate?: string | null; devSeq?: number | null; id: string }): string {
  return r.displayId ?? formatDevId(r.devDate, r.devSeq) ?? r.id.slice(0, 8);
}

export function eventLine(e: FieldEventRow, rollsById: Map<string, AnyRoll>): string {
  const settings = [e.shutterSpeed, e.aperture, e.compensation].filter(Boolean).join(" ");
  const roll = e.rollId ? rollsById.get(e.rollId) : undefined;
  const where = roll ? `roll ${rollLabel(roll)}` : "loose";
  const when = e.capturedAt.slice(0, 16).replace("T", " ");
  const frame = e.frameNumber != null ? ` · frame ${e.frameNumber}${e.frameProvisional ? "?" : ""}` : e.sheetId ? ` · sheet ${e.sheetId}` : "";
  const state = e.status === "pending" ? (e.review ? "NEEDS REVIEW" : "pending") : e.status;
  const head = e.kind === "photo" ? "📷 photo" : settings || "(no settings)";
  return `**${e.shortId}** · ${when} · ${where}${frame} · ${head}${e.subject ? ` · ${e.subject}` : ""} · ${state}`;
}

export function formatTime(seconds: number | null): string {
  if (seconds == null) return "?";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}min` : `${m}:${String(s).padStart(2, "0")}`;
}

/** A, B, …, Z, AA, AB, …, AZ, BA, … — Excel-style group labels. */
export function groupLabel(i: number): string {
  let s = "";
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export function tankLine(t: TankRow): string {
  const cap =
    t.kind === "sheet"
      ? `${t.sheetCapacity}× 4x5`
      : `${Number(t.reelUnits)} reel units (120 = 1.5)`;
  const qty = t.quantity > 1 ? ` ×${t.quantity}` : "";
  const inactive = t.isActive ? "" : " [retired]";
  return `- **${t.name}**${qty}${inactive} — ${t.volumeMl} ml, ${cap}, ${t.agitation}${t.notes ? ` — ${t.notes}` : ""}`;
}

export const TIER_LABEL: Record<PlanLoad["tier"], string> = {
  intended: "tier 1: intended (labels)",
  history: "tier 2: historical",
  mdc: "tier 3: MDC (community)",
  "stock-iso": "tier 4: clustered",
};
