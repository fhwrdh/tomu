import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // Tier 1 scope: the pure domain logic. (Tier 2 — API/MCP integration —
      // will widen this to the server + mcp mutation paths.)
      include: [
        "packages/shared/src/dilution.ts",
        "packages/shared/src/dev-id.ts",
        "packages/shared/src/dev-shorthand.ts",
      ],
      reporter: ["text", "text-summary"],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
