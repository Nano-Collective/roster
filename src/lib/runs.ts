import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { ghJson } from "./gh.js";

/**
 * What each staff member's runs were and what they cost, read back from GitHub.
 *
 * The runs themselves come from the run list, so when, outcome and duration are known for every
 * one, including runs older than the record. Turns and cost come from the `roster-run` artifact
 * session.yaml leaves behind, which is one download per run. A finished run never changes, so
 * each is fetched once per process and kept.
 */

/** What session.yaml's run-record.mjs writes. Anything it could not know is null. */
export interface RunRecord {
  outcome?: string;
  duration_s?: number | null;
  turns?: number | null;
  cost_usd?: number | null;
  tokens?: Record<string, number | null> | null;
  model?: string | null;
  agent?: string | null;
}

export interface RunRow {
  id: number;
  kind: string;
  url: string;
  createdAt: string;
  status: string;
  conclusion: string | null;
  minutes: number;
  record: RunRecord | null;
}

export interface Spend {
  usd: number;
  /** Runs in the window whose cost is known, out of `runs`. */
  known: number;
  runs: number;
}

const KINDS = ["daily", "mention"] as const;
const records = new Map<string, RunRecord | null>();
/** Records being fetched in the background, so a second request does not fetch them again. */
const fetching = new Set<string>();

/**
 * Where run records are kept between portal starts. A finished run's record never changes, so
 * each one is downloaded once, ever, rather than once per start: thirty days of runs was a
 * minute of `gh run download` every time the Runs screen opened.
 */
function cacheDir(): string {
  return process.env.ROSTER_CACHE_DIR ?? join(homedir(), ".cache", "roster", "runs");
}

function cacheFile(brain: string, id: number): string {
  return join(cacheDir(), brain.replace("/", "__"), `${id}.json`);
}

/** What is already known about a run's record, without asking GitHub. undefined when nothing is. */
function knownRecord(brain: string, id: number): RunRecord | null | undefined {
  const key = `${brain}#${id}`;
  if (records.has(key)) return records.get(key);
  const file = cacheFile(brain, id);
  if (!existsSync(file)) return undefined;
  try {
    const record = (JSON.parse(readFileSync(file, "utf8")) as { record: RunRecord | null }).record;
    records.set(key, record);
    return record;
  } catch {
    return undefined;
  }
}

/**
 * The runs of one staff member's two callers over the last `days`, newest first.
 *
 * With `wait: false` it answers at once with the records already known, and fetches the rest in
 * the background; `pending` says how many are still coming, so a screen can ask again.
 */
export async function staffRuns(
  brain: string,
  handle: string,
  days = 30,
  opts: { wait?: boolean } = {},
): Promise<{ runs: RunRow[]; errors: string[]; pending: number }> {
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const lists = await Promise.all(
    KINDS.map((kind) =>
      realRuns(brain, `${handle}-${kind}.yaml`, since).then((res) => ({ kind, res })),
    ),
  );

  const errors: string[] = [];
  const rows: RunRow[] = [];
  for (const { kind, res } of lists) {
    if (!res.ok) {
      errors.push(`${brain} ${kind}: ${res.error}`);
      continue;
    }
    for (const r of res.data ?? []) {
      // A skipped run is the mention gate doing its job; there is no run to show.
      if (r.conclusion === "skipped") continue;
      rows.push({
        id: Number(r.databaseId),
        kind,
        url: String(r.url ?? ""),
        createdAt: String(r.createdAt ?? ""),
        status: String(r.status ?? ""),
        conclusion: r.conclusion || null,
        minutes: Math.max(
          0,
          (new Date(r.updatedAt).getTime() - new Date(r.createdAt).getTime()) / 60000,
        ),
        record: null,
      });
    }
  }
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const missing: RunRow[] = [];
  for (const row of rows.filter((r) => r.status === "completed")) {
    const known = knownRecord(brain, row.id);
    if (known === undefined) missing.push(row);
    else row.record = known;
  }

  if (opts.wait === false) {
    const todo = missing.filter((r) => !fetching.has(`${brain}#${r.id}`));
    for (const r of todo) fetching.add(`${brain}#${r.id}`);
    void pool(todo, 6, async (row) => {
      await recordFor(brain, row.id);
      fetching.delete(`${brain}#${row.id}`);
    });
    return { runs: rows, errors, pending: missing.length };
  }

  await pool(missing, 6, async (row) => {
    row.record = await recordFor(brain, row.id);
  });
  return { runs: rows, errors, pending: 0 };
}

/**
 * Every run of one workflow since a date that actually ran, newest first.
 *
 * Asked for one outcome at a time, all at once, rather than as one list. A mention caller fires
 * on every comment and most of those runs are skipped: a month on Pip was 248 runs, about 50 of
 * them real, and paging through all 248 took eight seconds where this takes two.
 */
const OUTCOMES = [
  "success",
  "failure",
  "cancelled",
  "timed_out",
  "action_required",
  "startup_failure",
  "in_progress",
  "queued",
] as const;

async function realRuns(
  brain: string,
  workflow: string,
  since: string,
): Promise<{ ok: boolean; data?: Array<Record<string, any>>; error?: string }> {
  const one = async (status: string) => {
    const out: Array<Record<string, any>> = [];
    for (let page = 1; page <= 10; page++) {
      const res = await ghJson<{ workflow_runs: Array<Record<string, any>> }>([
        "api",
        `repos/${brain}/actions/workflows/${workflow}/runs?created=>=${since}&status=${status}&per_page=100&page=${page}`,
      ]);
      if (!res.ok) return { ok: false as const, error: res.error };
      const runs = res.data?.workflow_runs ?? [];
      out.push(...runs);
      if (runs.length < 100) break;
    }
    return { ok: true as const, runs: out };
  };
  const answers = await Promise.all(OUTCOMES.map(one));
  const failed = answers.find((a) => !a.ok);
  if (failed && !failed.ok) return { ok: false, error: failed.error };
  const seen = new Set<number>();
  const data: Array<Record<string, any>> = [];
  for (const a of answers) {
    for (const r of a.ok ? a.runs : []) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      data.push({
        databaseId: r.id,
        conclusion: r.conclusion,
        status: r.status,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        url: r.html_url,
      });
    }
  }
  return { ok: true, data };
}

async function recordFor(brain: string, id: number): Promise<RunRecord | null> {
  const key = `${brain}#${id}`;
  if (records.has(key)) return records.get(key)!;
  const dir = mkdtempSync(join(tmpdir(), "roster-run-"));
  try {
    const res = await ghJson([
      "run",
      "download",
      String(id),
      "--repo",
      brain,
      "--name",
      "roster-run",
      "--dir",
      dir,
    ]);
    const file = join(dir, "run.json");
    // A run from before records existed, or one whose artifact has expired, has none. That is
    // an answer, so it is kept like one. A failure that is not that (the network, the API
    // limit) is kept for this session only, so the next start asks again.
    const record =
      res.ok && existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as RunRecord) : null;
    records.set(key, record);
    if (res.ok || /no valid artifacts|not found|no artifact/i.test(res.error ?? "")) {
      try {
        mkdirSync(join(cacheDir(), brain.replace("/", "__")), { recursive: true });
        writeFileSync(cacheFile(brain, id), JSON.stringify({ record }));
      } catch {
        // A cache that cannot be written costs a download next time, nothing more.
      }
    }
    return record;
  } catch {
    records.set(key, null);
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function pool<T>(items: T[], size: number, work: (item: T) => Promise<void>) {
  let next = 0;
  const lanes = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await work(items[next++]!);
  });
  await Promise.all(lanes);
}

/** What the runs inside the trailing window cost, as far as anybody knows. */
export function spend(rows: RunRow[], days = 30, now = Date.now()): Spend {
  const from = now - days * 86400_000;
  const inside = rows.filter((r) => new Date(r.createdAt).getTime() >= from);
  const costed = inside.filter((r) => typeof r.record?.cost_usd === "number");
  return {
    usd: Math.round(costed.reduce((sum, r) => sum + r.record!.cost_usd!, 0) * 100) / 100,
    known: costed.length,
    runs: inside.length,
  };
}

/**
 * A budget from org.yaml, in USD over any trailing 30 days, or null for none.
 *
 * Written as a bare number, on the org or on one staff entry. Anything else is treated as no
 * budget rather than guessed at: a warning built on a misread number is one people learn to
 * ignore.
 */
export function budgetOf(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value.replace(/^\$/, "")) : value;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}
