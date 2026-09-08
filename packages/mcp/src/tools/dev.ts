// ── Development: candidates, sessions, chemistry, tank plans ──

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { api } from "../api.js";
import { TANKS, computeDilution, findTank, rollEquivalents } from "@tomu/shared";
import { displayStock } from "../matching.js";
import type { CandidateGroup, CandidateRoll, DevSession, PlanResponse, PlanRoll } from "../types.js";
import { TIER_LABEL, formatTime, groupLabel } from "../format.js";

// Tool bodies are intentionally not re-indented: they moved verbatim out of the
// old single-file server.ts, so the split stays reviewable line by line.
export function register(server: McpServer) {

server.tool(
  "tomu_dev_candidates",
  "List rolls awaiting development, grouped by recipe. Tier 1: explicit intended-dev (from labels). Tier 2: matched against past sessions. Tier 3: MDC recipe lookup by stock+ISO. Tier 4: clustered by stock+ISO when no recipe exists anywhere.",
  {},
  async () => {
    const { data: groups } = await api<{ data: CandidateGroup[] }>("/dev-sessions/candidates");

    if (groups.length === 0) {
      return { content: [{ type: "text" as const, text: "No rolls awaiting development." }] };
    }

    function rollLine(roll: CandidateRoll): string {
      const iso = roll.ratedIso && roll.ratedIso !== roll.stockIso ? `@ ${roll.ratedIso} ` : "";
      return `- **${roll.displayId ?? roll.id.slice(0, 8)}** ${displayStock(roll.manufacturer, roll.stockName)} ${iso}(${roll.format})`;
    }
    function recipeLabel(r: CandidateGroup["recipe"]): string {
      if (!r) return "—";
      const dev = r.developer ?? "?";
      const dil = r.dilution ?? "—";
      const asa = r.mdcAsaIso != null ? ` [MDC ISO ${r.mdcAsaIso}]` : "";
      return `${dev} ${dil} ${formatTime(r.devTimeSeconds)}${r.temperatureC ? ` @ ${r.temperatureC}°C` : ""}${asa}`;
    }

    const intended = groups.filter((g) => g.tier === "intended");
    const history = groups.filter((g) => g.tier === "history");
    const mdc = groups.filter((g) => g.tier === "mdc");
    const stockIso = groups.filter((g) => g.tier === "stock-iso");

    const lines: string[] = ["## Dev candidates\n"];
    let i = 0;

    function emit(title: string, gs: CandidateGroup[], headerFor: (g: CandidateGroup) => string) {
      if (!gs.length) return;
      lines.push(`### ${title}\n`);
      for (const g of gs) {
        lines.push(`**Group ${groupLabel(i++)}** — ${headerFor(g)}  (${g.rolls.length})`);
        for (const r of g.rolls) lines.push(rollLine(r));
        lines.push("");
      }
    }

    emit("Tier 1 — intended (from labels)", intended, (g) => recipeLabel(g.recipe));
    emit("Tier 2 — historical recipe match", history, (g) => recipeLabel(g.recipe));
    emit("Tier 3 — MDC recipe lookup", mdc, (g) => recipeLabel(g.recipe));
    emit("Tier 4 — no recipe yet, clustered by stock+ISO", stockIso, (g) => {
      const r0 = g.rolls[0];
      const iso = r0.ratedIso && r0.ratedIso !== r0.stockIso ? `@ ${r0.ratedIso}` : `@ ${r0.stockIso}`;
      return `${displayStock(r0.manufacturer, r0.stockName)} ${iso}`;
    });

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

// ── Tool: tomu_dev_session ────────────────────────────────────────────

server.tool(
  "tomu_dev_session",
  "Create or complete a development session (one tank of rolls dev'd together). " +
    "action='create': pass rolls (display ids like '20260528.01'), developer, and shorthand (e.g. 'B7.5', '1:50/8mins') — " +
    "assigns lifetime Dev Ids, flips rolls to 'developing', and returns mix volumes for the tank. " +
    "action='complete': closes the latest open session (or one named by sessionDisplayId), flips rolls to 'developed'. " +
    "action='list': show open (uncompleted) sessions.",
  {
    action: z.enum(["create", "complete", "list"]).describe("create | complete | list"),
    rolls: z.array(z.string()).optional().describe("create: roll display ids (e.g. ['20260528.01','20260529.02'])"),
    developer: z.string().optional().describe("create: developer name ('HC-110', 'Rodinal', '510 Pyro')"),
    shorthand: z.string().optional().describe("create: dev shorthand — 'B7.5', 'E10:40', '1:50/8mins'"),
    dilution: z.string().optional().describe("create: explicit dilution ('B', '1+31', '1:50') — wins over shorthand"),
    devTimeSeconds: z.number().int().positive().optional().describe("create: explicit time in seconds — wins over shorthand"),
    temperatureC: z.number().optional().describe("create: developer temp °C (default 20)"),
    tank: z.string().optional().describe("create: tank ('SP-445', 'MOD54', 'Paterson 2-reel', 'Jobo') — enables mix volume calc"),
    notes: z.string().optional().describe("create/complete: free-text notes"),
    localDate: z.string().optional().describe("create: local YYYY-MM-DD (defaults to today) — sets session display id and roll dev dates"),
    sessionDisplayId: z.string().optional().describe("complete: session display id (e.g. '20260707.01'); defaults to the latest open session"),
    resultsRating: z.number().int().min(1).max(5).optional().describe("complete: 1-5 results rating"),
    resultsNotes: z.string().optional().describe("complete: how the negatives look"),
  },
  async (args) => {
    if (args.action === "list") {
      const { data: sessions } = await api<{ data: DevSession[] }>("/dev-sessions");
      const open = sessions.filter((s) => !s.completedAt);
      if (!open.length) return { content: [{ type: "text" as const, text: "No open dev sessions." }] };
      const lines = ["## Open dev sessions\n"];
      for (const s of open) {
        lines.push(`- **${s.displayId ?? s.id.slice(0, 8)}** — ${s.developer} ${s.dilution ?? ""} ${formatTime(s.devTimeSeconds)}${s.tank ? ` in ${s.tank}` : ""}`);
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }

    if (args.action === "complete") {
      const { data: sessions } = await api<{ data: DevSession[] }>("/dev-sessions");
      const open = sessions
        .filter((s) => !s.completedAt)
        .sort((a, b) => (b.developedAt ?? "").localeCompare(a.developedAt ?? ""));
      const target = args.sessionDisplayId
        ? open.find((s) => s.displayId === args.sessionDisplayId)
        : open[0];
      if (!target) {
        return {
          content: [{
            type: "text" as const,
            text: args.sessionDisplayId
              ? `No open session with display id "${args.sessionDisplayId}". Open: ${open.map((s) => s.displayId).join(", ") || "none"}.`
              : "No open dev sessions to complete.",
          }],
        };
      }
      const body: Record<string, unknown> = {};
      if (args.resultsRating != null) body.resultsRating = args.resultsRating;
      if (args.resultsNotes) body.resultsNotes = args.resultsNotes;
      await api(`/dev-sessions/${target.id}/complete`, { method: "POST", body: JSON.stringify(body) });
      const { data: detail } = await api<{ data: DevSession }>(`/dev-sessions/${target.id}`);
      const lines = [`Completed **${detail.displayId}** (${detail.developer} ${detail.dilution ?? ""}). Rolls now 'developed':`];
      for (const r of detail.rolls ?? []) {
        lines.push(`- ${r.displayId ?? r.id.slice(0, 8)} → Dev **${r.devId ?? "?"}** — ${displayStock(r.manufacturer, r.stockName)}`);
      }
      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }

    // ── create ──
    if (!args.rolls?.length || !args.developer) {
      return { content: [{ type: "text" as const, text: "create needs `rolls` (display ids) and `developer`." }] };
    }

    const { data: shotRolls } = await api<{ data: Array<{ id: string; displayId: string | null; format: string; status: string }> }>(
      "/rolls?status=shot",
    );
    const resolved: string[] = [];
    const rollFormats: string[] = [];
    const missing: string[] = [];
    for (const want of args.rolls) {
      const hit = shotRolls.find((r) => r.displayId === want.trim());
      if (hit) {
        resolved.push(hit.id);
        rollFormats.push(hit.format);
      } else missing.push(want);
    }
    if (missing.length) {
      return {
        content: [{
          type: "text" as const,
          text: `Not found among 'shot' rolls: ${missing.join(", ")}. (Already developing? Wrong id? Use tomu_rolls status='shot' to check.)`,
        }],
      };
    }

    const body: Record<string, unknown> = {
      rollIds: resolved,
      developer: args.developer,
    };
    if (args.shorthand) body.shorthand = args.shorthand;
    if (args.dilution) body.dilution = args.dilution;
    if (args.devTimeSeconds) body.devTimeSeconds = args.devTimeSeconds;
    if (args.temperatureC != null) body.temperatureC = args.temperatureC;
    if (args.tank) {
      const spec = findTank(args.tank);
      body.tank = spec?.name ?? args.tank;
    }
    if (args.notes) body.notes = args.notes;
    if (args.localDate) body.localDate = args.localDate;

    const { data: session } = await api<{ data: DevSession }>("/dev-sessions", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const { data: detail } = await api<{ data: DevSession }>(`/dev-sessions/${session.id}`);

    const lines = [
      `## Dev session **${detail.displayId}** started`,
      ``,
      `${detail.developer} ${detail.dilution ?? "?"} — ${formatTime(detail.devTimeSeconds)}${detail.temperatureC ? ` @ ${detail.temperatureC}°C` : ""}${detail.tank ? ` — ${detail.tank}` : ""}`,
      ``,
      `Dev Ids assigned:`,
    ];
    for (const r of detail.rolls ?? []) {
      lines.push(`- ${r.displayId ?? r.id.slice(0, 8)} → Dev **${r.devId ?? "?"}** — ${displayStock(r.manufacturer, r.stockName)} (${r.format})`);
    }

    // Mix instructions + guardrails
    const warnings: string[] = [];
    if (detail.devTimeSeconds != null && detail.devTimeSeconds < 300) {
      warnings.push(`Dev time ${formatTime(detail.devTimeSeconds)} is under 5 minutes — standing convention avoids sub-5-minute times (timing error dominates). Consider a higher dilution.`);
    } else if (detail.devTimeSeconds != null && detail.devTimeSeconds < 420) {
      warnings.push(`Dev time ${formatTime(detail.devTimeSeconds)} is under the 7-minute preference.`);
    }
    if (args.tank && detail.dilution) {
      const spec = findTank(args.tank);
      if (spec) {
        const rollEq = rollFormats.reduce((sum, f) => sum + rollEquivalents(f, 1), 0);
        const cap = spec.capacity.find((c) => c.format === (rollFormats[0] as "35mm" | "120" | "4x5"));
        if (cap && rollFormats.length > cap.count) {
          warnings.push(`${rollFormats.length}× ${rollFormats[0]} exceeds ${spec.name} capacity (${cap.count}).`);
        }
        const mix = computeDilution(detail.developer, detail.dilution, spec.volumeMl, rollEq);
        if (mix) {
          lines.push(``, `Mix for ${spec.name} (${spec.volumeMl} ml): **${mix.concentrateMl} ml ${detail.developer} + ${mix.waterMl} ml water** (${mix.dilution})`);
          warnings.push(...mix.warnings);
        }
      }
    }
    if (warnings.length) {
      lines.push(``, `⚠️ ${warnings.join("\n⚠️ ")}`);
    }
    lines.push(``, `When the tank is done: tomu_dev_session action='complete'.`);
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

// ── Tool: tomu_dilution ───────────────────────────────────────────────


server.tool(
  "tomu_dilution",
  "Compute developer mix volumes: (developer, dilution, tank-or-volume) → ml of concentrate + water, with minimum-concentrate warnings. " +
    "Knows the HC-110 letter table (A=1+15 B=1+31 C=1+19 D=1+39 E=1+47 F=1+79 G=1+119 H=1+63) and the user's tanks.",
  {
    developer: z.string().describe("Developer: 'HC-110', 'Rodinal', '510 Pyro', 'D-76'…"),
    dilution: z.string().describe("Dilution: HC-110 letter ('B', 'H') or ratio ('1+31', '1:50')"),
    tank: z.string().optional().describe("Tank name ('SP-445', 'MOD54', 'Paterson 3-reel', 'Jobo') — sets the volume"),
    volumeMl: z.number().positive().optional().describe("Explicit volume in ml (overrides tank)"),
    rolls: z.number().positive().optional().describe("Roll count for minimum-concentrate check (4x5 sheets: pass sheets/4)"),
  },
  async ({ developer, dilution, tank, volumeMl, rolls: rollCount }) => {
    const spec = tank ? findTank(tank) : null;
    const volume = volumeMl ?? spec?.volumeMl;
    if (!volume) {
      const names = Object.values(TANKS).map((t) => `${t.name} (${t.volumeMl} ml)`).join(", ");
      return { content: [{ type: "text" as const, text: `Need a tank or volumeMl. Known tanks: ${names}.` }] };
    }
    const mix = computeDilution(developer, dilution, volume, rollCount);
    if (!mix) {
      return { content: [{ type: "text" as const, text: `Couldn't parse dilution "${dilution}". Use an HC-110 letter (A–H) or a ratio like '1+31' / '1:50'.` }] };
    }
    const lines = [
      `**${developer} ${mix.dilution}** in ${spec ? `${spec.name} (${volume} ml)` : `${volume} ml`}:`,
      ``,
      `- Concentrate: **${mix.concentrateMl} ml**`,
      `- Water: **${mix.waterMl} ml**`,
    ];
    if (mix.warnings.length) lines.push(``, `⚠️ ${mix.warnings.join("\n⚠️ ")}`);
    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

// ── Tool: tomu_correct_roll ───────────────────────────────────────────

server.tool(
  "tomu_tank_plan",
  "Plan a dev session: pack the shot-roll backlog into concrete tank loads (one recipe per tank, zero tolerance — " +
    "groups from tomu_dev_candidates are atomic). Returns ordered loads with mix volumes, recipe provenance, and " +
    "a waiting list of what didn't pack. Advisory only — create sessions explicitly with tomu_dev_session.",
  {
    tanksAvailable: z.array(z.string()).optional().describe("Restrict to these tanks (fuzzy names). Default: full fleet"),
    excludeTanks: z.array(z.string()).optional().describe("Leave these out (e.g. a tank still wet)"),
    maxTanks: z.number().int().positive().optional().describe("'I'll run N tanks tonight' — best N loads only"),
    includeRolls: z.array(z.string()).optional().describe("Roll display ids that MUST be in the plan"),
    tags: z.array(z.string()).optional().describe("Only rolls carrying any of these tags"),
    developer: z.string().optional().describe("Only this developer (e.g. 'HC-110')"),
  },
  async (params) => {
    const { data: plan } = await api<{ data: PlanResponse }>("/tanks/plan", {
      method: "POST",
      body: JSON.stringify(params),
    });

    if (!plan.loads.length && !plan.remainder.length) {
      return { content: [{ type: "text" as const, text: "Backlog is empty — nothing to plan." }] };
    }

    const lines: string[] = ["## Tank plan\n"];

    plan.loads.forEach((l, i) => {
      const r = l.recipe;
      const temp = r.temperatureC ? ` @ ${r.temperatureC}°C` : "";
      lines.push(
        `### Load ${i + 1} — ${l.tankName} — ${r.developer} ${r.dilution ?? "?"} ${formatTime(r.devTimeSeconds)}${temp}  [${TIER_LABEL[l.tier]}]`,
      );
      const oldest = l.oldestLoadedAt?.slice(0, 10);
      for (const roll of l.rolls) {
        const iso = roll.ratedIso && roll.ratedIso !== roll.stockIso ? ` @ ${roll.ratedIso}` : "";
        const marker = oldest && roll.loadedAt?.slice(0, 10) === oldest ? `  ← oldest: ${oldest}` : "";
        lines.push(`- **${roll.displayId ?? roll.id.slice(0, 8)}** ${displayStock(roll.manufacturer, roll.stockName)}${iso} (${roll.format})${marker}`);
      }
      lines.push(`- Fill: ${l.usedUnits}/${l.capacityUnits} ${l.rolls[0]?.format === "4x5" ? "sheets" : "reel units"}`);
      if (l.mix) lines.push(`- Mix: **${l.mix.concentrateMl} ml** ${r.developer} + **${l.mix.waterMl} ml** water (${l.mix.dilution}) in ${l.tankVolumeMl} ml`);
      for (const w of l.warnings) lines.push(`- ⚠️ ${w}`);
      lines.push("");
    });

    if (plan.remainder.length) {
      lines.push(`### Waiting (${plan.remainder.length})\n`);
      const byReason = new Map<string, PlanRoll[]>();
      for (const u of plan.remainder) {
        if (!byReason.has(u.reason)) byReason.set(u.reason, []);
        byReason.get(u.reason)!.push(u.roll);
      }
      for (const [reason, rollList] of byReason) {
        lines.push(`**${reason}** (${rollList.length}):`);
        lines.push(rollList.map((roll) => roll.displayId ?? roll.id.slice(0, 8)).join(", "));
        lines.push("");
      }
    }

    for (const w of plan.warnings) lines.push(`⚠️ ${w}`);

    if (plan.loads.length) {
      lines.push(
        `_To run a load: tomu_dev_session action=create with its rolls, developer, dilution/time, and tank._`,
      );
    }

    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
  }
);

}
