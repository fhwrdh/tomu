import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Server tests import @tomu/shared transitively, whose package entry points
      // at dist/. Resolve it to source so the suite runs on a fresh `npm ci`
      // without a build step, and always tests the code in the tree.
      "@tomu/shared": fileURLToPath(new URL("./packages/shared/src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["packages/**/test/**/*.test.ts"],
    // Server tests hit a real Postgres (see packages/server/test/setup.ts); the
    // setup file must load before anything imports src/config.ts, which reads
    // process.env once at import time.
    setupFiles: ["packages/server/test/setup.ts"],
    globalSetup: ["packages/server/test/global-setup.ts"],
    // The route tests share one scratch database, so files cannot run in parallel.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      // Gate scope: the pure domain logic, including the MCP fuzzy-matching rules
      // that decide which stock/lot a loose name resolves to. The server's
      // field-event routes and tier-2 service have tests too (packages/server/test),
      // but sit outside the threshold until the photo/multipart paths are covered.
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
