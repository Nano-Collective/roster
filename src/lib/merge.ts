import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface MergeResult {
  /** The merged file. Carries diff3 conflict markers when `conflicts` is non-zero. */
  text: string;
  conflicts: number;
}

/**
 * A three-way merge, done by `git merge-file`.
 *
 * Not hand-rolled on purpose. Merging is a solved problem with a lot of edge cases, git is
 * already a hard dependency of everything else here, and its conflict markers are the ones
 * every editor and every human already knows how to read.
 *
 * `--diff3` keeps the original text in the conflict block. For these files — a guardrail, a
 * house-style rule — seeing what the framework used to say is most of what tells you whether
 * your version still wants to disagree with it.
 */
export function merge3(current: string, base: string, incoming: string): MergeResult {
  const dir = mkdtempSync(join(tmpdir(), "roster-merge-"));
  try {
    const c = join(dir, "current");
    const b = join(dir, "base");
    const i = join(dir, "incoming");
    writeFileSync(c, current);
    writeFileSync(b, base);
    writeFileSync(i, incoming);

    try {
      const text = execFileSync(
        "git",
        ["merge-file", "-p", "--diff3", "-L", "yours", "-L", "the version you started from",
         "-L", "the framework's", c, b, i],
        { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
      );
      return { text, conflicts: 0 };
    } catch (err) {
      // git merge-file exits with the number of conflicts, so a non-zero exit is the normal
      // outcome rather than a failure. A negative status is the real error.
      const e = err as { status?: number; stdout?: string };
      if (typeof e.status === "number" && e.status > 0 && typeof e.stdout === "string") {
        return { text: e.stdout, conflicts: e.status };
      }
      throw new Error(`git merge-file failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
