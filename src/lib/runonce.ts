import type { GitHub } from "./github.js";

/**
 * One run of a staff member's daily workflow, started by hand and followed to the end.
 *
 * This is the step that turns doctor's "unproven" into proven. Nothing short of a run that
 * finished shows the App is installed on the right repos, the secrets are where the callers
 * look, and the ops repo's workflow is callable, so setup ends with one, watched.
 */

export interface RunInfo {
  databaseId: number;
  status: string;
  conclusion: string;
  url: string;
  createdAt: string;
  event?: string;
}

export interface RunOutcome extends RunInfo {
  /** Where it failed, as "job › step", when it did. */
  failedAt: string[];
}

/** The file a staff member's scheduled run lives in. Templated as `%%STAFF%%-daily.yaml`. */
export function dailyWorkflow(handle: string): string {
  return `${handle}-daily.yaml`;
}

/**
 * Start a workflow on the repository's default branch, which is what `gh workflow run` did.
 *
 * GitHub answers a dispatch with nothing at all, not even the run it started. The run is found
 * afterwards by time instead.
 */
export async function dispatch(
  gh: GitHub,
  repo: string,
  workflow: string,
): Promise<{ ok: boolean; error?: string }> {
  const info = await gh.request<{ default_branch: string }>("GET", `repos/${repo}`);
  if (!info.ok) return { ok: false, error: info.error };
  const res = await gh.request("POST", `repos/${repo}/actions/workflows/${workflow}/dispatches`, {
    body: { ref: info.data?.default_branch ?? "main" },
  });
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/**
 * The run a dispatch started: the newest manual run created no earlier than it was asked for.
 *
 * GitHub does not return a run id from a dispatch, so this is the only handle there is. The few
 * seconds of slack are for a clock here that is ahead of GitHub's; someone else dispatching the
 * same workflow in the same few seconds is the case it cannot tell apart, and would pick theirs.
 */
export function pickRun(runs: RunInfo[], since: number, slackMs = 5_000): RunInfo | undefined {
  return runs
    .filter((r) => (r.event ?? "workflow_dispatch") === "workflow_dispatch")
    .filter((r) => Date.parse(r.createdAt) >= since - slackMs)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
}

/** A REST run, in the names the rest of roster reads. */
export function runInfo(r: Record<string, any>): RunInfo {
  return {
    databaseId: Number(r.id),
    status: String(r.status ?? ""),
    conclusion: String(r.conclusion ?? ""),
    url: String(r.html_url ?? ""),
    createdAt: String(r.created_at ?? ""),
    event: r.event,
  };
}

/** Wait for the dispatched run to appear. It takes GitHub a few seconds to list it. */
export async function findDispatched(
  gh: GitHub,
  repo: string,
  workflow: string,
  since: number,
  o: { tries?: number; every?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<RunInfo | undefined> {
  const sleep = o.sleep ?? wait;
  for (let i = 0; i < (o.tries ?? 12); i++) {
    const list = await gh.request<{ workflow_runs: Array<Record<string, any>> }>(
      "GET",
      `repos/${repo}/actions/workflows/${workflow}/runs?per_page=5`,
    );
    const found = list.ok
      ? pickRun((list.data?.workflow_runs ?? []).map(runInfo), since)
      : undefined;
    if (found) return found;
    await sleep(o.every ?? 2_500);
  }
  return undefined;
}

/** Where a run is now, and if it failed, where. */
export async function runState(gh: GitHub, repo: string, id: number): Promise<RunOutcome> {
  const [run, jobs] = await Promise.all([
    gh.request<Record<string, any>>("GET", `repos/${repo}/actions/runs/${id}`),
    gh.request<{ jobs: Array<Record<string, any>> }>(
      "GET",
      `repos/${repo}/actions/runs/${id}/jobs?per_page=100`,
    ),
  ]);
  if (!run.ok || !run.data) throw new Error(`could not read run ${id}: ${run.error}`);
  const list: Job[] = (jobs.data?.jobs ?? []).map((j) => ({
    name: String(j.name ?? ""),
    conclusion: String(j.conclusion ?? ""),
    steps: (j.steps ?? []).map((s: any) => ({
      name: String(s.name ?? ""),
      conclusion: String(s.conclusion ?? ""),
    })),
  }));
  return { ...runInfo(run.data), failedAt: failedSteps(list) };
}

interface Job {
  name: string;
  conclusion: string;
  steps?: Array<{ name: string; conclusion: string }>;
}

export function failedSteps(jobs: Job[]): string[] {
  const out: string[] = [];
  for (const j of jobs) {
    if (j.conclusion !== "failure") continue;
    const steps = (j.steps ?? []).filter((s) => s.conclusion === "failure");
    if (!steps.length) out.push(j.name);
    for (const s of steps) out.push(`${j.name} › ${s.name}`);
  }
  return out;
}

/**
 * Poll until the run finishes, saying when its status changes.
 *
 * Bounded by the staff member's own ceiling plus room to queue: a run cannot outlast the
 * timeout-minutes its caller sets, so waiting past that is waiting on nothing.
 */
export async function follow(
  gh: GitHub,
  repo: string,
  id: number,
  o: {
    timeoutMs: number;
    every?: number;
    onChange?: (status: string) => void;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<RunOutcome | undefined> {
  const sleep = o.sleep ?? wait;
  const until = Date.now() + o.timeoutMs;
  let last = "";
  for (;;) {
    const now = await runState(gh, repo, id);
    if (now.status !== last) o.onChange?.(now.status);
    last = now.status;
    if (now.status === "completed") return now;
    if (Date.now() > until) return undefined;
    await sleep(o.every ?? 15_000);
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
