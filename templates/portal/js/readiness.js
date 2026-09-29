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

/** "install the GitHub App, add the agent credential and run once" */
export function sentence(left) {
  if (left.length < 2) return left.join("");
  return left.slice(0, -1).join(", ") + " and " + left.at(-1);
}
