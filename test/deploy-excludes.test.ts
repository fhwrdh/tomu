/**
 * Both deploy paths rsync with `--delete`: `scripts/deploy.sh` (run by hand) and
 * `.github/workflows/deploy.yml` (runs on every merge to main). Anything holding live
 * data on the droplet must therefore be excluded in BOTH, and the two lists have no
 * mechanical relationship — they are hand-maintained copies of one rule.
 *
 * They diverged once. `deploy.sh` excluded `uploads`; the workflow, written later, did
 * not, so every merge deleted the field-capture photos on the droplet. A photo uploaded
 * at 02:22 on 2026-09-08 was gone by the next deploy, and the client had already dropped
 * its local copy — the image was lost for good (fix: cb82240).
 *
 * Nothing checked that the two lists agreed. This does.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoFile = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), "utf8");

/** Every `--exclude '<pattern>'` in a shell/YAML rsync invocation, in file order. */
function rsyncExcludes(source: string): string[] {
  return [...source.matchAll(/--exclude\s+'([^']+)'/g)].map((m) => m[1]);
}

/**
 * Directories that hold live data on the droplet — data that exists only there and
 * cannot be recovered from the repo. Excluding these is the whole point of the lists.
 */
const MUST_EXCLUDE = [
  "uploads", // field-capture photos: the 2026-09-08 loss
  ".env", // droplet secrets, including DATABASE_URL and ANTHROPIC_API_KEY
  "db-backups", // nightly pg_dump output
];

const SCRIPT = "scripts/deploy.sh";
const WORKFLOW = ".github/workflows/deploy.yml";

describe("deploy rsync exclude lists", () => {
  const script = rsyncExcludes(repoFile(SCRIPT));
  const workflow = rsyncExcludes(repoFile(WORKFLOW));

  it("are both actually found (the regex still matches the files)", () => {
    // Guards against the test silently passing because a refactor changed the
    // quoting style and both lists parsed as empty.
    expect(script.length).toBeGreaterThan(5);
    expect(workflow.length).toBeGreaterThan(5);
  });

  it("agree, as sets", () => {
    const onlyInScript = script.filter((x) => !workflow.includes(x)).sort();
    const onlyInWorkflow = workflow.filter((x) => !script.includes(x)).sort();
    expect(
      { onlyInScript, onlyInWorkflow },
      `${SCRIPT} and ${WORKFLOW} both rsync --delete, so their exclude lists must match. ` +
        `Add the missing patterns to whichever file lacks them.`,
    ).toEqual({ onlyInScript: [], onlyInWorkflow: [] });
  });

  it.each(MUST_EXCLUDE)("exclude %s in both files", (pattern) => {
    expect(script, `${SCRIPT} must exclude '${pattern}' — rsync --delete would destroy it`).toContain(pattern);
    expect(workflow, `${WORKFLOW} must exclude '${pattern}' — rsync --delete would destroy it`).toContain(pattern);
  });

  it("are each free of duplicates", () => {
    expect(new Set(script).size).toBe(script.length);
    expect(new Set(workflow).size).toBe(workflow.length);
  });
});
