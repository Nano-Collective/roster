import assert from "node:assert/strict";
import { test } from "node:test";
import { whyNotMerged } from "../src/lib/act.js";

/* What gh says when a required check has not finished: true, and no help to the person
   who pressed Merge. */
const GH_BLOCKED =
  "Command failed: gh pr merge 186 --repo playpip/pip-web --squash\n" +
  "X Pull request playpip/pip-web#186 is not mergeable: the base branch policy prohibits the merge.\n" +
  "To have the pull request merged after all the requirements have been met, add the `--auto` flag.\n" +
  "To use administrator privileges to immediately merge the pull request, add the `--admin` flag.\n";

test("a merge blocked by a running check names the check", () => {
  const msg = whyNotMerged(GH_BLOCKED, {
    mergeStateStatus: "BLOCKED",
    statusCheckRollup: [
      { name: "gate", status: "IN_PROGRESS", conclusion: "" },
      { name: "base is main", status: "COMPLETED", conclusion: "SUCCESS" },
    ],
  });
  assert.equal(msg, "Not merged: checks are still running (gate). Merge again once they pass.");
});

test("a merge blocked by a failed check says it failed, not that it is running", () => {
  const msg = whyNotMerged(GH_BLOCKED, {
    mergeStateStatus: "BLOCKED",
    statusCheckRollup: [{ name: "gate", status: "COMPLETED", conclusion: "FAILURE" }],
  });
  assert.equal(msg, "Not merged: checks failed (gate).");
});

test("a block with every check green points at the rules, not at the checks", () => {
  const msg = whyNotMerged(GH_BLOCKED, {
    mergeStateStatus: "BLOCKED",
    statusCheckRollup: [{ name: "gate", status: "COMPLETED", conclusion: "SUCCESS" }],
  });
  assert.match(msg, /^Not merged: the branch rules require something first/);
});

test("when the pull request cannot be read, gh's own reason is kept without its flag advice", () => {
  const msg = whyNotMerged(GH_BLOCKED, null);
  assert.equal(
    msg,
    "Not merged: Pull request playpip/pip-web#186 is not mergeable: the base branch policy prohibits the merge.",
  );
  assert.doesNotMatch(msg, /--auto|--admin|Command failed/);
});

test("a merge blocked on a required review says to approve it first", () => {
  const msg = whyNotMerged(GH_BLOCKED, {
    mergeStateStatus: "BLOCKED",
    reviewDecision: "REVIEW_REQUIRED",
    statusCheckRollup: [{ name: "gate", status: "COMPLETED", conclusion: "SUCCESS" }],
  });
  assert.equal(
    msg,
    "Not merged: the branch rules need an approving review first. Press Approve, then Merge.",
  );
});
