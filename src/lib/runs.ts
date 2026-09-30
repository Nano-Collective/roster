import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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

/** The runs of one staff member's two callers over the last `days`, newest first. */
export async function staffRuns(
  brain: string,
  handle: string,
  days = 30,
): Promise<{ runs: RunRow[]; errors: string[] }> {
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const lists = await Promise.all(
    KINDS.map((kind) =>
      ghJson<Array<Record<string, any>>>([
        "run",
        "list",
        "--repo",
        brain,
        "--workflow",
        `${handle}-${kind}.yaml`,
        "--created",
        `>=${since}`,
        "--limit",
        // Skipped mentions (the gate saying no) count towards the limit, and there are hundreds.
        kind === "mention" ? "500" : "100",
        "--json",
        "databaseId,conclusion,status,createdAt,updatedAt,url",
      ]).then((res) => ({ kind, res })),
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

  await pool(
    rows.filter((r) => r.status === "completed"),
    6,
    async (row) => {
      row.record = await recordFor(brain, row.id);
    },
  );
  return { runs: rows, errors };
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
    // an answer, so it is kept like one.
    const record =
      res.ok && existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as RunRecord) : null;
    records.set(key, record);
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
