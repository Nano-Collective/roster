/* Whether each staff member can actually run yet.
 *
 * A hire that had its App created but not installed, and no credential, looked finished: the
 * card said so and Getting started went away. This is the one answer every screen asks. */

import { getStaffProgress } from "./api.js";
import { S } from "./state.js";

/** What is left for one staff member, as short instructions. Empty when they are ready. */
export async function whatsLeft(s, fresh = false) {
  const left = [];
  if (s.rig?.charterStub) left.push("write the charter");
  const p = await getStaffProgress(s.handle, fresh).catch(() => ({}));
  if (p.installed === false) left.push(p.app ? "install the GitHub App" : "create the GitHub App");
  if (p.credential === false) left.push("add the agent credential");
  if (p.ran === false) left.push("run once");
  S.readiness = { ...(S.readiness ?? {}), [s.handle]: left };
  return left;
}

/** Every staff member's, then `then` once all have answered. */
export function checkAll(then) {
  return Promise.all((S.data?.staff ?? []).map((s) => whatsLeft(s))).then(() => then?.());
}

/** The staff with anything left, from what has been checked so far. */
export function notReady() {
  return (S.data?.staff ?? []).filter((s) => (S.readiness?.[s.handle] ?? []).length);
}

/**
 * Whether a run started now could work: nothing left but the first run itself. Unknown counts
 * as able, so a slow answer from GitHub never greys out a working org's buttons.
 */
export function canRun(handle) {
  return !(S.readiness?.[handle] ?? []).some((x) => x !== "run once");
}

/** Whether they have never finished a run, as far as is known. */
export function neverRan(handle) {
  return (S.readiness?.[handle] ?? []).includes("run once");
}

/** Forget every answer, so the next screen asks again: after a refresh, or a step finishing. */
export function forgetReadiness() {
  S.readiness = null;
}

/** The roster command for each step: the only way to do them from a hosted portal. */
export const ROSTER = "npx @nanocollective/roster@latest";
export const ORG_STEPS = {
  hire: ["Hire someone", "hire cto --apply"],
  business: ["Say what the business is, in org/business.md", "brief discover"],
  priorities: ["Say what matters this month, in org/priorities.md", "brief priorities"],
};
const STEP_COMMANDS = {
  "write the charter": (h) => `brief charter ${h}`,
  "create the GitHub App": (h) => `app ${h} --apply`,
  "install the GitHub App": (h) => `app ${h} --apply`,
  "add the agent credential": () => "credential --apply",
  "run once": (h) => `run ${h} --apply`,
};
/**
 * The steps a hosted portal can do itself, so it offers that rather than a command: the org's
 * two files on Org, the charter on Staff, and a first run, which is a workflow dispatch.
 */
export const IN_PORTAL = new Set(["business", "priorities", "write the charter", "run once"]);

export function stepCommand(what, handle) {
  return STEP_COMMANDS[what]?.(handle) ?? "";
}

/** "install the GitHub App, add the agent credential and run once" */
export function sentence(left) {
  if (left.length < 2) return left.join("");
  return left.slice(0, -1).join(", ") + " and " + left.at(-1);
}

/** Per staff member: hire, the GitHub App, the charter, the agent credential, a first run. */
const STAFF_STEPS = 5;

/**
 * Setup as a count, from the same answers as everything above: the org's three steps (create
 * it, business.md, priorities.md), then five per staff member. With nobody hired, the first
 * hire's five are counted as still to do.
 *
 * Null until every staff member's readiness has answered. A count that starts high and drops
 * when GitHub replies reads as steps coming undone.
 */
export function progress(
  unfinished = S.data?.unfinished ?? [],
  staff = S.data?.staff ?? [],
  readiness = S.readiness ?? {},
) {
  const orgSteps = 3;
  let done = orgSteps - unfinished.filter((id) => id !== "hire").length;
  let total = orgSteps;
  if (!staff.length) return { done, total: total + STAFF_STEPS };
  for (const s of staff) {
    const left = readiness[s.handle];
    if (!left) return null;
    total += STAFF_STEPS;
    done += STAFF_STEPS - left.length;
  }
  return { done, total };
}

/** One staff member's own count, or null before their readiness is known. */
export function staffProgress(handle, readiness = S.readiness ?? {}) {
  const left = readiness[handle];
  return left ? { done: STAFF_STEPS - left.length, total: STAFF_STEPS } : null;
}
