import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "../src/lib/act.js";
import { askFollowUp, askHead } from "../src/lib/ask.js";
import { dueOf } from "../src/lib/inbox.js";
import { parseTitle, shapeLive } from "../src/lib/live.js";
import { fakeGh } from "./helpers/fakegh.js";

/* What Home reads that the inbox did not: a decision's default, a run's trigger, and the one
   tracker issue per pull request. */

test("a decision's default is read from the line the prompts ask for", () => {
  assert.deepEqual(
    dueOf('Ship it?\n\n**"If I hear nothing by 2026-10-09, I\'ll merge it as it is."**'),
    {
      date: "2026-10-09",
      action: "merge it as it is",
    },
  );
  assert.deepEqual(dueOf("If I hear nothing by 2026-10-09 I’ll leave it off"), {
    date: "2026-10-09",
    action: "leave it off",
  });
  assert.equal(dueOf("No default here. I'll wait."), undefined);
});

test("a run's trigger and issue come from the name its caller gave it", () => {
  assert.deepEqual(parseTitle("cto", "cto peer #12"), { trigger: "peer", issue: 12 });
  assert.deepEqual(parseTitle("cto", "cto mention #3"), { trigger: "mention", issue: 3 });
  assert.deepEqual(parseTitle("cto", "cto follow-on"), { trigger: "follow-on", issue: null });
  assert.deepEqual(parseTitle("cto", "cmo peer #12"), { trigger: "unknown", issue: null });
  // Before the callers named their runs.
  assert.deepEqual(parseTitle("cto", "CTO daily run", "CTO daily run"), {
    trigger: "daily",
    issue: null,
  });
});

test("live runs: running, finished in the last hours, and today's automatic count", () => {
  const now = Date.parse("2026-10-04T12:00:00Z");
  const run = (
    id: number,
    title: string,
    status: string,
    conclusion: string | null,
    at: string,
  ) => ({
    databaseId: id,
    displayTitle: title,
    status,
    conclusion,
    createdAt: at,
    updatedAt: at,
    url: `u${id}`,
  });
  const live = shapeLive(
    "cto",
    "acme/cto",
    [
      run(1, "cto peer #4", "in_progress", null, "2026-10-04T11:58:00Z"),
      run(2, "cto follow-on", "completed", "success", "2026-10-04T10:00:00Z"),
      run(3, "cto mention #9", "completed", "skipped", "2026-10-04T11:00:00Z"),
      run(4, "cto daily", "completed", "success", "2026-10-03T07:00:00Z"),
      run(5, "cto peer #2", "completed", "success", "2026-10-03T23:00:00Z"),
      run(6, "cto ignored #104", "queued", null, "2026-10-04T11:59:00Z"),
    ],
    6,
    now,
  );
  assert.deepEqual(
    live.running.map((r) => [r.id, r.trigger, r.issue]),
    [[1, "peer", 4]],
  );
  assert.deepEqual(
    live.finished.map((r) => r.id),
    [2],
    "yesterday's and skipped runs are not shown",
  );
  assert.equal(live.automatic, 2, "today's peer and follow-on, not yesterday's");
});

const ASK = {
  staff: { handle: "cto", name: "CTO", mention: "@cto", brain: "acme/cto" },
  pr: { repo: "acme/web", number: 161, title: "Second opinion", url: "https://x/161" },
  body: "Fix the conflicts",
};

test("a second ask about the same pull request goes on the issue already open", async () => {
  const gh = fakeGh([
    {
      match: /^issue list --repo acme\/cto --state open/,
      stdout: [
        { number: 7, title: "web#16 — another one" },
        { number: 9, title: `${askHead(ASK)}Second opinion` },
      ],
    },
    {
      match: /^issue comment 9 --repo acme\/cto/,
      stdout: "https://github.com/acme/cto/issues/9#c1",
    },
  ]);
  try {
    const r = await act({ action: "ask", repo: "acme/cto", ask: ASK });
    assert.equal(r.url, "https://github.com/acme/cto/issues/9#c1");
    assert.ok(!gh.calls().some((c) => c[0] === "issue" && c[1] === "create"), "no second issue");
  } finally {
    gh.restore();
  }
  assert.match(
    askFollowUp(ASK),
    /^@cto Fix the conflicts\n\nSame as above: answer on the pull request/,
  );
});

test("with none open, an ask opens one as before", async () => {
  const gh = fakeGh([
    { match: /^issue list /, stdout: [{ number: 7, title: "web#16 — another one" }] },
    { match: /^issue create --repo acme\/cto/, stdout: "https://github.com/acme/cto/issues/10" },
  ]);
  try {
    const r = await act({ action: "ask", repo: "acme/cto", ask: ASK });
    assert.equal(r.url, "https://github.com/acme/cto/issues/10");
  } finally {
    gh.restore();
  }
});
