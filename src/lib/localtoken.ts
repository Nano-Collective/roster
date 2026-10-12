import { execFile } from "node:child_process";
import { type GitHub, githubClient } from "./github.js";

/**
 * The GitHub client on your own machine: your token, so it acts as you.
 *
 * `GITHUB_TOKEN` or `GH_TOKEN` if one is set, otherwise the one `gh auth token` prints. Asking
 * `gh` for it once is the whole of roster's use of the token here: it is held in memory for the
 * life of the process, never written anywhere, and is exactly what `gh` itself would have sent.
 */
let pending: Promise<LocalGitHub> | null = null;

export type LocalGitHub = { ok: true; gh: GitHub; token: string } | { ok: false; error: string };

export function localGitHub(): Promise<LocalGitHub> {
  pending ??= find();
  return pending;
}

async function find(): Promise<LocalGitHub> {
  const env = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (env) return { ok: true, gh: githubClient(env), token: env };
  const token = await new Promise<string>((resolve) =>
    execFile("gh", ["auth", "token"], { encoding: "utf8" }, (err, out) =>
      resolve(err ? "" : out.trim()),
    ),
  );
  if (!token) {
    // Asked again next time: signing in to gh while the portal is up should just work.
    pending = null;
    return {
      ok: false,
      error: "No GitHub token. Run `gh auth login`, or set GITHUB_TOKEN, and try again.",
    };
  }
  return { ok: true, gh: githubClient(token), token };
}
