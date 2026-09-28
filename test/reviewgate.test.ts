import assert from "node:assert/strict";
import { test } from "node:test";
import { GATE_RULESET, judgeGate } from "../src/lib/reviewgate.js";

/**
 * The review gate is the mechanical half of "nothing goes out unread". What matters is that
 * each way it can be open is named as open, and that a repo that is merely unreadable is not
 * reported as unprotected: those need different people to do different things.
 */

const base = { repo: "acme/web", branch: "main", bypass: [] as string[] };

test("one approving review, and nobody on the staff able to skip it, is a gate", () => {
  const v = judgeGate({ ...base, approvals: 1 });
  assert.equal(v.level, "ok");
  assert.match(v.title, /acme\/web@main needs 1 approving review before/);
});

test("no rule at all fails: a staff member could push straight to the default branch", () => {
  const v = judgeGate({ ...base, approvals: null });
  assert.equal(v.level, "fail");
  assert.ok(v.fix, "and says what to do");
});

test("a PR with no approval required is a warning, because whoever opened it can merge it", () => {
  const v = judgeGate({ ...base, approvals: 0 });
  assert.equal(v.level, "warn");
  assert.match(v.title, /whoever opens one can merge it/);
});

test("a staff App on the bypass list fails even with approvals required", () => {
  const v = judgeGate({ ...base, approvals: 2, bypass: ["acme-robot"] });
  assert.equal(v.level, "fail");
  assert.match(v.title, /acme-robot can bypass/);
});

test("settings that could not be read are unknown, not unprotected", () => {
  const v = judgeGate({ ...base, approvals: null, error: "Must have admin rights" });
  assert.equal(v.level, "warn");
  assert.match(v.title, /could not read/);
});

test("the ruleset hire adds needs a review on the default branch, and only admins merging a PR skip it", () => {
  assert.deepEqual(GATE_RULESET.conditions.ref_name.include, ["~DEFAULT_BRANCH"]);
  const pr = GATE_RULESET.rules.find((r) => r.type === "pull_request");
  assert.equal(pr?.parameters.required_approving_review_count, 1);
  assert.deepEqual(GATE_RULESET.bypass_actors, [
    { actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "pull_request" },
  ]);
  assert.equal(GATE_RULESET.enforcement, "active");
});
