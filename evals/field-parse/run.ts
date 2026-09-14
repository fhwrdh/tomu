#!/usr/bin/env tsx
/**
 * Field-parse eval: how much of a spoken field note each tier gets right, and what the
 * merge threshold is actually buying.
 *
 * Three configurations over the same corpus:
 *   tier 1      the deterministic parser, on device. No network, so it always runs.
 *   tier 2      the model's answer alone, from a recording. As in production, the model
 *               is told what tier 1 already found, so this is not an independent oracle.
 *   merged@T    the real `mergeParse` policy at threshold T (production default 0.9).
 *
 * Tier 2 needs recordings. `--live` makes them: one call per case against
 * FIELD_PARSE_MODEL with ANTHROPIC_API_KEY, written to `recordings/` and keyed by
 * model + prompt hash + transcript — so editing the prompt invalidates every recording
 * rather than silently scoring the old answers against the new prompt.
 *
 * Run it through the npm script, not tsx directly: `@tomu/shared` resolves through its
 * package entry (dist/), so the script rebuilds it first. Skipping that scores the last
 * build instead of the tree — which once reported a clean run while the parser in the
 * working copy was producing f/50.
 *
 * Usage: npm run eval:field-parse                 replay (offline, deterministic)
 *        npm run eval:field-parse -- --live       call the model for missing recordings
 *        npm run eval:field-parse -- --sweep      threshold table
 *        npm run eval:field-parse -- --verbose    per-case detail
 *        npm run eval:field-parse -- --json       machine-readable
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { TIER2_OVERRIDE_CONFIDENCE } from "@tomu/shared";
import { requestTier2, tier2Prompt } from "../../packages/server/src/services/field-parse-client.js";
import { harm, scoreCase, scored, tally, type EvalCase, type FieldScore, type Tally } from "./score.js";
import {
  CASES, GEAR, MODEL, RECORDINGS_DIR, currentFrom, keyFor, loadRecordings, mergedOf, tier1Of, tier2Of,
  type Recording,
} from "./observe.js";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);

const plain = !!process.env.NO_COLOR || !process.stdout.isTTY;
const sgr = (c: string) => (s: string) => (plain ? s : `\x1b[${c}m${s}\x1b[0m`);
const bold = sgr("1"), dim = sgr("2"), green = sgr("32"), yellow = sgr("33"), red = sgr("31");

// ── reporting ──

const pct = (n: number, d: number) => (d === 0 ? "  — " : `${Math.round((n / d) * 100)}%`.padStart(4));

function row(label: string, t: Tally): string {
  const h = harm(t);
  const harmText = h === 0 ? green("0") : red(String(h));
  return `  ${label.padEnd(22)}${pct(t.hit, scored(t))}  ${String(t.hit).padStart(3)} hit  ${String(t.miss).padStart(3)} miss  ${String(t.wrong).padStart(3)} wrong  ${String(t.spurious).padStart(3)} spurious   harm ${harmText}`;
}

function bySource(scores: Map<string, FieldScore[]>): string[] {
  const groups = ["field", "reconstructed", "synthetic"] as const;
  return groups.map((g) => {
    const ids = CASES.filter((c) => c.source === g).map((c) => c.id);
    const all = ids.flatMap((id) => scores.get(id) ?? []);
    return row(`  ${g} (${ids.length})`, tally(all));
  });
}

async function main(): Promise<void> {
  const promptSha = createHash("sha256").update(await tier2Prompt()).digest("hex").slice(0, 12);
  let { byKey, all } = loadRecordings();

  if (flag("live")) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      console.error("--live needs ANTHROPIC_API_KEY (the same key the server uses for tier 2).");
      process.exit(2);
    }
    const client = new Anthropic({ apiKey: key });
    let made = 0;
    for (const c of CASES) {
      const k = keyFor(MODEL, promptSha, c.transcript);
      if (byKey.has(k) && !flag("force")) continue;
      const t1 = tier1Of(c);
      process.stdout.write(`  recording ${c.id}… `);
      const started = Date.now();
      const result = await requestTier2(client, MODEL, {
        transcript: c.transcript,
        gear: GEAR,
        rollFormat: null,
        // Production sends what the event already holds, so the model sees tier 1's answer.
        current: currentFrom(t1),
      });
      const latencyMs = Date.now() - started;
      const rec: Recording = { caseId: c.id, model: MODEL, promptSha, transcript: c.transcript, recordedAt: new Date().toISOString(), latencyMs, result };
      writeFileSync(`${RECORDINGS_DIR}${c.id}.${k}.json`, `${JSON.stringify(rec, null, 2)}\n`);
      made++;
      console.log(`ok (${latencyMs} ms)`);
    }
    console.log(`  ${made} recording(s) written to recordings/\n`);
    ({ byKey, all } = loadRecordings());
  }

  const t1Scores = new Map<string, FieldScore[]>();
  const t2Scores = new Map<string, FieldScore[]>();
  const mScores = new Map<string, FieldScore[]>();
  const missing: string[] = [];

  for (const c of CASES) {
    t1Scores.set(c.id, scoreCase(c, tier1Of(c)));
    const rec = byKey.get(keyFor(MODEL, promptSha, c.transcript));
    if (!rec) { missing.push(c.id); continue; }
    t2Scores.set(c.id, scoreCase(c, tier2Of(rec)));
    mScores.set(c.id, scoreCase(c, mergedOf(c, rec, TIER2_OVERRIDE_CONFIDENCE)));
  }

  const flat = (m: Map<string, FieldScore[]>) => [...m.values()].flat();

  if (flag("json")) {
    console.log(JSON.stringify({
      model: MODEL, promptSha, cases: CASES.length, recordings: byKey.size, missing,
      tier1: tally(flat(t1Scores)), tier2: tally(flat(t2Scores)),
      merged: tally(flat(mScores)), threshold: TIER2_OVERRIDE_CONFIDENCE,
    }, null, 2));
    return;
  }

  console.log(`\n  ${bold("field-parse eval")}  ${dim(`${CASES.length} cases · model ${MODEL} · prompt ${promptSha}`)}\n`);
  console.log(row("tier 1 (on device)", tally(flat(t1Scores))));
  for (const line of bySource(t1Scores)) console.log(line);

  if (byKey.size === 0) {
    console.log(`\n  ${yellow("no tier-2 recordings")} ${dim("— tier 1 is scored above; the rest needs one call per case:")}`);
    console.log(`  ${dim("ANTHROPIC_API_KEY=… npm run eval:field-parse -- --live")}\n`);
  } else {
    console.log();
    console.log(row("tier 2 (model alone)", tally(flat(t2Scores))));
    console.log(row(`merged @ ${TIER2_OVERRIDE_CONFIDENCE}`, tally(flat(mScores))));
    // The reason tier 2 is not in the capture path, as a number.
    const latencies = [...byKey.values()].map((r) => r.latencyMs).filter((n): n is number => n != null).sort((a, b) => a - b);
    if (latencies.length) {
      const median = latencies[Math.floor(latencies.length / 2)];
      console.log(`  ${dim(`tier-2 call: ${median} ms median, ${latencies[0]}–${latencies[latencies.length - 1]} ms over ${latencies.length} recordings (tier 1 is ~45 µs)`)}`);
    }
    if (missing.length) {
      console.log(`\n  ${yellow(`${missing.length} case(s) without a recording for this prompt:`)} ${dim(missing.join(", "))}`);
      if (all.length > byKey.size) {
        console.log(`  ${dim(`${all.length - byKey.size} stale recording(s) on disk — made under a different prompt or model.`)}`);
      }
    }
  }

  if (flag("sweep")) {
    if (byKey.size === 0) {
      console.log(`  ${dim("--sweep needs recordings.")}\n`);
    } else {
      console.log(`\n  ${bold("threshold sweep")} ${dim("— the same policy, the constant varied")}`);
      for (let t = 0.5; t <= 1.0001; t += 0.05) {
        const th = Math.round(t * 100) / 100;
        const s = CASES.flatMap((c) => {
          const rec = byKey.get(keyFor(MODEL, promptSha, c.transcript));
          return rec ? scoreCase(c, mergedOf(c, rec, th)) : [];
        });
        const mark = th === TIER2_OVERRIDE_CONFIDENCE ? ` ${yellow("← production")}` : "";
        console.log(`${row(`  @ ${th.toFixed(2)}`, tally(s))}${mark}`);
      }
    }
  }

  if (flag("verbose")) {
    console.log(`\n  ${bold("per case")}`);
    for (const c of CASES) {
      const t1 = tally(t1Scores.get(c.id) ?? []);
      console.log(`\n  ${bold(c.id)} ${dim(`[${c.source}]`)} ${harm(t1) ? red("harm") : ""}`);
      console.log(`    ${dim(`"${c.transcript}"`)}`);
      for (const s of t1Scores.get(c.id) ?? []) {
        const mark = s.outcome === "hit" ? green("✓") : s.outcome === "miss" ? yellow("○") : red("✗");
        console.log(`    ${mark} ${s.field.padEnd(13)}${dim(`expected ${s.expected ?? "—"}, got ${s.observed ?? "—"}`)}`);
      }
    }
  }

  console.log();
  // Tier 1 runs offline on every corpus, so a value it invents is always a regression.
  if (harm(tally(flat(t1Scores))) > 0) {
    console.error(`  ${red("tier 1 produced a wrong or spurious value — see --verbose")}\n`);
    process.exit(1);
  }
}

await main();
