// ── Resolution (Postel's Law) ──
//
// Turning what was said ("the M6", "Tri-X", a short id) into a specific record.
// Scoring lives in matching.ts; these wrap it with the API lookups.

import { api } from "./api.js";
import { bestMatch, cleanStockName, fuzzyMatch, normalize, rankedMatch, strictStockMatch } from "./matching.js";
import type { ActiveRoll, AnyRoll, InventoryRow } from "./types.js";
import { formatDevId } from "@tomu/shared";
import { displayStock } from "./matching.js";
import { describeLot } from "./format.js";

/**
 * Resolve exactly one inventory lot from a loose identifier, or explain why not.
 * Shared by tomu_edit_inventory and tomu_delete_inventory so both refuse to guess
 * in the same way. Returns `{ lot }` on a clean hit, `{ text }` otherwise.
 */
export async function resolveLot(opts: {
  film?: string;
  displayId?: string;
  format?: string;
  form?: string;
}): Promise<{ lot: InventoryRow } | { text: string }> {
  const { film, displayId, format, form } = opts;
  const { data: rows } = await api<{ data: InventoryRow[] }>("/inventory");

  let candidates: InventoryRow[];
  if (displayId) {
    candidates = rows.filter((r) => r.displayId === displayId);
    if (candidates.length === 0) {
      return { text: `No inventory lot with displayId "${displayId}".` };
    }
  } else {
    const m = rankedMatch(film!, rows, (r) => [`${r.manufacturer} ${r.stockName}`, r.stockName, r.manufacturer]);
    if (m.kind === "none") {
      return { text: `No inventory lot matching "${film}".` };
    }
    candidates = m.kind === "single" ? [m.item] : m.items;
    // Narrow by format/form when provided
    if (format) candidates = candidates.filter((r) => r.format === format);
    if (form) candidates = candidates.filter((r) => r.form === form);
  }

  if (candidates.length === 0) {
    return { text: `Matched the stock, but no lot with that format/form. Drop the format/form filter to see options.` };
  }
  if (candidates.length > 1) {
    const lines = candidates.map((r) => `- ${describeLot(r)}`);
    return { text: `Multiple lots match — narrow with format/form (or displayId):\n${lines.join("\n")}` };
  }
  return { lot: candidates[0] };
}

export async function listActiveRolls(): Promise<ActiveRoll[]> {
  const { data } = await api<{ data: ActiveRoll[] }>("/rolls?status=active");
  return data;
}

/** Find a single active roll, optionally filtered by a fuzzy camera hint. Returns {roll} or {error}. */
export async function pickActiveRoll(cameraHint?: string): Promise<{ roll?: ActiveRoll; error?: string }> {
  const rolls = await listActiveRolls();
  if (rolls.length === 0) return { error: "No active rolls. Load one first with tomu_load." };

  const candidates = cameraHint
    ? rolls.filter(
        (r) =>
          // Must have an actual camera to match a camera hint — otherwise
          // camera-less rolls (e.g. loaded 4x5 sheets) fuzzy-match every hint
          // because their empty make/model are trivially "contained" in it.
          (r.cameraMake || r.cameraModel) &&
          fuzzyMatch(cameraHint, r.cameraMake ?? "", r.cameraModel ?? "", `${r.cameraMake ?? ""} ${r.cameraModel ?? ""}`),
      )
    : rolls;

  if (candidates.length === 0) {
    return { error: `No active roll matching camera "${cameraHint}". Active: ${rolls.map((r) => `${r.cameraMake} ${r.cameraModel}`).join(", ")}` };
  }
  if (candidates.length > 1) {
    return {
      error: `Multiple active rolls — specify a camera. Active: ${candidates.map((r) => `${r.cameraMake} ${r.cameraModel} (${displayStock(r.manufacturer, r.stockName)})`).join(", ")}`,
    };
  }
  return { roll: candidates[0] };
}

/** Resolve a roll by display id ("20260906.1"), Dev Id ("20260906.0741"), bare dev seq ("741"), or uuid prefix. */
export async function resolveRollHandle(handle: string): Promise<{ roll?: AnyRoll; error?: string }> {
  const h = handle.trim();
  const { data } = await api<{ data: AnyRoll[] }>("/rolls?status=all");
  const hits = data.filter((r) => {
    if (r.displayId === h) return true;
    if (formatDevId(r.devDate, r.devSeq) === h) return true;
    if (/^\d{1,5}$/.test(h) && r.devSeq === Number(h)) return true;
    return h.length >= 8 && r.id.startsWith(h.toLowerCase());
  });
  if (hits.length === 1) return { roll: hits[0] };
  if (hits.length === 0) return { error: `No roll matches "${h}". Use a display id (20260906.1), Dev Id (20260906.0741), or dev seq (741).` };
  return { error: `"${h}" matches ${hits.length} rolls: ${hits.map((r) => r.displayId ?? r.id.slice(0, 8)).join(", ")}` };
}

export async function rollsIndex(): Promise<Map<string, AnyRoll>> {
  const { data } = await api<{ data: AnyRoll[] }>("/rolls?status=all");
  return new Map(data.map((r) => [r.id, r]));
}
