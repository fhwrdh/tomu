/**
 * The tier-2 model call, as a function of its inputs.
 *
 * Split out of `field-parse-model.ts` so it can run without a database: that module
 * owns the event row — loading it, merging, writing back, counting failures — while
 * this one only turns a transcript (plus gear, roll format, and optionally a photo)
 * into a `Tier2Result`. The eval harness in `evals/field-parse/` calls it directly, so
 * scoring the prompt needs a key and nothing else. Same reason `matching.ts` was split
 * out of the MCP server: a rule you want to measure has to be reachable on its own.
 *
 * The Anthropic client is a parameter rather than a module singleton, so the caller
 * decides where the key comes from (server config, or an eval's own environment).
 */
import type Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";
// `zodOutputFormat` requires a zod/v4 `ZodType`; the rest of the codebase uses the zod v3
// classic API (package.json pins zod ^3.25, which ships a `zod/v4` compat entry point), so
// this schema — local to the tier-2 SDK call — is built against `zod/v4` specifically.
import { z } from "zod/v4";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { PARSED_FIELD_NAMES, type GearIndex, type ParsedFieldName, type Tier2Result } from "@tomu/shared";

const Field = z.object({ value: z.string().nullable(), confidence: z.number().min(0).max(1) });
export const Tier2Output = z.object({
  shutterSpeed: Field, aperture: Field, compensation: Field, meteringMode: Field,
  lensId: Field, subject: Field, locationName: Field,
  cameraId: z.string().nullable(),
  remarks: z.string().nullable(),
  sceneDescription: z.string().nullable(),
  reviewReason: z.string().nullable(),
});

export interface Tier2Request {
  transcript: string;
  gear: GearIndex;
  /** Roll format ("35mm", "4x5", …) when the event is on a roll; shapes sheet/frame reading. */
  rollFormat?: string | null;
  /** What tier 1 (or a hand edit) already put on the event; the model is told to keep these. */
  current: Partial<Record<ParsedFieldName, string | null>>;
  /** A nearby field photo, base64 jpeg, for the scene description. */
  imageBase64?: string | null;
}

let promptCache: string | null = null;
/** The tier-2 system prompt, as committed in `field-parse-prompt.md`. */
export async function tier2Prompt(): Promise<string> {
  if (!promptCache) promptCache = await readFile(new URL("./field-parse-prompt.md", import.meta.url), "utf8");
  return promptCache;
}

/** The gear list, roll format and already-parsed fields the prompt is given alongside the note. */
export function buildTier2Context(req: Tier2Request): string {
  return [
    `Cameras: ${req.gear.cameras.map((c) => `${c.id} = ${c.label}`).join("; ") || "none"}`,
    `Lenses: ${req.gear.lenses.map((l) => `${l.id} = ${l.label}`).join("; ") || "none"}`,
    `Roll format: ${req.rollFormat ?? "unknown"}`,
    `Already parsed (keep unless the note clearly says otherwise): ${PARSED_FIELD_NAMES.map((k) => `${k}=${req.current[k] ?? "null"}`).join(", ")}`,
  ].join("\n");
}

/**
 * One tier-2 call. Throws on an API failure or missing structured output — the caller
 * decides what a failure means for the event (see `parseEventWithModel`).
 */
export async function requestTier2(client: Anthropic, model: string, req: Tier2Request): Promise<Tier2Result> {
  const userContent: Anthropic.MessageParam["content"] = [];
  if (req.imageBase64) {
    userContent.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: req.imageBase64 } });
  }
  userContent.push({ type: "text", text: `${buildTier2Context(req)}\n\nTranscript:\n"""\n${req.transcript}\n"""` });

  const res = await client.messages.parse({
    model,
    max_tokens: 2000,
    // No cache_control: the prompt is ~260 tokens, far below the minimum cacheable
    // prefix (2048 for Haiku, 1024 for Sonnet/Opus), so a cache breakpoint here is
    // silently ignored. Add one back if the prompt grows past that.
    system: [{ type: "text", text: await tier2Prompt() }],
    messages: [{ role: "user", content: userContent }],
    output_config: { format: zodOutputFormat(Tier2Output) },
  });
  const out = res.parsed_output;
  if (!out) throw new Error("tier-2 parse returned no structured output");

  const result: Tier2Result = {
    fields: Object.fromEntries(PARSED_FIELD_NAMES.map((k) => [k, out[k].value])) as Tier2Result["fields"],
    confidence: Object.fromEntries(PARSED_FIELD_NAMES.map((k) => [k, out[k].confidence])) as Tier2Result["confidence"],
    cameraId: out.cameraId,
    remarks: out.remarks ?? undefined,
    sceneDescription: out.sceneDescription ?? undefined,
    reviewReason: out.reviewReason,
  };
  // lensId must be a real lens of this user; drop hallucinated ids.
  if (result.fields.lensId && !req.gear.lenses.some((l) => l.id === result.fields.lensId)) {
    result.fields.lensId = null;
  }
  return result;
}
