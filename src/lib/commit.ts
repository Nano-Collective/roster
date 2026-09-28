import { execFileSync } from "node:child_process";

export interface Committed {
  committed: boolean;
  pushed: boolean;
  sha?: string;
  /** Why it stopped short, when it did. */
  note?: string;
}

/**
 * Commit exactly these paths and push, as whoever runs roster.
 *
 * Only the named paths, even when the repo has other changes in flight: a command that sweeps up
 * somebody's half-finished edit into a commit called "roster: ..." has done something nobody
 * asked for. A failed push leaves the commit in place and says so, because the work is done and
 * only the network is not.
 */
export function commitAndPush(repoDir: string, paths: string[], message: string): Committed {
  const git = (args: string[]) =>
    execFileSync("git", ["-C", repoDir, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  try {
    if (!git(["status", "--porcelain", "--", ...paths]).trim()) {
      return { committed: false, pushed: false, note: "nothing to commit" };
    }
    git(["add", "--", ...paths]);
    git(["commit", "-q", "-m", message, "--", ...paths]);
  } catch (err) {
    return { committed: false, pushed: false, note: short(err) };
  }
  const sha = git(["rev-parse", "--short", "HEAD"]).trim();
  try {
    git(["push", "-q"]);
  } catch (err) {
    return { committed: true, pushed: false, sha, note: short(err) };
  }
  return { committed: true, pushed: true, sha };
}

function short(e: unknown): string {
  const msg = e instanceof Error ? (e as any).stderr?.toString() || e.message : String(e);
  const line = msg.split("\n").find((l: string) => l.trim()) ?? msg;
  return line.length > 200 ? line.slice(0, 199) + "…" : line;
}
