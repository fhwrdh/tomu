# Tomu Roadmap

Running backlog of ideas, follow-ups, and known issues. Not prioritized unless noted. Add freely; prune as things ship.

## Conventions (authoritative)

Standing rules to follow when planning dev / scan workflows. These belong here, not in chat memory.

- **Expired film:** shoot at rated ISO, develop at box ISO.
- **Push / pull:** develop at rated ISO (not box).
- **Dev time bias:** when MDC offers a range or multiple recipes, prefer 7+ minutes. Avoid sub-5-minute times.
- **Recency in candidate selection:** when subsetting a candidate group to a tank, prefer the most recently shot rolls. Preference, not a hard rule — and never re-open an already-loaded tank to honor it.
- **Rodinal 1+50 in Jobo 2-reel (inversion):** standard mix is 10 ml syrup + 500 ml water (510 ml total). Hits the 10 ml/roll-pair minimum without changing the ratio.
- **HC-110 dilution letters → ratios (Kodak canonical):** A=1+15, B=1+31, C=1+19, D=1+39, E=1+47, F=1+79, G=1+119, H=1+63. **Always verify against `data/mdc/hc110.txt` before quoting.**
- **Batch dev days:** user loads many tanks one day, develops the next (may split across multiple nights). Plan as multi-tank sequences, not one-offs.
- **MCP-first field input:** in the field, the MCP tools are the primary input path; the UI is for later review.
- **Field fallback when MCP not reachable:** when away from a Claude Code session with `tomu_*` tools (e.g. travel, no laptop), use a Google Drive doc as the durable field log instead of relying on chat history. Mobile Claude app + Drive connector append timestamped entries to a per-trip doc following the format embedded at the top of the doc. Transcribed into Tomu via MCP on return. Active doc for the upcoming trip: "Tomu Field Log — Japan 2026" (Drive id `1ogZZbmcIA7NLviizKqodYmQeaikTbHYxjw_GsPswuqo`). Reason chat-as-log is unsafe: context window compression has lost important details in past sessions.

## Gear inventory

Authoritative kit summary. Update when gear changes.

- **Cameras / lenses:** see `cameras` and `lenses` tables in the DB.
- **Dev tanks:**
  - Stearman SP-445 — holds 4× 4x5 sheets. Working volume ~475 ml. Inversion.
  - MOD54 (in Paterson Universal) — holds 6× 4x5 sheets. Working volume ~1000 ml. Inversion.
  - Paterson Super System 4 — 1× 3-reel (3× 35mm or 2× 120 = 1000 ml), 3× 2-reel (2× 35mm or 1× 120 = 500 ml). Inversion.
  - Jobo 1520 — used as stacked 2-reel-size tanks, **inversion only** (not rotation). 500 ml standard fill, 10 ml/500 ml convention for Rodinal 1+50.
  - Total Jobo reels: **3** (limits NCS5 batches).
- **Scanners:** Valoi + camera rig (35/120 only). No LF (4x5) scan path yet — see Scanning section.

## External references

- **Pre-Tomu dev log** — Google Sheet at https://docs.google.com/spreadsheets/d/101B1WmsPQm08E3ewJp-vQzVK6YYPhwx-tyUTUp3Bjb0/ — source of truth for Dev Ids 0001–0716. Local cache at `/tmp/filmlog.csv` (transient).
- **Lightroom catalog** — User has an existing LR catalog with substantial historical photo work. Will be the eventual sync target for scans + a backfill source for historical matches.
- **Massive Dev Chart dumps** — `data/mdc/hc110.txt`, `data/mdc/rodinal.txt`, `data/mdc/510pyro.txt`. Tab-separated, columns: Film, Developer, Dilution, ASA/ISO, 35mm, 120, Sheet, Temp, Notes.

## Data model

- ~~**Dev Id surfacing**~~ Done 2026-07-07: `devDate`/`devSeq`/`devId` (formatted `YYYYMMDD.NNNN`) in shared types, rolls API (list + single), and `tomu_rolls`. API filters: `?dev_seq=`, `?dev_seq_range=`, `?dev_date_from/to=`, `?developed_between=`. UI still pending.
- ~~**Dev Id backfill**~~ Done 2026-07-07, but as a **full historical import**, not a backfill: all developed Tomu rolls already had seqs (717–735), so the sheet (0367–0716) + LR keywords (0001–0716) were imported as 693 new `archived` rolls + 232 dev sessions, tagged `pre-tomu-import`. Script: `packages/server/scripts/import-history.ts`; sources + full report: `data/history/`. Seq span is now 0001–0735, unique, queryable via the dev filters. New dev sessions continue from 736.
  - Historical double-assignments (0421, 0443, 0444a, 0624, 0674) adjudicated against LR scans; losers imported seq-less with explanatory notes. 5 field-id collisions with existing rolls left displayId unset (noted). ~157 early rolls have the placeholder stock `Unknown | Pre-Tomu unidentified` — refine opportunistically from LR when scans surface.
  - The seq remains the real identifier; LR dates are import dates (decided 2026-06-07). Match/join on seq, never on date.
- **Tank as gear** — Model dev tanks like `cameras` / `lenses` with capacity (sheets, reels, format mode), inversion vs rotation, working volumes. Today `dev_sessions.tank` is free text. Inventory: Stearman SP-445 (4× 4x5), MOD54 (6× 4x5), 1× Paterson 3-reel, 3× Paterson 2-reel, 2× Jobo 1520 (2-reel size, inversion).
- **Display id for orphan rolls** — At least one roll (`27ae8905…` FP4) has no `display_id`. Either backfill at first dev, or treat dev_seq as the primary handle when display_id is null.
- **Reference image attachments** — Phone snaps of scene/box/notes. Roll-level for 35mm/120 (one or a few per roll, frame # often unknown until scan). Frame-level (really sheet-level) for LF, where each sheet is logged individually. Storage: DO Spaces. MCP path: image included in message → tool extracts + uploads → attached to roll/frame.

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
- **Recipe rules engine** — Encode the standing conventions (see Conventions section above) so they're enforced in the app, not remembered by humans.
- **Tank volume defaults** — Lookup table by tank model × reel count × format, sourced from the Gear inventory section above. Used by the dilution helper.
- **Batch dev day UI** — Support a "dev session plan" spanning multiple `dev_sessions`, with chem-reuse grouping by recipe family.
- **Old-sheet roll reconciliation** — Several physical rolls dev'd in 2026-05-12 batch (0727, 0728) suspected to match old-sheet entries (`20240923.3`, `20230503.2`). Need a reconciliation flow: merge or link.
- **Mystery canister tracking** — `27ae8905` canister labeled "24080102" contained HP5 not Acros II. Track canister-label vs film-truth discrepancies as a first-class concept, not just descriptions. Also: `20240801.2` DB/sheet says Acros, canister had HP5 — same class of issue.

## Scanning

- **LF (4x5) scan path** — No working route today. Valoi rig handles 35/120 only. Options: V850 flatbed, or DSLR tile-stitch. Decide before 2026-06-22 LF class.
- **Lightroom handoff** — End of pipeline is import to Lightroom Classic (today). Tomu should support: consistent file naming (likely `{dev_id}_{frame:02}.ext`), per-frame metadata sidecar (XMP) with film/ISO/dev/camera/lens/location so it auto-populates LR fields, and ideally a manifest export per dev_session.
- **Cataloger-agnostic export** — User intends to migrate off Adobe eventually (darktable / digiKam / capture one / other). Keep the handoff layer cataloger-agnostic: rely on standard XMP + filesystem conventions, avoid LR-specific sidecar quirks where possible. Sync-back importers (LR catalog reader, etc.) should be plugin-shaped, not the only path.

## Field / techniques (reference, not code)

- **Very-old color film rescue** — Can cross-process as B&W in Rodinal stand. ECN-2 needs a rem-jet pre-bath first. (Useful as a UI hint/preset if we ever offer "rescue mode" for expired color rolls.)

## Trips

Date ranges for tag suggestion. Suggest by frame date — don't auto-apply.

- **colorado-2025** — 2025-04-27 to 2025-05-06
- **japan-2026** — 2026-05-25 to 2026-06-04 (completed; 18 rolls logged + reconciled 2026-07-04, 4 rolls pending canister check — see memory)

## Calendar / deadlines

- *(none upcoming — LF class 2026-06-22 and Japan trip 2026-05-25→06-04 have passed)*
- Current driver instead of a date: **77 rolls in `shot`** awaiting development — dev-pipeline tooling is the priority (2026-07-07).

## Bugs / nits

- ~~**Drizzle push** — wrong default URL~~ Fixed 2026-07-07: `drizzle.config.ts` default now `filmlog:filmlog@…/filmlog`; `DATABASE_URL` still wins when set.
- ~~**`db:push` is interactive**~~ Root cause was schema drift (plain `unique()` vs the DB's partial index) — fixed 2026-07-05 (commit 2d097eb). Push is now prompt-free; `--force` exists for scripted use if a real destructive change ever comes up.
