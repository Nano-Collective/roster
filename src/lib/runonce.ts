import { execFile } from "node:child_process";
import { type GhResult, ghJson } from "./gh.js";

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

type Json = <T>(args: string[]) => Promise<GhResult<T>>;
type Text = (args: string[]) => Promise<{ ok: boolean; error?: string }>;

/** The file a staff member's scheduled run lives in. Templated as `%%STAFF%%-daily.yaml`. */
export function dailyWorkflow(handle: string): string {
  return `${handle}-daily.yaml`;
}

/**
 * `gh workflow run`, which prints prose rather than JSON and says nothing useful about which run
 * it started. The run is found afterwards by time instead.
 */
export const ghText: Text = (args) =>
  new Promise((resolve) => {
    execFile("gh", args, { encoding: "utf8" }, (err, _out, stderr) =>
      resolve(err ? { ok: false, error: String(stderr || err.message).trim() } : { ok: true }),
    );
  });

export function dispatch(repo: string, workflow: string, text: Text = ghText) {
  return text(["workflow", "run", workflow, "--repo", repo]);
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

const FIELDS = "databaseId,status,conclusion,url,createdAt,event";

/** Wait for the dispatched run to appear. It takes GitHub a few seconds to list it. */
export async function findDispatched(
  repo: string,
  workflow: string,
  since: number,
  o: { tries?: number; every?: number; json?: Json; sleep?: (ms: number) => Promise<void> } = {},
): Promise<RunInfo | undefined> {
  const json = o.json ?? ghJson;
  const sleep = o.sleep ?? wait;
  for (let i = 0; i < (o.tries ?? 12); i++) {
    const list = await json<RunInfo[]>([
      "run",
      "list",
      "--repo",
      repo,
      "--workflow",
      workflow,
      "--limit",
      "5",
      "--json",
      FIELDS,
    ]);
    const found = list.ok ? pickRun(list.data ?? [], since) : undefined;
    if (found) return found;
    await sleep(o.every ?? 2_500);
  }
  return undefined;
}

/** Where a run is now, and if it failed, where. */
export async function runState(repo: string, id: number, json: Json = ghJson): Promise<RunOutcome> {
  const res = await json<RunInfo & { jobs?: Job[] }>([
    "run",
    "view",
    String(id),
    "--repo",
    repo,
    "--json",
    `${FIELDS},jobs`,
  ]);
  if (!res.ok || !res.data) throw new Error(`could not read run ${id}: ${res.error}`);
  const { jobs, ...run } = res.data;
  return { ...run, failedAt: failedSteps(jobs ?? []) };
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
  repo: string,
  id: number,
  o: {
    timeoutMs: number;
    every?: number;
    onChange?: (status: string) => void;
    json?: Json;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<RunOutcome | undefined> {
  const sleep = o.sleep ?? wait;
  const until = Date.now() + o.timeoutMs;
  let last = "";
  for (;;) {
    const now = await runState(repo, id, o.json);
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
