// ── Fuzzy matching helpers (Postel's Law) ──
//
// Extracted from server.ts so the resolution rules are unit-testable: every
// mis-match bug this file has fixed ("Kodak Ektapan" → "Kodak Technical Pan",
// "Verichrome Pan" → any stock ending in "Pan") is a regression test below it.

export function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function tokens(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/**
 * Loose substring check — kept for filters where any partial signal is good enough.
 * Do NOT use this on a `.find()` over a list of similarly-named entities;
 * it will return the first candidate whose any token overlaps and silently pick
 * the wrong one (e.g. "Arista EDU Ultra 100" query → "Arista EDU 400 DX" stock).
 * For singular resolution, use `bestMatch()` instead.
 */
export function fuzzyMatch(query: string, ...candidates: string[]): boolean {
  const q = normalize(query);
  return candidates.some((c) => {
    const n = normalize(c);
    return n.includes(q) || q.includes(n);
  });
}

/**
 * Score how well `query` matches a candidate's `fields`. Higher is better.
 * Token-overlap based: every query token that appears as a substring of any
 * candidate token scores 1; an exact token match scores 2. Ties broken by
 * fewer extra (unmatched) candidate tokens — preferring more-specific names.
 */
export function score(query: string, fields: string[]): number {
  const qTokens = tokens(query);
  if (qTokens.length === 0) return 0;
  const cTokens = fields.flatMap(tokens);
  if (cTokens.length === 0) return 0;

  let matchScore = 0;
  let matched = 0;
  for (const qt of qTokens) {
    let best = 0;
    for (const ct of cTokens) {
      if (ct === qt) best = Math.max(best, 2);
      else if (ct.includes(qt) || qt.includes(ct)) best = Math.max(best, 1);
    }
    matchScore += best;
    if (best > 0) matched++;
  }

  // Require at least one token match. Penalize unmatched candidate tokens
  // mildly so "Arista EDU Ultra 100" beats "Arista EDU 400 DX" for a query
  // of "arista edu ultra 100".
  if (matched === 0) return 0;
  const extra = Math.max(0, cTokens.length - matched);
  return matchScore - extra * 0.1;
}

/**
 * Stricter stock match: requires every query token to appear as an *exact* token
 * in the candidate. Returns a single winner, ambiguous tied set, or none —
 * never silently picks a partial-token match (which is how "Kodak Ektapan"
 * once resolved to "Kodak Technical Pan").
 */
export function strictStockMatch<T>(query: string, items: T[], fieldsOf: (item: T) => string[]): MatchResult<T> {
  const qTokens = tokens(query);
  if (qTokens.length === 0) return { kind: "none" };

  let bestScore = -1;
  let bestItems: T[] = [];
  for (const item of items) {
    const cTokens = fieldsOf(item).flatMap(tokens);
    const cSet = new Set(cTokens);
    if (!qTokens.every((qt) => cSet.has(qt))) continue;
    const extra = Math.max(0, cTokens.length - qTokens.length);
    const s = qTokens.length * 2 - extra * 0.1;
    if (s > bestScore) {
      bestScore = s;
      bestItems = [item];
    } else if (s === bestScore) {
      bestItems.push(item);
    }
  }

  if (bestItems.length === 0) return { kind: "none" };
  if (bestItems.length === 1) return { kind: "single", item: bestItems[0], score: bestScore };
  return { kind: "tied", items: bestItems, score: bestScore };
}

/** Pick the single best candidate from a list; null if none score above 0. */
export function bestMatch<T>(query: string, items: T[], fieldsOf: (item: T) => string[]): T | null {
  let best: T | null = null;
  let bestScore = 0;
  for (const item of items) {
    const s = score(query, fieldsOf(item));
    if (s > bestScore) {
      bestScore = s;
      best = item;
    }
  }
  return best;
}

/**
 * Like bestMatch but reports ties so callers can refuse to silently pick.
 * Returns:
 *   { kind: "none" }      — no candidate scored above 0
 *   { kind: "single", … } — clear winner
 *   { kind: "tied", … }   — two or more candidates tied for top score
 */
export type MatchResult<T> =
  | { kind: "none" }
  | { kind: "single"; item: T; score: number }
  | { kind: "tied"; items: T[]; score: number };

export function rankedMatch<T>(query: string, items: T[], fieldsOf: (item: T) => string[]): MatchResult<T> {
  let bestScore = 0;
  let bestItems: T[] = [];
  for (const item of items) {
    const s = score(query, fieldsOf(item));
    if (s <= 0) continue;
    if (s > bestScore) {
      bestScore = s;
      bestItems = [item];
    } else if (s === bestScore) {
      bestItems.push(item);
    }
  }
  if (bestItems.length === 0) return { kind: "none" };
  if (bestItems.length === 1) return { kind: "single", item: bestItems[0], score: bestScore };
  return { kind: "tied", items: bestItems, score: bestScore };
}

/** Strip a leading manufacturer token from a stock name so create-on-the-fly
 *  doesn't produce "Kentmere Kentmere Pan 400". */
export function cleanStockName(name: string, manufacturer: string): string {
  const n = name.trim();
  const m = manufacturer.trim();
  if (!m) return n;
  const prefix = m.toLowerCase() + " ";
  if (n.toLowerCase().startsWith(prefix)) return n.slice(prefix.length).trim();
  return n;
}

/** "Kentmere Pan 100" not "Kentmere Kentmere Pan 100" when name already starts with mfg. */
export function displayStock(manufacturer: string, stockName: string): string {
  const n = stockName.trim();
  const m = manufacturer.trim();
  if (n.toLowerCase().startsWith(m.toLowerCase() + " ")) return n;
  if (n.toLowerCase() === m.toLowerCase()) return n;
  return `${m} ${n}`;
}
