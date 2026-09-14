# field-parse eval

How much of a spoken field note each parsing tier gets right, and what the merge
threshold is actually buying.

```bash
npm run eval:field-parse                      # replay: offline, deterministic
npm run eval:field-parse -- --verbose         # per-case detail
ANTHROPIC_API_KEY=… npm run eval:field-parse -- --live    # record tier-2 answers
npm run eval:field-parse -- --sweep           # merge threshold table
npm run eval:field-parse -- --json            # machine-readable
```

## What it measures

Three configurations over one corpus:

| config | what it is |
|---|---|
| `tier 1` | `parseTranscript` — the deterministic parser that runs on the phone on every keystroke. No network, so it is always scored. |
| `tier 2` | the model's answer alone, from a recording. As in production it is *told what tier 1 already found*, so it is not an independent oracle. |
| `merged @ T` | the real `mergeParse` policy at threshold `T`. Production is `TIER2_OVERRIDE_CONFIDENCE` (0.9). |

Five outcomes per field, and the split that matters is wrong and spurious:

- **hit** — expected a value, got it.
- **miss** — expected a value, got nothing.
- **wrong** — expected a value, got a different one.
- **spurious** — expected nothing, got a value.
- **flagged** — a wrong or spurious value on a field the merge sent to review (the
  speaker retracted it). Still untrue, but a person is told before trusting it, so it
  is counted apart from harm.

A miss costs a field the photographer can still fill in at the desk. A wrong or
spurious value is a lie in the log that looks like data — that is the f/50 class, where
"Ilford Pan F50" was read as aperture f/50. `harm = wrong + spurious` is the number to
minimise, and it is what the gate in `eval.test.ts` is set against. A parser that finds
less is not failing; a parser that invents is.

Structured fields (shutter, aperture, compensation, metering, frame, sheet, camera,
lens) are scored strictly: a field the case does not expect must come back empty.
Free-text fields (`subject`, `locationName`) are scored by containment and only when a
case states an expectation — a model that volunteers a subject nobody asked about is
not making a mistake.

## The corpus

`cases.json`, 23 cases, each tagged with where it came from — because "here is my eval
set" should be answerable with provenance rather than a shrug:

- **`field`** — the wording itself is real. A dictation from the field, preserved in the
  repo (a test fixture or a commit message), cited in the case's `provenance`.
- **`reconstructed`** — the incident is real, the wording around it is approximate.
  The 2026-09-07 mishearings ("Like an M6", "Mica M6") are recorded in `93ad38a`; the
  sentences they sat in are not.
- **`synthetic`** — written for coverage of a family in the V2 spec §4, or as a negative
  case ("sixteen people at the party" must not parse as 1/16).

The scores are reported per class, so a good total cannot hide behind synthetic cases
written to pass. **Re-tag anything you know better than the repo does** — these tags were
set from repo evidence, not from memory of the day.

Adding a case: append to `cases.json` with a real `provenance`, then run the eval. Tier
1 should stay at `harm 0` outside the known gaps; a new `miss` is a finding, not a failure.

### Known gaps

`KNOWN_TIER1_GAPS` in `eval.test.ts` lists, by id, the cases tier 1 currently gets
wrong. It is a ratchet: every other case stays under the strict gates, and a listed case
that starts passing fails the build until it is taken off the list.

The list exists because of five **conflict cases** added 2026-09-14. The first sweep was
flat from 0.5 to 1.0: no case had the tiers disagreeing, so the corpus could not say
anything about the threshold. The conflict cases (spoken self-corrections, a retracted
setting, a push ISO next to settings, a spoken decimal f-number) found:

- a first-match rule in tier 1 that keeps a value the speaker corrected ("f eight,
  actually f eleven" → f/8) or retracted ("plus one, never mind" → +1);
- a **policy** gap rather than a model one: `mergeParse` skips null tier-2 values, so
  tier 2 cannot clear a value tier 1 invented, at any threshold;
- the first real shape in the sweep: at 0.95 and above, the model's f/11 correction is
  refused and harm rises.

**What changed the same day.** Tier 1 now honours a spoken correction: when a cue
("actually", "no wait", "I mean", "sorry", "rather", "make that") sits directly after a
value and a new value for the same field follows, the later one wins; without a cue,
first-match stays. It also reads "f four", "f two", "f three point five" and "a hundred
twenty-fifth". A retraction is deliberately *not* interpreted by tier 1. Tier 2 reports
it in `retracted`, and `mergeParse` never clears the value — it returns the field in
`retracted` and the server marks the event for review, naming the value still recorded
(owner decision: no model erases data). `retracted-compensation` is the only known gap
left.

Re-recording under the new prompt exposed a regression the eval was built to catch:
on `bulb-on-tripod` the model began choosing the Mamiya 80mm for "Mamiya 7" (3 of 3
calls, against 0 of 3 under the old prompt). Rewording the lens instruction did not
move it, so the fix is in code: `lensNamedIn` drops a tier-2 `lensId` unless the note
names the lens by a token no camera label shares.

23 cases, `claude-haiku-4-5`: tier 1 92% harm 1 (the retraction), tier 2 alone 86%
harm 0, merged at 0.9 98% harm 0 with 1 flagged. The sweep is flat again — tier 1 now
agrees with the model on every conflict case — so the corpus needs new cases where the
tiers disagree before it can say anything more about 0.9.

## Recordings

Tier-2 scoring needs one model call per case. `--live` makes them and writes
`recordings/<case>.<key>.json`, where the key is a hash of **model + prompt + transcript**.
Consequences, both deliberate:

- Replay is deterministic and offline, so the gate runs in CI with no key.
- Editing `field-parse-prompt.md` invalidates every recording rather than silently
  scoring yesterday's answers against today's prompt. The runner reports them as stale
  and names the cases that need re-recording.

Each recording also stores the call's wall-clock `latencyMs`, and the runner reports the
median. That number is the argument for keeping tier 2 out of the capture path, stated
rather than asserted — next to tier 1's ~45 µs. Token and cost accounting would need the
raw SDK response plumbed out of `requestTier2`; it isn't, yet.

Recordings are not committed: they are cheap to regenerate, they go stale with every
prompt edit, and a committed one would get scored long after it stopped being what the
model says.

## The threshold sweep

`--sweep` re-runs the real merge policy at thresholds 0.5 → 1.0 and prints hit/miss/
wrong/spurious at each, marking production's 0.9. The point is that 0.9 was a judgment
call, and this is how it stops being one. Read it for two things: where harm starts
rising (the model overriding correct tier-1 values), and where hits stop improving
(the model's confidence no longer earning the override).

With 23 cases this is a smoke test, not a measurement — the corpus needs to be tens of
real dictations before the sweep should move the constant.

## Why it can run at all

`requestTier2` lives in `packages/server/src/services/field-parse-client.ts`, split out
of `field-parse-model.ts` so the model call is a function of its inputs with no database
behind it. Same reason `matching.ts` was split out of the MCP server: a rule you want to
measure has to be reachable on its own.
