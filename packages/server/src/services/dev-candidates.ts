import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { normalizeDilution } from "@tomu/shared";
import { db } from "../db/client.js";
import { devRecipes, devSessions, filmStocks, rolls } from "../db/schema.js";

// Recipe grouping for shot-but-undeveloped rolls. Extracted from the
// /dev-sessions/candidates route so the tank planner can reuse it verbatim —
// groups are the atomic unit of tank planning (zero recipe tolerance).
//
// Tier 1: rolls with explicit intended-dev (from bag/canister labels).
// Tier 2: rolls without intended-dev → most recent completed session for (stockId, ratedIso).
// Tier 3 (MDC): rolls with no history → Massive Dev Chart lookup for the user's
//               preferred developers. Exact ISO, falling back to nearest within ±20%.
// Tier 4: still nothing → cluster by (stock, ratedIso) so the user can pick manually.

export interface CandidateRoll {
  id: string;
  displayId: string | null;
  filmStockId: string;
  ratedIso: number | null;
  format: string;
  manufacturer: string;
  stockName: string;
  stockIso: number;
  loadedAt: Date | null;
  tags: string[];
  intendedDeveloper: string | null;
  intendedDilution: string | null;
  intendedDilutionRaw: string | null;
  intendedDevTimeSeconds: number | null;
}

export interface CandidateRecipe {
  developer: string | null;
  dilution: string | null;
  devTimeSeconds: number | null;
  temperatureC: string | null;
  mdcAsaIso?: number | null;
}

export interface CandidateGroup {
  recipeKey: string;
  tier: "intended" | "history" | "mdc" | "stock-iso";
  recipe: CandidateRecipe | null;
  rolls: CandidateRoll[];
}

const DEV_PREF = ["HC-110", "Rodinal", "510-Pyro"];

export async function computeDevCandidates(userId: string): Promise<CandidateGroup[]> {
  const shotRolls: CandidateRoll[] = await db
    .select({
      id: rolls.id,
      displayId: rolls.displayId,
      filmStockId: rolls.filmStockId,
      ratedIso: rolls.ratedIso,
      format: rolls.format,
      manufacturer: filmStocks.manufacturer,
      stockName: filmStocks.name,
      stockIso: filmStocks.iso,
      loadedAt: rolls.loadedAt,
      tags: rolls.tags,
      intendedDeveloper: rolls.intendedDeveloper,
      intendedDilution: rolls.intendedDilution,
      intendedDilutionRaw: rolls.intendedDilutionRaw,
      intendedDevTimeSeconds: rolls.intendedDevTimeSeconds,
    })
    .from(rolls)
    .innerJoin(filmStocks, eq(rolls.filmStockId, filmStocks.id))
    .where(and(eq(rolls.userId, userId), eq(rolls.status, "shot")))
    .orderBy(asc(rolls.displayId));

  // Historical recipes: most-recent completed session per (stockId, ratedIso).
  const history = await db
    .select({
      filmStockId: rolls.filmStockId,
      ratedIso: rolls.ratedIso,
      developer: devSessions.developer,
      dilution: devSessions.dilution,
      devTimeSeconds: devSessions.devTimeSeconds,
      temperatureC: devSessions.temperatureC,
      completedAt: devSessions.completedAt,
    })
    .from(devSessions)
    .innerJoin(rolls, eq(rolls.devSessionId, devSessions.id))
    .where(and(eq(devSessions.userId, userId), sql`${devSessions.completedAt} IS NOT NULL`))
    .orderBy(desc(devSessions.completedAt));

  const recipeByStockIso = new Map<string, typeof history[number]>();
  for (const h of history) {
    const key = `${h.filmStockId}|${h.ratedIso ?? ""}`;
    if (!recipeByStockIso.has(key)) recipeByStockIso.set(key, h);
  }

  // MDC recipes for just the stocks present in the backlog.
  const stockIds = Array.from(new Set(shotRolls.map((r) => r.filmStockId)));
  const mdcRows = stockIds.length
    ? await db
        .select({
          filmStockId: devRecipes.filmStockId,
          developer: devRecipes.developer,
          dilution: devRecipes.dilution,
          asaIso: devRecipes.asaIso,
          time35mmSec: devRecipes.time35mmSec,
          time120Sec: devRecipes.time120Sec,
          timeSheetSec: devRecipes.timeSheetSec,
          temperatureC: devRecipes.temperatureC,
        })
        .from(devRecipes)
        .where(inArray(devRecipes.filmStockId, stockIds))
    : [];

  /**
   * Best MDC recipe for a (stockId, format, ratedIso). Walks developers in
   * user-preference order; exact ISO first, then nearest within ±20%
   * (so ISO 5 hits ISO 6 recipes, 1600 hits 2000, etc.).
   */
  function findMdcRecipe(
    stockId: string,
    format: string,
    ratedIso: number | null,
  ): typeof mdcRows[number] | null {
    if (ratedIso == null) return null;
    const stockRecipes = mdcRows.filter((r) => r.filmStockId === stockId);
    if (stockRecipes.length === 0) return null;

    const formatTime = (r: typeof mdcRows[number]) =>
      format === "120"
        ? r.time120Sec
        : format === "4x5" || format === "8x10"
          ? r.timeSheetSec
          : r.time35mmSec;

    for (const dev of DEV_PREF) {
      const devRows = stockRecipes.filter((r) => r.developer === dev && formatTime(r) != null);
      if (!devRows.length) continue;
      const exact = devRows.find((r) => r.asaIso === ratedIso);
      if (exact) return exact;
      const tolerance = 0.2;
      const inRange = devRows
        .filter((r) => Math.abs(r.asaIso - ratedIso) / ratedIso <= tolerance)
        .sort((a, b) => Math.abs(a.asaIso - ratedIso) - Math.abs(b.asaIso - ratedIso));
      if (inRange.length) return inRange[0];
    }
    return null;
  }

  const groups = new Map<string, CandidateGroup>();

  function bucket(
    key: string,
    tier: CandidateGroup["tier"],
    recipe: CandidateRecipe | null,
    roll: CandidateRoll,
  ) {
    if (!groups.has(key)) groups.set(key, { recipeKey: key, tier, recipe, rolls: [] });
    groups.get(key)!.rolls.push(roll);
  }

  for (const r of shotRolls) {
    // Tier 1: explicit intended dev on the roll
    if (r.intendedDilution != null || r.intendedDevTimeSeconds != null) {
      const dev = r.intendedDeveloper ?? "?";
      const key = `intended|${dev}|${normalizeDilution(r.intendedDeveloper, r.intendedDilution)}|${r.intendedDevTimeSeconds ?? ""}`;
      bucket(key, "intended", {
        developer: r.intendedDeveloper,
        dilution: r.intendedDilution,
        devTimeSeconds: r.intendedDevTimeSeconds,
        temperatureC: null,
      }, r);
      continue;
    }

    // Tier 2: historical recipe for this (stock, ratedIso)
    const hist = recipeByStockIso.get(`${r.filmStockId}|${r.ratedIso ?? ""}`);
    if (hist) {
      const key = `history|${hist.developer}|${normalizeDilution(hist.developer, hist.dilution)}|${hist.devTimeSeconds ?? ""}|${hist.temperatureC ?? ""}`;
      bucket(key, "history", {
        developer: hist.developer,
        dilution: hist.dilution,
        devTimeSeconds: hist.devTimeSeconds,
        temperatureC: hist.temperatureC,
      }, r);
      continue;
    }

    // Tier 3: MDC recipe for the format + ISO (preferring user's developer order)
    const mdc = findMdcRecipe(r.filmStockId, r.format, r.ratedIso);
    if (mdc) {
      const time =
        r.format === "120"
          ? mdc.time120Sec
          : r.format === "4x5" || r.format === "8x10"
            ? mdc.timeSheetSec
            : mdc.time35mmSec;
      const key = `mdc|${mdc.developer}|${normalizeDilution(mdc.developer, mdc.dilution)}|${time ?? ""}|${mdc.temperatureC ?? ""}|${mdc.asaIso}`;
      bucket(key, "mdc", {
        developer: mdc.developer,
        dilution: mdc.dilution,
        devTimeSeconds: time,
        temperatureC: mdc.temperatureC,
        mdcAsaIso: mdc.asaIso,
      }, r);
      continue;
    }

    // Tier 4: cluster by (stock, ratedIso) so similar rolls land together
    const key = `stock-iso|${r.filmStockId}|${r.ratedIso ?? ""}`;
    bucket(key, "stock-iso", null, r);
  }

  return Array.from(groups.values());
}
