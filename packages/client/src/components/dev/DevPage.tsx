import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { FlaskConical, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import {
  devSessions,
  tanks,
  type Tank,
  type CandidateGroup,
  type CandidateRecipe,
  type CandidateRoll,
  type CandidateTier,
  type PlannedLoad,
  type TankPlan,
} from "../../services/api.js";
import { Button } from "../ui/button.js";
import { Badge } from "../ui/badge.js";
import { Input } from "../ui/input.js";
import { Select } from "../ui/select.js";

const VIEWS = [
  { value: "candidates", label: "Candidates" },
  { value: "plan", label: "Plan" },
];

// Tier says where the recipe came from — intended (the roll itself) is the most
// trustworthy, stock-iso the weakest. Worth showing on every recipe.
const TIER_LABELS: Record<CandidateTier, string> = {
  intended: "intended",
  history: "history",
  mdc: "MDC",
  "stock-iso": "stock ISO",
};

function formatTime(seconds: number | null | undefined): string | null {
  if (seconds == null) return null;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s === 0 ? `${m}:00` : `${m}:${String(s).padStart(2, "0")}`;
}

function recipeLine(recipe: CandidateRecipe | null): string {
  if (!recipe) return "No recipe";
  const parts = [recipe.developer ?? "developer?", recipe.dilution ?? "dilution?"];
  const time = formatTime(recipe.devTimeSeconds);
  if (time) parts.push(time);
  if (recipe.temperatureC) parts.push(`${recipe.temperatureC}°C`);
  return parts.join(" · ");
}

function rollLabel(roll: CandidateRoll): string {
  const stock = `${roll.manufacturer} ${roll.stockName}`;
  const iso = roll.ratedIso && roll.ratedIso !== roll.stockIso ? ` @${roll.ratedIso}` : "";
  return roll.displayId ? `${roll.displayId} · ${stock}${iso}` : `${stock}${iso} (${roll.format})`;
}

function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  return iso.slice(0, 10);
}

function TierBadge({ tier }: { tier: CandidateTier }) {
  return <Badge variant="outline">{TIER_LABELS[tier]}</Badge>;
}

function RollChips({ rolls }: { rolls: CandidateRoll[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {rolls.map((roll) => (
        <span key={roll.id} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
          {rollLabel(roll)}
        </span>
      ))}
    </div>
  );
}

function Warnings({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  return (
    <ul className="space-y-0.5">
      {warnings.map((w) => (
        <li key={w} className="flex gap-1.5 text-[11px] text-amber-500">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
          <span>{w}</span>
        </li>
      ))}
    </ul>
  );
}

/** A candidate group as shown: identical recipes merged across their tiers. */
interface MergedGroup {
  key: string;
  recipe: CandidateRecipe | null;
  tiers: CandidateTier[];
  rolls: CandidateRoll[];
  oldestLoadedAt: string | null;
}

const TIER_ORDER: CandidateTier[] = ["intended", "history", "mdc", "stock-iso"];

/**
 * The server keys groups by tier as well as recipe, so the same developer +
 * dilution + time arrives split across tiers. What matters here is what could
 * share a tank, so merge on the recipe alone and keep the tiers as provenance.
 * Temperature is not part of the key: it is shown only when the merged groups
 * agree, since a conflict means we do not know which one to run at.
 */
function mergeGroups(groups: CandidateGroup[]): MergedGroup[] {
  const merged = new Map<string, MergedGroup & { temps: Set<string | null> }>();

  for (const group of groups) {
    const r = group.recipe;
    const key = r ? `${r.developer ?? ""}|${r.dilution ?? ""}|${r.devTimeSeconds ?? ""}` : "none";
    let entry = merged.get(key);
    if (!entry) {
      entry = {
        key,
        recipe: r ? { ...r } : null,
        tiers: [],
        rolls: [],
        oldestLoadedAt: null,
        temps: new Set(),
      };
      merged.set(key, entry);
    }
    if (!entry.tiers.includes(group.tier)) entry.tiers.push(group.tier);
    entry.temps.add(r?.temperatureC ?? null);
    for (const roll of group.rolls) {
      if (!entry.rolls.some((existing) => existing.id === roll.id)) entry.rolls.push(roll);
    }
  }

  return [...merged.values()]
    .map(({ temps, ...entry }) => {
      const oldest = entry.rolls
        .map((r) => r.loadedAt)
        .filter((d): d is string => d != null)
        .sort()[0];
      return {
        ...entry,
        recipe: entry.recipe
          ? { ...entry.recipe, temperatureC: temps.size === 1 ? [...temps][0] : null }
          : null,
        tiers: entry.tiers.sort((a, b) => TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(b)),
        oldestLoadedAt: oldest ?? null,
      };
    })
    // Biggest tank fill first; oldest backlog breaks the tie.
    .sort(
      (a, b) =>
        b.rolls.length - a.rolls.length ||
        (a.oldestLoadedAt ?? "9").localeCompare(b.oldestLoadedAt ?? "9"),
    );
}

function CandidateCard({ group }: { group: MergedGroup }) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-medium">{recipeLine(group.recipe)}</div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {group.tiers.map((tier) => (
            <TierBadge key={tier} tier={tier} />
          ))}
        </div>
      </div>
      <div className="text-xs text-muted-foreground">
        {group.rolls.length} roll{group.rolls.length === 1 ? "" : "s"}
        {group.oldestLoadedAt ? ` · oldest loaded ${shortDate(group.oldestLoadedAt)}` : ""}
      </div>
      <RollChips rolls={group.rolls} />
    </div>
  );
}

function LoadCard({ load }: { load: PlannedLoad }) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-medium">
          {load.tankName} <span className="text-muted-foreground">· {load.tankVolumeMl} ml</span>
        </div>
        <TierBadge tier={load.tier} />
      </div>
      <div className="text-sm">{recipeLine(load.recipe)}</div>
      <div className="text-xs text-muted-foreground">
        {load.usedUnits}/{load.capacityUnits} units
        {load.oldestLoadedAt ? ` · oldest loaded ${shortDate(load.oldestLoadedAt)}` : ""}
      </div>
      {load.mix && (
        <div className="text-xs">
          Mix: {load.mix.concentrateMl} ml {load.mix.developer} + {load.mix.waterMl} ml water ={" "}
          {load.mix.targetVolumeMl} ml
        </div>
      )}
      {/* The packer already folds the mix warnings into load.warnings; dedupe
          rather than print each one twice. */}
      <Warnings warnings={[...new Set([...load.warnings, ...(load.mix?.warnings ?? [])])]} />
      <RollChips rolls={load.rolls} />
    </div>
  );
}

/** Reel units and sheets the whole active fleet can hold in one round. */
function fleetTotals(fleet: Tank[]) {
  let reelUnits = 0;
  let sheets = 0;
  for (const t of fleet) {
    if (t.kind === "sheet") sheets += (t.sheetCapacity ?? 0) * t.quantity;
    else reelUnits += Number(t.reelUnits ?? 0) * t.quantity;
  }
  return { reelUnits, sheets };
}

function tankLabel(t: Tank): string {
  const capacity = t.kind === "sheet" ? `${t.sheetCapacity ?? 0} sheets` : `${Number(t.reelUnits ?? 0)} reels`;
  return `${t.name} (${capacity})${t.quantity > 1 ? ` ×${t.quantity}` : ""}`;
}

/** What one round can physically hold — the ceiling every plan is packed against. */
function FleetLine({ fleet }: { fleet: Tank[] }) {
  if (!fleet.length) return null;
  const { reelUnits, sheets } = fleetTotals(fleet);
  return (
    <p className="text-xs text-muted-foreground">
      <span className="text-foreground">
        Fleet: {reelUnits} reel units · {sheets} sheets
      </span>{" "}
      — {fleet.map(tankLabel).join(", ")}
    </p>
  );
}

function PlanSummary({
  plan,
  fleet,
  backlog,
}: {
  plan: TankPlan;
  fleet: Tank[];
  backlog: number;
}) {
  const planned = plan.loads.reduce((n, l) => n + l.rolls.length, 0);
  // Sheet loads count sheets, not reels — keep them out of the reel-unit tally.
  const sheetTankNames = new Set(fleet.filter((t) => t.kind === "sheet").map((t) => t.name));
  const usedReelUnits = plan.loads
    .filter((l) => !sheetTankNames.has(l.tankName))
    .reduce((n, l) => n + l.usedUnits, 0);
  const { reelUnits } = fleetTotals(fleet);
  // Rounds to clear at this rate — the number that turns a backlog into a plan
  // for the month rather than for tonight.
  const rounds = planned > 0 ? Math.ceil(backlog / planned) : null;

  return (
    <p className="text-xs text-muted-foreground">
      {planned} of {backlog} rolls · {plan.loads.length} tanks
      {reelUnits > 0 ? ` · ${usedReelUnits}/${reelUnits} reel units filled` : ""}
      {rounds ? ` · ~${rounds} round${rounds === 1 ? "" : "s"} to clear` : ""}
    </p>
  );
}

export function DevPage() {
  const [view, setView] = useState("candidates");
  const [maxTanks, setMaxTanks] = useState("");
  const [developer, setDeveloper] = useState("all");

  const candidatesQuery = useQuery({
    queryKey: ["dev-candidates"],
    queryFn: () => devSessions.candidates(),
  });

  const fleetQuery = useQuery({
    queryKey: ["tanks"],
    queryFn: () => tanks.list(),
  });

  const planMutation = useMutation({
    mutationFn: () =>
      tanks.plan({
        ...(maxTanks ? { maxTanks: Number(maxTanks) } : {}),
        ...(developer !== "all" ? { developer } : {}),
      }),
  });

  const groups = candidatesQuery.data?.data ?? [];
  // Only offer developers the backlog actually mentions — a filter that cannot
  // change anything is noise.
  const developers = [
    ...new Set(groups.map((g) => g.recipe?.developer).filter((d): d is string => !!d)),
  ].sort();
  const rollCount = groups.reduce((n, g) => n + g.rolls.length, 0);
  const plan = planMutation.data?.data;
  const fleet = fleetQuery.data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Develop</h2>
        {rollCount > 0 && (
          <span className="text-xs text-muted-foreground">{rollCount} rolls waiting</span>
        )}
      </div>

      <div className="flex gap-1.5">
        {VIEWS.map((v) => (
          <button
            key={v.value}
            onClick={() => setView(v.value)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              view === v.value
                ? "bg-primary text-primary-foreground"
                : "bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === "candidates" && (
        <CandidatesView query={candidatesQuery} groups={groups} />
      )}

      {view === "plan" && (
        <div className="space-y-3">
          <FleetLine fleet={fleet} />
          {/* Fields side by side, Plan on its own row: at phone width a third
              column squeezes both inputs to uselessness. */}
          <div className="space-y-2">
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <label className="text-[11px] text-muted-foreground">Max tanks</label>
                <Input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  placeholder="all"
                  value={maxTanks}
                  onChange={(e) => setMaxTanks(e.target.value)}
                />
              </div>
              <div className="flex-1 space-y-1">
                <label className="text-[11px] text-muted-foreground">Developer</label>
                <Select value={developer} onChange={(e) => setDeveloper(e.target.value)}>
                  <option value="all">Any</option>
                  {developers.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <Button
              className="w-full"
              onClick={() => planMutation.mutate()}
              disabled={planMutation.isPending}
            >
              <FlaskConical className="h-3.5 w-3.5" /> Plan
            </Button>
          </div>

          {planMutation.isPending && <p className="text-sm text-muted-foreground">Planning…</p>}

          {planMutation.isError && (
            <p className="text-sm text-amber-500">
              {(planMutation.error as Error).message}
              {/* The common failure is 409 "No tanks on file" — say where to fix it. */}
            </p>
          )}

          {plan && (
            <div className="space-y-3">
              <PlanSummary plan={plan} fleet={fleet} backlog={rollCount} />
              <Warnings warnings={plan.warnings} />
              {plan.loads.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Nothing could be packed with these constraints.
                </p>
              )}
              {plan.loads.map((load, i) => (
                <LoadCard key={`${load.tankName}-${i}`} load={load} />
              ))}
              <Remainder remainder={plan.remainder} />
            </div>
          )}

          {!plan && !planMutation.isPending && !planMutation.isError && (
            <p className="text-sm text-muted-foreground">
              Plan packs the backlog into concrete tank loads. Advisory only — nothing is written.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function CandidatesView({
  query,
  groups,
}: {
  query: ReturnType<typeof useQuery<{ data: CandidateGroup[] }>>;
  groups: CandidateGroup[];
}) {
  if (query.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (query.isError)
    return <p className="text-sm text-amber-500">{(query.error as Error).message}</p>;
  if (!groups.length)
    return <p className="text-sm text-muted-foreground">Nothing shot and waiting to develop.</p>;

  const merged = mergeGroups(groups);

  return (
    <div className="space-y-3">
      {merged.map((g) => (
        <CandidateCard key={g.key} group={g} />
      ))}
    </div>
  );
}

function Remainder({ remainder }: { remainder: { roll: CandidateRoll; reason: string }[] }) {
  const [open, setOpen] = useState(false);
  if (!remainder.length) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 text-sm font-medium"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        Not planned ({remainder.length})
      </button>
      {open && (
        <ul className="mt-2 space-y-1.5">
          {remainder.map(({ roll, reason }) => (
            <li key={roll.id} className="text-xs">
              <span className="text-foreground">{rollLabel(roll)}</span>
              <span className="text-muted-foreground"> — {reason}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
