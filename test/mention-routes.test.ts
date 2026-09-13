import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadComposer } from "../src/lib/workspace.js";
import { makeTenant } from "./helpers/tenant.js";

/**
 * The two ways a mention arrives, and why the prompt cannot be the same on both.
 *
 * `issue_comment` carries a comment id. The `issues` route, where somebody types `@cto` into the
 * body of a brand new issue, does not: there is no comment to fetch. The prompt used to open
 * with `gh api repos/<r>/issues/comments/ --jq .body` either way, which 404s on the second route
 * before the agent has read anything.
 *
 * That route is now the busier one: the portal's "Ask a staff member" always opens a new issue.
 * So both shapes are pinned here, against a freshly scaffolded tenant, which is the only place
 * the *template* composer runs rather than a vendored copy of an older one.
 */

const root = mkdtempSync(join(tmpdir(), "roster-mention-"));
const ws = await makeTenant(root, { org: "acme" });
const { compose } = await loadComposer(ws.opsDir);

function composeMention(event: Record<string, string>): string {
  const before = process.env.ROSTER_CONTEXT;
  process.env.ROSTER_CONTEXT = JSON.stringify(event);
  try {
    return compose({ opsDir: ws.opsDir, brainsDir: ws.root, staff: "cto", kind: "mention" });
  } finally {
    if (before === undefined) delete process.env.ROSTER_CONTEXT;
    else process.env.ROSTER_CONTEXT = before;
  }
}

const COMMENT = { issue_number: "9", comment_id: "555", repo: "acme/technology" };
const NEW_ISSUE = { issue_number: "9", comment_id: "", repo: "acme/technology" };

test("a comment mention points the agent at that comment", () => {
  const out = composeMention(COMMENT);
  assert.match(out, /issues\/comments\/555/);
  assert.match(out, /comment `555`/);
});

test("a new-issue mention never sends them to a comment that does not exist", () => {
  const out = composeMention(NEW_ISSUE);
  assert.doesNotMatch(
    out,
    /issues\/comments\/(\s|$|-)/m,
    "a comments URL with no id on the end is a 404 as the first instruction",
  );
  assert.doesNotMatch(out, /comment ``/, "and an empty pair of backticks is not a comment id");
  assert.match(out, /gh api repos\/acme\/technology\/issues\/9 --jq \.body/);
  assert.match(out, /the body of the issue/i);
});

test("a new-issue mention is told an instruction in the body can override the prompt", () => {
  /* This is what makes "Ask a staff member" work: the issue carries a pull request that lives
     in another repo and says to answer there, and prompts/mention.md otherwise tells them to
     answer where the request came from. */
  const out = composeMention(NEW_ISSUE);
  assert.match(out, /that instruction wins/i);
});

test("neither route composes to a stub, and both name the issue", () => {
  for (const event of [COMMENT, NEW_ISSUE]) {
    const out = composeMention(event);
    assert.ok(out.length > 1000, `composed to ${out.length} characters`);
    assert.match(out, /Issue #9 on `acme\/technology`/);
    assert.doesNotMatch(out, /\{\{/, "an unresolved placeholder is read literally by the agent");
  }
});
