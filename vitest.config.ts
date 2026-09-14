import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const sharedAlias = {
  // Tests import @tomu/shared transitively, whose package entry points at dist/.
  // Resolve it to source so the suite runs on a fresh `npm ci` without a build
  // step, and always tests the code in the tree.
  "@tomu/shared": fileURLToPath(new URL("./packages/shared/src/index.ts", import.meta.url)),
};

export default defineConfig({
  resolve: { alias: sharedAlias },
  test: {
    // Two environments, so they are split into projects: the client's sync
    // worker listens for `online` and `visibilitychange` and needs a DOM, while
    // the server tests talk to Postgres and must stay in node. (Vitest 4 ignores
    // the per-file `@vitest-environment` docblock, so this has to be config.)
    projects: [
      {
        resolve: { alias: sharedAlias },
        test: {
          name: "node",
          include: ["packages/{shared,server,mcp}/test/**/*.test.ts"],
          environment: "node",
          // Server tests hit a real Postgres (see packages/server/test/setup.ts);
          // the setup file must load before anything imports src/config.ts, which
          // reads process.env once at import time.
          setupFiles: ["packages/server/test/setup.ts"],
          // The route tests share one scratch database, so files cannot run in parallel.
          fileParallelism: false,
        },
      },
      {
        resolve: { alias: sharedAlias },
        test: {
          // Repo-level invariants: rules that live in more than one file and have no
          // mechanical link between the copies (the two deploy exclude lists). Its own
          // project because it needs neither the DOM nor the server's Postgres setup.
          name: "repo",
          include: ["test/**/*.test.ts", "evals/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        resolve: { alias: sharedAlias },
        test: {
          name: "client",
          // Node, not jsdom: fake-indexeddb cannot structured-clone a jsdom Blob
          // (it round-trips to `{}`), and the capture store puts photo Blobs in
          // IndexedDB. Node's Blob clones faithfully.
          include: ["packages/client/test/**/*.test.ts"],
          exclude: ["packages/client/test/**/*.dom.test.{ts,tsx}"],
          environment: "node",
        },
      },
      {
        resolve: { alias: sharedAlias },
        test: {
          name: "client-dom",
          // The screens, and the sync worker (which listens for `online` and
          // `visibilitychange`).
          include: ["packages/client/test/**/*.dom.test.{ts,tsx}"],
          environment: "jsdom",
          setupFiles: ["packages/client/test/dom-setup.ts"],
        },
      },
    ],
    globalSetup: ["packages/server/test/global-setup.ts"],
    coverage: {
      provider: "v8",
      // Gate scope: the pure domain logic, including the MCP fuzzy-matching rules
      // that decide which stock/lot a loose name resolves to, plus the offline
      // capture store and sync worker — the parts that hold a note nobody can
      // re-take. The server's field-event routes and tier-2 service have tests
      // too, but sit outside the threshold until the photo/multipart paths are
      // covered.
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
        "packages/client/src/offline/store.ts",
        "packages/client/src/offline/sync.ts",
      ],
      reporter: ["text", "text-summary"],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
