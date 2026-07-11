# Tomu Roadmap

Running backlog of ideas, follow-ups, and known issues. Not prioritized unless noted. Add freely; prune as things ship.

## North star (stated 2026-07-07)

**Tomu is a "pit of success" for the photography — not just a log or a database. An everything.**

The correct action should be the path of least resistance. Test every feature against this: does it make the right thing happen by default, or does it just record what happened? Concretely:

- **Identity is automatic.** Dev Ids, display ids, session ids — assigned by the app at the moment the real-world event happens (tank time, unload time). The human never hand-tracks a counter again.
- **Knowledge lives in code, not memory.** Dilution tables, tank volumes, conventions (min-syrup, sub-5-min, expired-at-box). If getting it wrong once cost film, it becomes a constant or a warning.
- **The app catches mistakes before they cost film.** Warnings at pour time, verification at log time, conflicts surfaced instead of silently absorbed.
- **History answers questions.** Every past roll, dev, and scan is queryable — "what did I develop that day", "how did I dev this stock last time". Recipes come from your own history first.
- **Capture is frictionless everywhere.** MCP in a chat, field log on Drive, retro-logging from labels/photos — meeting the work where it happens, reconciling later.
- **The loop closes.** Shoot → dev → scan → catalog is one pipeline, not four tools. Anything that leaves a manual gap between stages is unfinished.

## Conventions (authoritative)

Standing rules to follow when planning dev / scan workflows. These belong here, not in chat memory.

- **Expired film:** shoot at rated ISO, develop at box ISO.
- **Push / pull:** develop at rated ISO (not box).
- **Dev time bias:** when MDC offers a range or multiple recipes, prefer 7+ minutes. Avoid sub-5-minute times.
- **Recency in candidate selection:** when subsetting a candidate group to a tank, prefer the most recently shot rolls. Preference, not a hard rule — and never re-open an already-loaded tank to honor it.
- **Rodinal 1+50 in Jobo 2-reel (inversion):** standard mix is 10 ml syrup + 500 ml water (510 ml total). Hits the 10 ml/roll-pair minimum without changing the ratio.
- **Min-syrup remedies never change the dilution** (owner, 2026-07-11): a dilution shift means a different time — zero recipe tolerance. The only legal fixes are a bigger tank or more volume at the same ratio. The tank planner prefers a legal bigger tank automatically (score penalty on violating loads); warnings offer the volume bump only.
- **HC-110 dilution letters → ratios (Kodak canonical):** A=1+15, B=1+31, C=1+19, D=1+39, E=1+47, F=1+79, G=1+119, H=1+63. **Always verify against `data/mdc/hc110.txt` before quoting.**
- **Batch dev days:** user loads many tanks one day, develops the next (may split across multiple nights). Plan as multi-tank sequences, not one-offs.
- **MCP-first field input:** in the field, the MCP tools are the primary input path; the UI is for later review.
- **Field fallback when MCP not reachable:** when away from a Claude Code session with `tomu_*` tools (e.g. travel, no laptop), use a Google Drive doc as the durable field log instead of relying on chat history. Mobile Claude app + Drive connector append timestamped entries to a per-trip doc following the format embedded at the top of the doc. Transcribed into Tomu via MCP on return. Active doc for the upcoming trip: "Tomu Field Log — Japan 2026" (Drive id `1ogZZbmcIA7NLviizKqodYmQeaikTbHYxjw_GsPswuqo`). Reason chat-as-log is unsafe: context window compression has lost important details in past sessions.

## Gear inventory

Authoritative kit summary. Update when gear changes.

- **Cameras / lenses:** see `cameras` and `lenses` tables in the DB.
- **Dev tanks:** now data — `tanks` table, editable via `tomu_tanks` / `PATCH /tanks/:id`. The DB is authoritative; run `tomu_tanks list` for current fleet. Reel math (owner-confirmed 2026-07-11): 120 reel = 1.5× a 35mm reel on the column, mixed loads legal where units fit.
  - Seeded 2026-07-11 from the tank-plan spec: 1× Paterson 3-reel (1000 ml), 4× 2-reel (500 ml), 1× 1-reel (290 ml), 1× Jobo 1520 (500 ml, inversion only, Rodinal 10/500 convention), SP-445 (475 ml, 4× 4x5), MOD54 (1000 ml, 6× 4x5).
  - ⚠️ **Fleet count conflict, owner rundown pending**: this section previously said 3× 2-reel + 2× Jobo (no 1-reel); the spec said 4× 2-reel + 1× Jobo + 1× 1-reel. Seeded the spec's version; owner will give a full rundown to reconcile ("fine for now — fine-tune later").
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
- ~~**Tank as gear**~~ Done 2026-07-11: `tanks` table (kind roll/sheet, volumeMl, reelUnits/sheetCapacity, quantity, agitation, isActive) + `/tanks` CRUD + `tomu_tanks` MCP. `dev_sessions.tank` stays free text for now; linking sessions to tank rows is a future nicety. Static `TANKS` in shared remains only as the `tomu_dilution` fallback — unify later.
- **Display id for orphan rolls** — At least one roll (`27ae8905…` FP4) has no `display_id`. Either backfill at first dev, or treat dev_seq as the primary handle when display_id is null.
- **Reference image attachments** — Phone snaps of scene/box/notes. Roll-level for 35mm/120 (one or a few per roll, frame # often unknown until scan). Frame-level (really sheet-level) for LF, where each sheet is logged individually. Storage: DO Spaces. MCP path: image included in message → tool extracts + uploads → attached to roll/frame.

## API / MCP

All shipped 2026-07-07:

- ~~**Rolls response**~~ `devDate`/`devSeq`/`devId`, `firstShot`/`lastShot` aggregates, `framesShot`, intended-dev fields.
- ~~**Rolls filters**~~ `?dev_seq=`, `?dev_seq_range=`, `?dev_date_from/to=`, `?developed_between=`, `?status=`.
- ~~**`tomu_rolls` MCP**~~ Mirrors the filters; shows Dev Ids; uses devId as handle when display_id is null.
- ~~**`tomu_dev_session` MCP**~~ create/complete/list. Create assigns lifetime Dev Ids (continues from all-time max, currently 0735), flips rolls to `developing`, returns tank mix volumes + sub-5-min warnings; complete flips to `developed`.
- ~~**Dev candidates grouping bug**~~ Buckets now normalize via `normalizeDilution` — "B" and "1+31" merge. History tier is live now that 232 historical sessions exist.

## Dev workflow

- ~~**Dilution constants in code**~~ Done 2026-07-07: `packages/shared/src/dilution.ts` — HC-110 letter table (H=1+63), min-concentrate rules (HC-110 6 ml/roll, Rodinal 10 ml/roll), tank specs. The code is the source of truth now.
- ~~**Dilution helper**~~ Done: `computeDilution()` + `tomu_dilution` MCP tool; also runs inline in `tomu_dev_session` create. Min-syrup warnings reproduce the 10/510 Rodinal convention. UI surfacing still pending.
- ~~**Tank volume defaults**~~ Done: `TANKS` in shared, fuzzy `findTank()`.
- **Recipe verification at log time** — Partially done: session create warns on sub-5-min (hard) and sub-7-min (preference) times. Full MDC cross-check (compare intended vs devRecipes for the rated ISO) still to do.
- **Recipe rules engine** — Remaining conventions to encode: expired-at-box-ISO, push-at-rated-ISO, recency preference in candidate subsetting.
- ~~**Tank planning**~~ Done 2026-07-11 per owner spec (`docs/specs/tank-plan.md`, from Drive): `POST /tanks/plan` + `tomu_tank_plan` MCP. Packs dev-candidate groups (atomic — zero recipe tolerance) into concrete tank loads via best-load greedy (rolls-cleared dominant, includeRolls hard priority, tier as tiebreak); mix volumes + min-syrup/sub-5-min/MDC-provenance warnings per load; remainder listed with reasons, no shooting advice. Params: tanksAvailable/excludeTanks/maxTanks/includeRolls/tags/developer. Grouping extracted to `services/dev-candidates.ts`; packer in `services/tank-plan.ts`. Spec's "3-reel twice" example implies tank *reuse* within a session — current packer consumes each physical tank once per plan (use excludeTanks for wet tanks); revisit with owner.
- **Batch dev day UI** — Support a "dev session plan" spanning multiple `dev_sessions`, with chem-reuse grouping by recipe family. (Backend half shipped as tank planning above.)
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
