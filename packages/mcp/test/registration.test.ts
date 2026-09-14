import { describe, expect, it } from "vitest";
import { useTomu } from "./support/tomu-client.js";

const tomu = useTomu();

// The tool surface a model sees. Adding, removing, or renaming a tool changes what
// every connected Claude session can do, so it should be a deliberate edit to this
// list in the same commit — never a side effect of moving code around.
const TOOLS = [
  "tomu_add_inventory",
  "tomu_capture",
  "tomu_correct_roll",
  "tomu_delete_event",
  "tomu_delete_inventory",
  "tomu_dev_candidates",
  "tomu_dev_session",
  "tomu_dilution",
  "tomu_edit_event",
  "tomu_edit_inventory",
  "tomu_field_events",
  "tomu_gear",
  "tomu_inventory",
  "tomu_load",
  "tomu_log_shot_roll",
  "tomu_note",
  "tomu_pin_event",
  "tomu_reparse_events",
  "tomu_roll_level_event",
  "tomu_rolls",
  "tomu_set_stock_aliases",
  "tomu_shoot",
  "tomu_summary",
  "tomu_tank_plan",
  "tomu_tanks",
  "tomu_undo_load",
  "tomu_unload",
];

// Parameters that reach the model with no description, leaving it only the name
// to go on. This list may shrink but never grow: describe every new parameter,
// and delete an entry here when you describe an old one.
const KNOWN_UNDESCRIBED: Record<string, string[]> = {
  tomu_edit_event: ["roll", "frameNumber", "sheetId", "shutterSpeed", "aperture", "compensation", "meteringMode", "subject", "locationName", "remarks"],
  tomu_pin_event: ["pins", "roll"],
  tomu_reparse_events: ["roll"],
  tomu_roll_level_event: ["event"],
  tomu_tanks: ["agitation", "notes"],
};

describe("the tool surface", () => {
  it("registers exactly the expected tools", async () => {
    const { tools } = await tomu.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS);
  });

  it("describes every tool", async () => {
    const { tools } = await tomu.listTools();
    const bare = tools.filter((t) => !t.description?.trim()).map((t) => t.name);
    expect(bare).toEqual([]);
  });

  it("describes every parameter, apart from the known gaps", async () => {
    const { tools } = await tomu.listTools();
    const undescribed: Record<string, string[]> = {};
    for (const tool of tools) {
      const properties = (tool.inputSchema.properties ?? {}) as Record<string, { description?: string }>;
      const missing = Object.entries(properties)
        .filter(([, schema]) => !schema.description)
        .map(([name]) => name);
      if (missing.length) undescribed[tool.name] = missing;
    }
    expect(undescribed).toEqual(KNOWN_UNDESCRIBED);
  });
});
