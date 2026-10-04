import assert from "node:assert/strict";
import { test } from "node:test";
import { budgetOf, type RunRow, spend } from "../src/lib/runs.js";
// @ts-expect-error: vendored plain JS, with no types on purpose
import { buildRecord, outcomeOf, readResult, summary } from "../templates/ops/run-record.mjs";

/**
 * The run record is read back into a spend total and a budget warning, so a wrong number here
 * is a wrong number in front of somebody deciding whether to keep paying for an agent. Unknown
 * has to stay unknown all the way through.
 */

const RESULT = {
  type: "result",
  subtype: "success",
  is_error: false,
  num_turns: 42,
  total_cost_usd: 3.2468,
  usage: {
    input_tokens: 1200,
    output_tokens: 34000,
    cache_read_input_tokens: 900000,
    cache_creation_input_tokens: 51000,
  },
};

test("the Action's execution file is read from its last result message", () => {
  const file = JSON.stringify([
    { type: "system", subtype: "init" },
    { type: "assistant", message: {} },
    RESULT,
  ]);
  assert.deepEqual(readResult(file), {
    turns: 42,
    cost_usd: 3.2468,
    tokens: { input: 1200, output: 34000, cache_read: 900000, cache_write: 51000 },
  });
});

test("the CLI's single JSON object and its line-per-message form read the same", () => {
  assert.equal(readResult(JSON.stringify(RESULT))?.cost_usd, 3.2468);
  const lines = ['{"type":"system"}', "some log line", JSON.stringify(RESULT)].join("\n");
  assert.equal(readResult(lines)?.turns, 42, "a stray log line is not ours to fail on");
});

test("an agent that says nothing leaves turns, cost and tokens unknown rather than zero", () => {
  for (const text of ["", "plain text output", '{"type":"assistant"}']) {
    assert.equal(readResult(text), null, JSON.stringify(text));
  }
  const record = buildRecord({ STAFF: "cto", KIND: "daily", AGENT_OUTCOME: "success" }, "");
  assert.equal(record.cost_usd, null);
  assert.equal(record.turns, null);
  assert.equal(record.tokens, null);
  assert.match(summary(record), /\| — \| — \| — \|/, "and the summary shows a dash, not $0.00");
});

test("the outcome knows a failure before the agent from a failure of the agent", () => {
  assert.equal(outcomeOf("failure", "failure"), "failure");
  assert.equal(outcomeOf("skipped", "failure"), "setup-failure", "the token or a checkout failed");
  assert.equal(outcomeOf("", "cancelled"), "cancelled", "a timeout is reported as a cancel");
  assert.equal(outcomeOf("success", "success"), "success");
});

test("a mention the agent exited from without answering is not a success", () => {
  /* An agent that ended its turn to wait on a background job exited cleanly, so the step was
     green and the record said success, while nothing was pushed and nobody was answered. */
  assert.equal(outcomeOf("success", "failure", true), "unanswered");
  assert.equal(outcomeOf("failure", "failure", true), "failure", "a real failure stays one");
  const record = buildRecord(
    { STAFF: "cto", KIND: "mention", AGENT_OUTCOME: "success", UNANSWERED: "true" },
    "",
  );
  assert.equal(record.outcome, "unanswered");
});

test("a record carries duration from the clock the job started, and a link to its log", () => {
  const record = buildRecord(
    {
      STAFF: "cto",
      KIND: "mention",
      AGENT_OUTCOME: "success",
      ROSTER_STARTED: "1000",
      GITHUB_SERVER_URL: "https://github.com",
      GITHUB_REPOSITORY: "acme/technology",
      GITHUB_RUN_ID: "77",
    },
    JSON.stringify(RESULT),
    1000_000 + 125_000,
  );
  assert.equal(record.duration_s, 125);
  assert.equal(record.run_url, "https://github.com/acme/technology/actions/runs/77");
  assert.equal(record.cost_usd, 3.2468);
  assert.match(summary(record), /\$3\.25/);
});

const row = (daysAgo: number, cost: number | null): RunRow => ({
  id: daysAgo,
  kind: "daily",
  url: "",
  createdAt: new Date(Date.UTC(2026, 8, 30) - daysAgo * 86400_000).toISOString(),
  status: "completed",
  conclusion: "success",
  minutes: 20,
  record: cost === null ? null : { cost_usd: cost },
});

test("spend sums the priced runs in the window and says how many it could price", () => {
  const now = Date.UTC(2026, 8, 30);
  const s = spend([row(1, 2.5), row(3, null), row(10, 1.25), row(31, 100)], 30, now);
  assert.deepEqual(
    s,
    { usd: 3.75, known: 2, runs: 3 },
    "a run outside 30 days is not this month's",
  );
});

test("a budget is a positive number of dollars, and anything else is no budget", () => {
  assert.equal(budgetOf(150), 150);
  assert.equal(budgetOf("$80"), 80);
  for (const v of [undefined, null, 0, -5, "lots", { monthly: 5 }]) {
    assert.equal(budgetOf(v), null, JSON.stringify(v));
  }
});
