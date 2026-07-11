/**
 * Developer dilution math — the source of truth for letter codes, ratios,
 * tank volumes, and syrup/water arithmetic.
 *
 * Codified 2026-07-07 because human memory got HC-110 H wrong once (as 1+119)
 * and it cost a 4-sheet LF batch a rescue calc. Verified against Kodak's
 * canonical table and data/mdc/hc110.txt. If this table and a memory disagree,
 * this table wins.
 */

/** Kodak canonical HC-110 dilution letters. */
export const HC110_DILUTIONS: Record<string, string> = {
  A: "1+15",
  B: "1+31",
  C: "1+19",
  D: "1+39",
  E: "1+47",
  F: "1+79",
  G: "1+119",
  H: "1+63",
};

/**
 * Minimum concentrate per roll (ml) to fully develop one 35mm/120 roll or
 * equivalent (80 in² of film). Below this, development is under-powered no
 * matter the ratio.
 */
export const MIN_CONCENTRATE_PER_ROLL_ML: Record<string, number> = {
  "HC-110": 6, // Kodak datasheet
  Rodinal: 10, // standing convention (10 ml / 500 ml in Jobo 2-reel)
  "510 Pyro": 3,
  "510-Pyro": 3,
};

/** Dev tanks and their working volumes / capacities (authoritative, from gear inventory). */
export interface TankSpec {
  name: string;
  volumeMl: number;
  /** Roll-equivalents by format at full load, for min-syrup math. */
  capacity: { format: "35mm" | "120" | "4x5"; count: number }[];
  agitation: "inversion" | "rotation";
}

export const TANKS: Record<string, TankSpec> = {
  "sp-445": {
    name: "Stearman SP-445",
    volumeMl: 475,
    capacity: [{ format: "4x5", count: 4 }],
    agitation: "inversion",
  },
  mod54: {
    name: "MOD54 (Paterson Universal)",
    volumeMl: 1000,
    capacity: [{ format: "4x5", count: 6 }],
    agitation: "inversion",
  },
  "paterson-3": {
    name: "Paterson Super System 4 (3-reel)",
    volumeMl: 1000,
    capacity: [
      { format: "35mm", count: 3 },
      { format: "120", count: 2 },
    ],
    agitation: "inversion",
  },
  "paterson-2": {
    name: "Paterson Super System 4 (2-reel)",
    volumeMl: 500,
    capacity: [
      { format: "35mm", count: 2 },
      { format: "120", count: 1 },
    ],
    agitation: "inversion",
  },
  "jobo-1520": {
    name: "Jobo 1520 (inversion)",
    volumeMl: 500,
    capacity: [
      { format: "35mm", count: 2 },
      { format: "120", count: 1 },
    ],
    agitation: "inversion",
  },
};

/**
 * Reel-column units for roll tanks (owner-confirmed 2026-07-11): a 120 reel
 * occupies 1.5× the column height of a 35mm reel, so a 3-reel Paterson holds
 * 3×35mm, 2×120, or 1×120 + 1×35mm.
 */
export const REEL_UNITS: Record<string, number> = {
  "35mm": 1,
  "120": 1.5,
};

/** 4 sheets of 4x5 ≈ 1 roll-equivalent (80 in²) for chemistry-exhaustion math. */
export function rollEquivalents(format: string, count: number): number {
  if (format === "4x5") return count / 4;
  if (format === "8x10") return count;
  return count; // 35mm / 120 count as one roll each
}

/**
 * Parse "1+31", "1:31", "1 + 31" → { concentrate: 1, water: 31 }.
 * Also accepts HC-110 letters (case-insensitive).
 */
export function parseDilutionRatio(input: string): { concentrate: number; water: number } | null {
  const letter = input.trim().toUpperCase();
  const viaLetter = HC110_DILUTIONS[letter];
  const s = viaLetter ?? input;
  const m = s.trim().match(/^(\d+(?:\.\d+)?)\s*[+:]\s*(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const c = Number(m[1]);
  const w = Number(m[2]);
  if (!(c > 0) || !(w >= 0)) return null;
  return { concentrate: c, water: w };
}

/** Canonical form for grouping: HC-110 letters → ratio; ":" → "+". Unparseable input returns trimmed original. */
export function normalizeDilution(developer: string | null, dilution: string | null): string {
  if (!dilution) return "";
  const ratio = parseDilutionRatio(dilution);
  if (!ratio) return dilution.trim();
  return `${ratio.concentrate}+${ratio.water}`;
}

export interface DilutionResult {
  developer: string;
  /** Canonical ratio, e.g. "1+31" */
  dilution: string;
  targetVolumeMl: number;
  concentrateMl: number;
  waterMl: number;
  /** Roll-equivalents this mix must develop, if provided. */
  rollEquivalents?: number;
  /** True when the concentrate falls below the per-roll floor at this volume. */
  belowMinConcentrate?: boolean;
  warnings: string[];
}

/**
 * Compute concentrate/water for a target volume, with minimum-concentrate
 * warnings when the roll count is known.
 *
 * computeDilution("HC-110", "B", 500, 2) →
 *   { concentrateMl: 15.6, waterMl: 484.4, warnings: [] }
 */
export function computeDilution(
  developer: string,
  dilution: string,
  targetVolumeMl: number,
  rollEquiv?: number,
): DilutionResult | null {
  const ratio = parseDilutionRatio(dilution);
  if (!ratio || targetVolumeMl <= 0) return null;

  const parts = ratio.concentrate + ratio.water;
  const concentrateMl = (targetVolumeMl * ratio.concentrate) / parts;
  const waterMl = targetVolumeMl - concentrateMl;

  const warnings: string[] = [];
  let belowMinConcentrate = false;
  const minPerRoll = MIN_CONCENTRATE_PER_ROLL_ML[developer] ?? MIN_CONCENTRATE_PER_ROLL_ML[developer.replace(/\s+/g, "-")];
  if (rollEquiv != null && minPerRoll != null) {
    const needed = minPerRoll * rollEquiv;
    if (concentrateMl < needed) {
      belowMinConcentrate = true;
      const requiredVolume = Math.ceil((needed * parts) / ratio.concentrate / 10) * 10;
      // Remedy must keep the ratio — a dilution change means a different time
      // (zero recipe tolerance). Bigger tank / more volume only.
      warnings.push(
        `Only ${concentrateMl.toFixed(1)} ml of ${developer} for ${rollEquiv} roll-equivalent(s) — minimum is ${needed.toFixed(0)} ml (${minPerRoll} ml/roll). ` +
          `Needs ≥${requiredVolume} ml at ${ratio.concentrate}+${ratio.water} — use a bigger tank; do not change the dilution.`,
      );
    }
  }

  return {
    developer,
    dilution: `${ratio.concentrate}+${ratio.water}`,
    targetVolumeMl,
    concentrateMl: Math.round(concentrateMl * 10) / 10,
    waterMl: Math.round(waterMl * 10) / 10,
    rollEquivalents: rollEquiv,
    belowMinConcentrate,
    warnings,
  };
}

/** Resolve a tank by fuzzy name: "sp445", "SP-445", "jobo", "paterson 2-reel"… */
export function findTank(query: string): TankSpec | null {
  const q = query.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const [key, spec] of Object.entries(TANKS)) {
    const k = key.replace(/[^a-z0-9]/g, "");
    const n = spec.name.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (k === q || n.includes(q) || q.includes(k)) return spec;
  }
  // Common shorthands
  if (q.includes("stearman") || q.includes("sp445")) return TANKS["sp-445"];
  if (q.includes("jobo")) return TANKS["jobo-1520"];
  if (q.includes("mod54") || q.includes("mod")) return TANKS.mod54;
  if (q.includes("paterson") && q.includes("3")) return TANKS["paterson-3"];
  if (q.includes("paterson")) return TANKS["paterson-2"];
  return null;
}
