import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface SyncResult {
  dir: string;
  behind: number;
  ahead: number;
  dirty: boolean;
  pulled: boolean;
  /** Set when we deliberately did not pull, so the reason is visible rather than silent. */
  skipped?: "dirty" | "diverged" | "no-remote";
  error?: string;
}

/**
 * Bring the local checkouts level with their remotes.
 *
 * The portal reads the working tree, so a run that has landed on GitHub is invisible here
 * until someone pulls. That is what made the newest diffs look days old.
 *
 * Deliberately conservative: fetch always, pull only when the tree is clean and the pull is
 * a fast-forward. Anything else reports why it stopped rather than touching work in flight.
 */
export async function syncRepos(root: string, dirs: string[]): Promise<SyncResult[]> {
  return Promise.all(dirs.map((dir) => syncOne(join(root, dir), dir)));
}

async function syncOne(path: string, dir: string): Promise<SyncResult> {
  const base: SyncResult = { dir, behind: 0, ahead: 0, dirty: false, pulled: false };
  if (!existsSync(join(path, ".git"))) return { ...base, skipped: "no-remote" };

  const git = async (...args: string[]) =>
    (await run("git", ["-C", path, ...args], { encoding: "utf8" })).stdout.trim();

  try {
    const remotes = await git("remote");
    if (!remotes) return { ...base, skipped: "no-remote" };

    await git("fetch", "--quiet", "--prune");

    const branch = await git("rev-parse", "--abbrev-ref", "HEAD");
    let counts: string;
    try {
      counts = await git("rev-list", "--left-right", "--count", `HEAD...origin/${branch}`);
    } catch {
      return { ...base, skipped: "no-remote" };
    }
    const [aheadStr, behindStr] = counts.split(/\s+/);
    const ahead = Number(aheadStr ?? 0);
    const behind = Number(behindStr ?? 0);
    const dirty = (await git("status", "--porcelain")).length > 0;

    if (behind === 0) return { ...base, ahead, behind, dirty };
    if (dirty) return { ...base, ahead, behind, dirty, skipped: "dirty" };
    if (ahead > 0) return { ...base, ahead, behind, dirty, skipped: "diverged" };

    await git("pull", "--ff-only", "--quiet");
    /* Level now, so say so. Reporting the count from before the pull is what made the portal
       tell you a repo it had just brought up to date was "still 1 behind", every time. */
    return { ...base, ahead, behind: 0, dirty, pulled: true };
  } catch (err) {
    return { ...base, error: firstLine(err) };
  }
}

function firstLine(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const line = msg.split("\n").find((l) => l.trim()) ?? msg;
  return line.length > 180 ? line.slice(0, 179) + "…" : line;
}
