import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface GhResult<T> {
  ok: boolean;
  data?: T;
  /** The message GitHub gave, trimmed to something a person can act on. */
  error?: string;
  status?: number;
}

/**
 * Everything goes through the human's own `gh`, exactly as the portal does: no token is held
 * here, and what a check can see is what the person running it can see.
 *
 * Failures are values rather than exceptions. A doctor that stops at the first missing repo is
 * useless — the whole point is one pass that finds everything wrong at once.
 */
export async function ghJson<T = unknown>(args: string[]): Promise<GhResult<T>> {
  try {
    const { stdout } = await run("gh", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    return { ok: true, data: stdout.trim() ? (JSON.parse(stdout) as T) : (undefined as T) };
  } catch (err) {
    const e = err as { stderr?: string; message?: string; code?: number };
    const raw = String(e.stderr ?? e.message ?? "").trim();
    return { ok: false, error: tidy(raw), status: httpStatus(raw) };
  }
}

/** `gh api` with the repo path already assembled, since that is most of what doctor does. */
export function api<T = unknown>(path: string, extra: string[] = []): Promise<GhResult<T>> {
  return ghJson<T>(["api", path, ...extra]);
}

/** A GraphQL query. `-f` pairs are passed as name=value. */
export function graphql<T = unknown>(query: string, vars: Record<string, string>): Promise<GhResult<T>> {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [k, v] of Object.entries(vars)) args.push("-F", `${k}=${v}`);
  return ghJson<T>(args);
}

function httpStatus(stderr: string): number | undefined {
  const m = /HTTP (\d{3})/.exec(stderr);
  return m ? Number(m[1]) : undefined;
}

/** gh prints the request, the status and a docs link; only the message is worth showing. */
function tidy(stderr: string): string {
  const msg = /"message"\s*:\s*"([^"]+)"/.exec(stderr);
  if (msg) return msg[1]!;
  const first = stderr.split("\n").map((l) => l.trim()).filter(Boolean)[0] ?? "unknown error";
  return first.replace(/^gh:\s*/, "").slice(0, 160);
}

export async function ghReady(): Promise<GhResult<{ login: string }>> {
  const who = await ghJson<{ login: string }>(["api", "user", "--jq", "{login: .login}"]);
  if (who.ok) return who;
  return {
    ok: false,
    error: /not found|ENOENT/i.test(who.error ?? "")
      ? "gh is not installed, or not on PATH"
      : `gh is not authenticated (${who.error}). Run: gh auth login`,
  };
}
