import {
  computeDilution,
  REEL_UNITS,
  rollEquivalents,
  type DilutionResult,
} from "@tomu/shared";
import type { CandidateGroup, CandidateRecipe, CandidateRoll } from "./dev-candidates.js";

// Tank planning: pack dev-candidate recipe groups into concrete tank loads.
//
// Owner's constraints (spec 2026-07-11 — do not soften):
//   1. Zero recipe tolerance — groups are atomic; never merge across recipes.
//   2. No shooting advice — unpacked rolls are listed as waiting, nothing more.
//   3. Recipe provenance (tier) is preserved on every load.
//
// Assignment is greedy by load score with rolls-cleared as the dominant term,
// so one full 3-reel of backlog beats a lone-roll load regardless of tier.
// Each physical tank instance is consumed once per plan (a plan = one bench
// session; use excludeTanks for anything wet from earlier).
//
// Backlogs are small (tens of rolls, ~10 groups, ~8 tanks); greedy is
// deliberate. Do not grow this into a solver.

export interface FleetTank {
  /** DB tank id (shared across instances of the same tank model). */
  tankId: string;
  name: string;
  kind: "roll" | "sheet";
  volumeMl: number;
  /** Capacity in 35mm-reel units (roll tanks) or sheets (sheet tanks). */
  capacityUnits: number;
  agitation: string;
}

export interface PlannedLoad {
  tankName: string;
  tankVolumeMl: number;
  tier: CandidateGroup["tier"];
  recipe: CandidateRecipe;
  rolls: CandidateRoll[];
  /** Units used / tank capacity (reel units or sheets). */
  usedUnits: number;
  capacityUnits: number;
  oldestLoadedAt: string | null;
  mix: DilutionResult | null;
  warnings: string[];
  score: number;
}

export interface UnplannedRoll {
  roll: CandidateRoll;
  reason: string;
}

export interface TankPlan {
  loads: PlannedLoad[];
  remainder: UnplannedRoll[];
  warnings: string[];
}

export interface TankPlanOptions {
  maxTanks?: number;
  includeRolls?: string[]; // display ids, hard priority
  tags?: string[];
  developer?: string;
}

const TIER_RANK: Record<CandidateGroup["tier"], number> = {
  intended: 3,
  history: 2,
  mdc: 1,
  "stock-iso": 0,
};

const SUB_5_MIN = 300;

/**
 * Score penalty for a load whose tank volume can't hold the min-concentrate
 * floor at the recipe's dilution. Sized to outweigh the utilization term
 * (max 5) but not the per-roll term (10): the same rolls prefer a bigger,
 * legal tank when one is free, but a violating load still beats leaving
 * rolls unplanned — the fix is then the warning's volume bump, never a
 * dilution change (zero recipe tolerance).
 */
const MIN_SYRUP_PENALTY = 6;

/** Column units a roll consumes in its tank class. */
function unitsOf(roll: CandidateRoll): number | null {
  if (roll.format === "4x5") return 1; // sheets count 1 in sheet tanks
  const u = REEL_UNITS[roll.format];
  return u ?? null;
}

function tankClassFor(format: string): "roll" | "sheet" | null {
  if (format === "4x5") return "sheet";
  if (format in REEL_UNITS) return "roll";
  return null; // e.g. 8x10 — no tank in the fleet takes it
}

/**
 * Best packing of `rolls` into a tank of `capacity` units: maximize used
 * units, tiebreak on more rolls. Exact for the two-size (1 / 1.5) case by
 * enumerating the 120-count. Preserves the priority order of `rolls`.
 */
function bestFill(rolls: CandidateRoll[], capacity: number): CandidateRoll[] {
  const heavy = rolls.filter((r) => (unitsOf(r) ?? 1) > 1); // 120s
  const light = rolls.filter((r) => (unitsOf(r) ?? 1) === 1); // 35mm / sheets
  const hu = 1.5;

  let best: { used: number; count: number; h: number; l: number } | null = null;
  const maxH = Math.min(heavy.length, Math.floor(capacity / hu));
  for (let h = maxH; h >= 0; h--) {
    const room = capacity - h * hu;
    const l = Math.min(light.length, Math.floor(room + 1e-9));
    const used = h * hu + l;
    const count = h + l;
    if (!best || used > best.used + 1e-9 || (Math.abs(used - best.used) < 1e-9 && count > best.count)) {
      best = { used, count, h, l };
    }
  }
  if (!best || best.count === 0) return [];
  return [...heavy.slice(0, best.h), ...light.slice(0, best.l)];
}

function totalUnits(rolls: CandidateRoll[]): number {
  return rolls.reduce((sum, r) => sum + (unitsOf(r) ?? 1), 0);
}

export function planTanks(
  groups: CandidateGroup[],
  fleet: FleetTank[],
  options: TankPlanOptions = {},
): TankPlan {
  const includeSet = new Set((options.includeRolls ?? []).map((s) => s.trim()));
  const remainder: UnplannedRoll[] = [];
  const planWarnings: string[] = [];

  // ── Filter the candidate pool ──
  let pool = groups.map((g) => ({ ...g, rolls: [...g.rolls] }));
  if (options.tags?.length) {
    const want = new Set(options.tags.map((t) => t.toLowerCase()));
    pool = pool
      .map((g) => ({ ...g, rolls: g.rolls.filter((r) => r.tags.some((t) => want.has(t.toLowerCase()))) }))
      .filter((g) => g.rolls.length);
  }
  if (options.developer) {
    const dev = options.developer.toLowerCase().replace(/[^a-z0-9]/g, "");
    const kept: typeof pool = [];
    for (const g of pool) {
      if (g.recipe?.developer && g.recipe.developer.toLowerCase().replace(/[^a-z0-9]/g, "") === dev) {
        kept.push(g);
      } else {
        for (const r of g.rolls) remainder.push({ roll: r, reason: `outside developer filter (${options.developer})` });
      }
    }
    pool = kept;
  }

  // ── Split plannable groups from no-recipe groups ──
  const isInclude = (r: CandidateRoll) => r.displayId != null && includeSet.has(r.displayId);
  const sortRolls = (rs: CandidateRoll[]) =>
    [...rs].sort((a, b) => {
      const inc = Number(isInclude(b)) - Number(isInclude(a));
      if (inc) return inc;
      const at = a.loadedAt ? new Date(a.loadedAt).getTime() : Infinity;
      const bt = b.loadedAt ? new Date(b.loadedAt).getTime() : Infinity;
      return at - bt;
    });

  const work: { group: CandidateGroup; rolls: CandidateRoll[] }[] = [];
  for (const g of pool) {
    const r = g.recipe;
    if (!r || !r.developer || r.developer === "?" || r.devTimeSeconds == null) {
      for (const roll of g.rolls) remainder.push({ roll, reason: "no usable recipe on file (developer/time unknown)" });
      continue;
    }
    const usable = g.rolls.filter((roll) => {
      if (tankClassFor(roll.format) == null) {
        remainder.push({ roll, reason: `no tank in fleet takes ${roll.format}` });
        return false;
      }
      return true;
    });
    if (usable.length) work.push({ group: g, rolls: sortRolls(usable) });
  }

  function buildLoad(group: CandidateGroup, tank: FleetTank, chosen: CandidateRoll[]): PlannedLoad {
    const recipe = group.recipe!;
    const warnings: string[] = [];
    let mix: DilutionResult | null = null;
    const equiv = chosen.reduce((s, r) => s + rollEquivalents(r.format, 1), 0);
    if (recipe.dilution) {
      mix = computeDilution(recipe.developer!, recipe.dilution, tank.volumeMl, equiv);
      if (mix) warnings.push(...mix.warnings);
      else warnings.push(`could not parse dilution "${recipe.dilution}" — mix not computed`);
    } else {
      warnings.push("recipe has no dilution — mix not computed");
    }
    if (recipe.devTimeSeconds != null && recipe.devTimeSeconds < SUB_5_MIN) {
      warnings.push(
        `dev time ${(recipe.devTimeSeconds / 60).toFixed(1)} min is under 5:00 — small timing errors matter; consider a higher dilution`,
      );
    }
    if (group.tier === "mdc") {
      warnings.push("recipe source is Massive Dev Chart (community) — no datasheet recipe on file");
    }

    const usedUnits = totalUnits(chosen);
    const utilization = tank.capacityUnits > 0 ? usedUnits / tank.capacityUnits : 0;
    const oldestMs = Math.min(
      ...chosen.map((r) => (r.loadedAt ? new Date(r.loadedAt).getTime() : Infinity)),
    );
    const ageDays = Number.isFinite(oldestMs) ? Math.max(0, (Date.now() - oldestMs) / 86_400_000) : 0;
    const hasInclude = chosen.some(isInclude);
    const score =
      chosen.length * 10 +
      utilization * 5 +
      (hasInclude ? 1000 : 0) +
      ageDays * 0.02 +
      TIER_RANK[group.tier] -
      (mix?.belowMinConcentrate ? MIN_SYRUP_PENALTY : 0);

    return {
      tankName: tank.name,
      tankVolumeMl: tank.volumeMl,
      tier: group.tier,
      recipe,
      rolls: chosen,
      usedUnits,
      capacityUnits: tank.capacityUnits,
      oldestLoadedAt: Number.isFinite(oldestMs) ? new Date(oldestMs).toISOString() : null,
      mix,
      warnings,
      score,
    };
  }

  // ── Greedy assignment: repeatedly commit the highest-scoring load ──
  const available = [...fleet];
  const loads: PlannedLoad[] = [];

  for (;;) {
    let best: { w: (typeof work)[number]; tank: FleetTank; chosen: CandidateRoll[]; load: PlannedLoad } | null = null;

    for (const w of work) {
      if (!w.rolls.length) continue;
      const classes = new Set(w.rolls.map((r) => tankClassFor(r.format)!));
      for (const cls of classes) {
        const classRolls = w.rolls.filter((r) => tankClassFor(r.format) === cls);
        const seenSpecs = new Set<string>();
        for (const tank of available) {
          if (tank.kind !== cls) continue;
          // Identical instances (4× Paterson 2-reel) evaluate once per round.
          const specKey = `${tank.tankId}|${tank.capacityUnits}|${tank.volumeMl}`;
          if (seenSpecs.has(specKey)) continue;
          seenSpecs.add(specKey);

          const chosen = bestFill(classRolls, tank.capacityUnits);
          if (!chosen.length) continue;
          const load = buildLoad(w.group, tank, chosen);
          if (!best || load.score > best.load.score) best = { w, tank, chosen, load };
        }
      }
    }

    if (!best) break;
    available.splice(available.indexOf(best.tank), 1);
    best.w.rolls = best.w.rolls.filter((r) => !best!.chosen.includes(r));
    loads.push(best.load);
    if (options.maxTanks != null && loads.length >= options.maxTanks) break;
  }

  const maxTanksHit = options.maxTanks != null && loads.length >= options.maxTanks;
  for (const w of work) {
    for (const r of w.rolls) {
      const cls = tankClassFor(r.format)!;
      const classLeft = available.some((t) => t.kind === cls);
      remainder.push({
        roll: r,
        reason: maxTanksHit
          ? `beyond maxTanks=${options.maxTanks}`
          : classLeft
            ? "does not fit any remaining tank"
            : `fleet exhausted (no ${cls} tanks left)`,
      });
    }
  }

  loads.sort((a, b) => b.score - a.score);

  // includeRolls that never made it into the plan are a plan-level warning.
  if (includeSet.size) {
    const placed = new Set(loads.flatMap((l) => l.rolls.map((r) => r.displayId)));
    for (const id of includeSet) {
      if (!placed.has(id)) planWarnings.push(`requested roll ${id} is not in the plan (not in backlog, filtered out, or unpackable)`);
    }
  }

  return { loads, remainder, warnings: planWarnings };
}
