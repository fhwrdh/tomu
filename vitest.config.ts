import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // Tier 1 scope: the pure domain logic, including the MCP fuzzy-matching
      // rules that decide which stock/lot a loose name resolves to. (Tier 2 —
      // API/MCP integration — will widen this to the server + mcp mutation paths.)
      include: [
        "packages/shared/src/dilution.ts",
        "packages/shared/src/dev-id.ts",
        "packages/shared/src/dev-shorthand.ts",
        "packages/shared/src/photo-match.ts",
        "packages/shared/src/field-parse.ts",
        "packages/shared/src/field-merge.ts",
        "packages/shared/src/frame-numbering.ts",
        "packages/shared/src/field-event.ts",
        "packages/mcp/src/matching.ts",
      ],
      reporter: ["text", "text-summary"],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
