import type { GitHub } from "./github.js";

/**
 * What each staff member is doing right now, for Home's "Working now".
 *
 * One run list per brain, conditional, so a poll that finds nothing new is free. The callers name every run by what started it (`cto peer #12`,
 * `cto follow-on`), so the list alone says who is running, why, and on which issue. Runs from
 * before the callers carried a name fall back to the workflow's, and say less.
 */

export type Trigger = "daily" | "manual" | "follow-on" | "mention" | "peer" | "ignored" | "unknown";

export interface LiveRun {
  id: number;
  trigger: Trigger;
  /** The issue on their tracker that started it, for a mention or a peer's ask. */
  issue: number | null;
  status: string;
  conclusion: string | null;
  createdAt: string;
  updatedAt: string;
  url: string;
}

export interface LiveStaff {
  handle: string;
  brain: string;
  /** Queued or in progress, oldest first. */
  running: LiveRun[];
  /** Finished in the last few hours, newest first. */
  finished: LiveRun[];
  /** Peer and follow-on runs today (UTC) that ran, against max_runs_per_day. */
  automatic: number;
  limit: number;
  error?: string;
}

const FINISHED_HOURS = 6;

interface RawRun {
  databaseId: number;
  displayTitle?: string;
  workflowName?: string;
  status?: string;
  conclusion?: string | null;
  createdAt?: string;
  updatedAt?: string;
  url?: string;
}

/** A run's trigger and issue, from the name its caller gave it. */
export function parseTitle(
  handle: string,
  title: string,
  workflow = "",
): {
  trigger: Trigger;
  issue: number | null;
} {
  const m = new RegExp(
    `^${handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} (daily|manual|follow-on|mention|peer|ignored)(?: #(\\d+))?\\s*$`,
  ).exec(title.trim());
  if (m) return { trigger: m[1] as Trigger, issue: m[2] ? Number(m[2]) : null };
  // Before the callers named their runs: the workflow name is all there is.
  if (/daily/i.test(workflow)) return { trigger: "daily", issue: null };
  if (/mention/i.test(workflow)) return { trigger: "mention", issue: null };
  return { trigger: "unknown", issue: null };
}

/** Sorted into running and recently finished, with today's automatic count. Pure, for tests. */
export function shapeLive(
  handle: string,
  brain: string,
  raw: RawRun[],
  limit: number,
  now = Date.now(),
): LiveStaff {
  const today = new Date(now).toISOString().slice(0, 10);
  const since = now - FINISHED_HOURS * 3_600_000;
  const out: LiveStaff = { handle, brain, running: [], finished: [], automatic: 0, limit };

  for (const r of raw) {
    // A skipped run is a caller whose condition said no. Nothing ran. An `ignored` one is the
    // same, named before GitHub has got round to skipping it.
    if (r.conclusion === "skipped") continue;
    const { trigger, issue } = parseTitle(handle, r.displayTitle ?? "", r.workflowName ?? "");
    if (trigger === "ignored") continue;
    const run: LiveRun = {
      id: Number(r.databaseId),
      trigger,
      issue,
      status: String(r.status ?? ""),
      conclusion: r.conclusion ?? null,
      createdAt: String(r.createdAt ?? ""),
      updatedAt: String(r.updatedAt ?? r.createdAt ?? ""),
      url: String(r.url ?? ""),
    };
    if ((trigger === "peer" || trigger === "follow-on") && run.createdAt.slice(0, 10) === today) {
      out.automatic++;
    }
    if (run.status !== "completed") out.running.push(run);
    else if (new Date(run.updatedAt).getTime() >= since) out.finished.push(run);
  }
  out.running.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  out.finished.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return out;
}

export async function liveFor(
  gh: GitHub,
  staff: Array<{ handle: string; brain: string; limit: number }>,
): Promise<LiveStaff[]> {
  return Promise.all(
    staff.map(async (s) => {
      // Skipped mentions are most of the list; sixty is enough to reach past them to today's.
      const res = await gh.request<{ workflow_runs: Array<Record<string, any>> }>(
        "GET",
        `repos/${s.brain}/actions/runs?per_page=60`,
      );
      if (!res.ok) {
        return {
          handle: s.handle,
          brain: s.brain,
          running: [],
          finished: [],
          automatic: 0,
          limit: s.limit,
          error: res.error,
        };
      }
      return shapeLive(s.handle, s.brain, (res.data?.workflow_runs ?? []).map(rawRun), s.limit);
    }),
  );
}

/** The REST run, in the names `gh run list --json` used, which is what the shaping reads. */
function rawRun(r: Record<string, any>): RawRun {
  return {
    databaseId: r.id,
    displayTitle: r.display_title,
    workflowName: r.name,
    status: r.status,
    conclusion: r.conclusion,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    url: r.html_url,
  };
}
