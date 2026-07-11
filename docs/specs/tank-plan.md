# Spec: tomu_tank_plan — batch undeveloped rolls into tank loads

> Owner-authored spec, imported 2026-07-11 from Google Drive
> (`tomu_tank_plan_spec.md`, doc id `1brO75gXOE3cEEvvIjfeJzeVfiU42xO4eD5fhEqD_CXU`).
> Implemented same day: `services/tank-plan.ts`, `POST /tanks/plan`, `tomu_tank_plan`.
> Open questions were resolved as noted inline in [brackets].

Feature spec for a new Tomu MCP tool. Written for a Claude Code implementation
session. Implementation-agnostic; assumes access to Tomu's existing internals
behind tomu_dev_candidates, tomu_dilution, tomu_rolls, and tomu_dev_session.

## Problem

Tomu's tomu_dev_candidates groups undeveloped rolls by recipe (4 tiers:
label-intended → historical match → MDC lookup → stock+ISO cluster). What's
missing is the packing step: turning those groups into concrete tank
assignments so a dev session clears maximum backlog with minimum chemistry and
setup. Today the user does this by hand. It should be a callable,
always-current computation over the live backlog.

## Core principles (owner's constraints — do not soften)

1. **Zero recipe tolerance.** A tank load must share exactly one recipe:
   developer + dilution + time + temperature. Never merge groups whose times
   differ, however slightly. No tolerance parameter, no "split the difference"
   option. Groups from dev_candidates are the atomic unit.
2. **No shooting advice.** The tool reports what packs and what doesn't. It
   must not suggest shooting more film to fill tanks. Orphan rolls are simply
   listed as waiting.
3. **Recipe provenance is preserved.** Each planned tank inherits its group's
   tier (intended / historical / MDC / clustered) and the output must display
   it, so the user knows which loads rest on datasheet-grade recipes vs.
   community lookups.

## Tank fleet model

Add a persistent notion of the user's developing tanks (some of this likely
exists for tomu_dilution's tank→volume mapping). Each tank needs:

| Field    | Example           | Notes        |
| -------- | ----------------- | ------------ |
| name     | "Paterson 3-reel" | unique       |
| volumeMl | 1000              | for mix calc |
| capacity | see below         | per-format   |

Capacity is format-dependent and mixed-format loads are legal when reels
coexist:

- Paterson-style multi-reel: capacity expressed in 35mm-reel units; a 120 reel
  consumes 2 units in the same column (e.g. 3-reel tank = 3×35mm, or 1×120 +
  1×35mm... **verify against the user's actual hardware**: owner fleet is
  1× 3-reel Paterson, 4× 2-reel, 1× 1-reel, 1× Jobo 2-reel, SP-445 (4× 4x5
  sheets), Mod54 in Paterson Universal (6× 4x5 sheets). Confirm real reel-unit
  math with the owner rather than assuming; the 35mm/120 exchange rate on
  their tanks matters and this spec intentionally leaves it as an open
  question.)
  [Resolved 2026-07-11: owner confirmed **120 = 1.5 units**, standard Paterson
  geometry. Fleet seeded as listed here; count conflicts with older ROADMAP
  gear list flagged there, full rundown pending.]
- Sheet tanks: SP-445 = 4 sheets, Mod54 = 6 sheets. 4x5 only.
- A tank holds one format class per load only where hardware requires it
  (sheet tanks); roll tanks may mix 35mm/120 at the same recipe.

## Tool interface

tomu_tank_plan

- tanksAvailable?: string[] — default: full fleet; names fuzzy-matched
- excludeTanks?: string[] — e.g. tank currently wet
- maxTanks?: number — "I'll run N tanks tonight" — return the best N loads
- includeRolls?: string[] — display ids that MUST appear in the plan (priority)
- tags?: string[] — restrict candidate pool to rolls with these tags
- developer?: string — restrict to one developer (e.g. only HC-110 tonight)

All parameters optional; bare call = full-fleet plan over the entire backlog.

## Algorithm

1. **Group:** reuse dev_candidates grouping verbatim (all four tiers). Each
   group = one recipe.
2. **Pack within group:** first-fit-decreasing into available tanks. Prefer
   filling the largest tank that the group can fill *completely*; a group of
   6 HP5 rolls fills a 3-reel twice rather than 3+2+1. Partial loads are
   allowed but scored lower.
   [Note: "3-reel twice" implies reusing a tank within one session; the
   implementation consumes each physical tank instance once per plan (a plan =
   one bench session, wet tanks via excludeTanks). Revisit with owner.]
3. **Assign tanks across groups:** greedy by score (below), consuming tanks
   from the fleet until tanks or groups are exhausted. If maxTanks is set,
   return the top-N loads by score.
4. **Score per load** (tunable weights, keep simple):
   - rolls cleared (higher better)
   - tank utilization (full > partial)
   - contains includeRolls (hard priority — these loads sort first)
   - age of oldest roll in load (older backlog first, tiebreak)
   - recipe tier (tier 1 intended > tier 4 clustered, tiebreak)
5. **Chemistry:** for each planned load, compute mix via existing
   tomu_dilution logic (developer, dilution, tank volume), including the
   minimum-concentrate check (HC-110 syrup floor per roll). A load failing the
   minimum-concentrate check at its tank's volume must be flagged, not
   silently passed.

Backlog sizes are small (tens of rolls, ~10 groups, ~8 tanks). Greedy FFD is
fine; do not build an ILP solver.

## Output

Ordered list of planned tank loads:

```
Load 1 — Paterson 3-reel — HC-110 B 5:00 @ 20°C  [tier 2: historical]
  20240728.02  HP5+ (120)
  20250426.03  HP5+ (120)         ← oldest in load: 2024-07-28
  3c3b1e42     HP5+ (35mm)
  Mix: 31.3 mL HC-110 + 968.7 mL water (1+31)
Load 2 — ...
```

Followed by:

- **Remainder:** rolls in groups that didn't pack (group smaller than any
  sensible load, or fleet exhausted). Purely informational. No suggestions.
- **Warnings:** minimum-concentrate flags, groups whose only recipe source is
  tier 3/4 (MDC / clustered — "no datasheet recipe on file").

## Interaction with tomu_dev_session

The plan is advisory — creating sessions stays explicit via tomu_dev_session
action=create. Nice-to-have: a plan output that can be handed straight to
dev_session (roll ids + shorthand + tank pre-filled), one session per load.
Do not auto-create sessions.

## Non-goals

- Recipe tolerance/merging (explicitly rejected by owner)
- Shooting suggestions to complete partial tanks (explicitly rejected)
- Multi-day scheduling, drying-rack capacity, chemistry shelf-life tracking
  (future, out of scope)
- Push/pull compensation math (recipes come from groups as-is)

## Open questions for implementation session

1. Exact reel-unit capacity math for the owner's Paterson tanks (ask, don't
   assume). [Resolved: 120 = 1.5 units.]
2. Whether tank fleet is already modeled (from tomu_dilution's tank parameter)
   or needs a new table + CRUD. [Was static `TANKS` in shared — new `tanks`
   table + CRUD + `tomu_tanks` added; static table remains as tomu_dilution
   fallback.]
3. Whether dev_candidates grouping is exposed internally as a reusable
   function or needs extraction from the tool handler. [Was inline in the
   route — extracted to `services/dev-candidates.ts`, no behavior change.]
