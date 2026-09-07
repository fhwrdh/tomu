import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Creates the schema in the scratch database once per run, with the same
 * `drizzle-kit push` the deploy uses — so the tests exercise the real schema
 * rather than a hand-maintained copy that can drift.
 *
 * Non-interactive because the database starts empty: drizzle only asks
 * "created or renamed?" when an existing table could be the source of a rename.
 */
export async function setup() {
  const url =
    process.env.TEST_DATABASE_URL ?? "postgres://filmlog:filmlog@localhost:5432/filmlog_test";
  const cwd = fileURLToPath(new URL("..", import.meta.url));
  try {
    execFileSync("npx", ["drizzle-kit", "push", "--force"], {
      cwd,
      env: { ...process.env, DATABASE_URL: url },
      stdio: "pipe",
      // No TTY: if drizzle ever does want to prompt, fail loudly instead of hanging.
      input: "",
    });
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; message?: string };
    throw new Error(
      `Could not prepare the test database at ${url}.\n` +
        "Server tests need a reachable Postgres. Create it once with:\n" +
        '  psql "postgres://filmlog:filmlog@localhost:5432/postgres" -c "create database filmlog_test"\n' +
        `\n${e.stderr?.toString() || e.stdout?.toString() || e.message || ""}`,
    );
  }
}
