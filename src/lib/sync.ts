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
    return { ...base, error: reason(err) };
  }
}

/**
 * Why it stopped, rather than what was run.
 *
 * `execFile` builds its message as "Command failed: <the whole command line>" and puts git's
 * own words on the lines below it. Taking the first line therefore read the command back to
 * you and dropped the reason — so every sync failure in the portal said
 * "Command failed: git -C /…/cto fetch --quiet --prune" and nothing about authentication, the
 * network, or a lock, which is the only part anyone can act on.
 *
 * git writes the reason to stderr, so that is preferred; the message is the fallback, minus
 * the boilerplate line.
 */
export function reason(e: unknown): string {
  const err = e as { stderr?: unknown; message?: unknown };
  const text = String(err?.stderr ?? "").trim() || String(err?.message ?? e);
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  // `fatal:`/`error:` are git's own prefixes and are kept: they are the sentence, not noise.
  const line = lines.find((l) => !/^Command failed:/i.test(l)) ?? lines[0] ?? String(e);
  return line.length > 180 ? line.slice(0, 179) + "…" : line;
}
