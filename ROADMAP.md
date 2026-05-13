# Tomu Roadmap

Running backlog of ideas, follow-ups, and known issues. Not prioritized unless noted. Add freely; prune as things ship.

## Data model

- **Dev Id surfacing** — `dev_date` + `dev_seq` columns added to `rolls` (2026-05-12). Expose throughout the stack: shared types, API serializer, UI, MCP. Format on output as `YYYYMMDD.NNNN`.
- **Dev Id backfill** — Import pre-Tomu Google Sheet (https://docs.google.com/spreadsheets/d/101B1WmsPQm08E3ewJp-vQzVK6YYPhwx-tyUTUp3Bjb0/) to populate `dev_seq` for the 86 existing rolls. New rolls continue from `max(imported) + 1`. Current state: only the 2026-05-12 batch (seq 717–735) is populated.
- **Tank as gear** — Model dev tanks like `cameras` / `lenses` with capacity (sheets, reels, format mode), inversion vs rotation, working volumes. Today `dev_sessions.tank` is free text. Inventory: Stearman SP-445 (4× 4x5), MOD54 (6× 4x5), 1× Paterson 3-reel, 3× Paterson 2-reel, 2× Jobo 1520 (2-reel size, inversion).
- **Display id for orphan rolls** — At least one roll (`27ae8905…` FP4) has no `display_id`. Either backfill at first dev, or treat dev_seq as the primary handle when display_id is null.

## API / MCP

- **Rolls response** — Surface: `dev_date`, `dev_seq` (formatted Dev Id), aggregate `first_shot` / `last_shot` from frames, frame count, intended-dev fields.
- **Rolls filters** — `?dev_seq=`, `?dev_seq_range=`, `?dev_date_from/to=`, `?developed_between=`, `?status=`.
- **`tomu_rolls` MCP** — Mirror the new filters and fields so questions like "show me rolls developed 2026-05-12" or "what were Dev Ids 0727–0732" work without SQL.
- **`tomu_dev_session` MCP** — Create + complete dev sessions and bulk-update roll status. Currently a SQL-only path.
- **Dev candidates grouping bug** — `tomu_dev_candidates` groups by literal recipe string, so "HC-110 B 7:30" and "HC-110 1+31 7:30" come back as separate buckets even though they're chemistry-equivalent. Normalize on `(developer, parsed_ratio, time, temp)`.

## Dev workflow

- **Dilution constants in code** — Codify HC-110 letter→ratio table (A=1+15, B=1+31, C=1+19, D=1+39, E=1+47, F=1+79, G=1+119, H=1+63) as a shared constant. Memory has been wrong before (had H as 1+119) and cost a 4-sheet LF batch a rescue calc on 2026-05-12. Source of truth must be the codebase, not memory.
- **Dilution helper** — Compute syrup/water from `(developer, dilution_letter_or_ratio, target_volume)`; flag minimum-syrup warnings (e.g. Rodinal 10ml/roll). Surface in UI and MCP.
- **Recipe verification at log time** — Cross-check `intended_dev_*` against MDC for the rated ISO; warn on outliers before pour.
- **Recipe rules engine** — Encode the user's standing conventions so they're enforced, not remembered:
  - Expired film: shoot at rated ISO, dev at box ISO. Push/pull: dev at rated.
  - Bias to longer dev times when MDC offers a choice; 7+ preferred, avoid sub-5-min.
  - When subsetting candidate group to a tank, prefer most recently shot rolls.
  - Rodinal 1+50 in Jobo 2-reel: standard mix is 10 ml syrup + 500 ml water (510 total).
- **Tank volume defaults** — Lookup table by tank model × reel count × format (Paterson 3-reel @ 3× 35mm = 1000ml, Paterson 2-reel @ 2× 35mm = 500ml, Jobo 1520 stack inversion = 500ml, MOD54 = 1000ml, Stearman SP-445 = 475ml). Used by the dilution helper.
- **Batch dev days** — User loads many tanks one day, devs them the next (potentially across multiple nights). UI should support a "dev session plan" spanning multiple `dev_sessions`, with chem-reuse grouping by recipe family.
- **Old-sheet roll reconciliation** — Several physical rolls dev'd in 2026-05-12 batch (0727, 0728) suspected to match old-sheet entries (`20240923.3`, `20230503.2`). Need a reconciliation flow: merge or link.
- **Mystery canister tracking** — `27ae8905` canister labeled "24080102" contained HP5 not Acros II. Track canister-label vs film-truth discrepancies as a first-class concept, not just descriptions. Also: `20240801.2` DB/sheet says Acros, canister had HP5 — same class of issue.

## Scanning

- **LF (4x5) scan path** — No working route today. Valoi rig handles 35/120 only. Options: V850 flatbed, or DSLR tile-stitch. Decide before 2026-06-22 LF class.

## Field / techniques (reference, not code)

- **Very-old color film rescue** — Can cross-process as B&W in Rodinal stand. ECN-2 needs a rem-jet pre-bath first. (Useful as a UI hint/preset if we ever offer "rescue mode" for expired color rolls.)
- **Trip tags** — `colorado-2025` = 2025-04-27 to 2025-05-06. Suggest tags by frame date, don't auto-apply.

## Calendar / deadlines

- **LF class** — 2026-06-22. LF dev + scan workflow must be working by then.
- **Japan trip** — 2026-05-25 to 2026-06-04. Not a hard Tomu deadline, but features that aid trip review (fast frame log, location tagging) get priority through May.

## Bugs / nits

- **Drizzle push** — `db:push` reads `postgres://tomu:tomu@…` default; project actually uses `filmlog`/`filmlog`. Either fix the default in `drizzle.config.ts`, or always source from `.env`.
- **`db:push` is interactive** — Adding constraints on populated tables prompts for truncate/keep. Need a non-interactive flag for scripted use.
