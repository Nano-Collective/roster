#!/usr/bin/env node
// Writes down what one run was and what it cost, after the agent has finished or failed.
//
// Vendored alongside compose.mjs for the same reason: it runs on the runner, and must not depend
// on npm or on an org the tenant does not control.
//
// The record is small and deliberately incomplete. Staff, kind, outcome and duration are always
// known. Turns, cost and tokens are known only when the agent says so: claude-code-action writes
// an execution file, the `claude` CLI writes JSON when asked, and anything else may say nothing.
// An unknown is null, never a guess, because a total built from guesses is worse than none.
//
// Usage:  node roster-ops/run-record.mjs --out .roster-run/run.json
//         (everything else arrives in the environment; see session.yaml)

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The agent's own account of the run, from whatever it wrote.
 *
 * Three shapes turn up: an array of messages whose last `result` is the summary (the Action's
 * execution file), a single result object (`claude -p --output-format json`), and one message
 * per line (`stream-json`). All three end in the same object, so find that.
 */
export function readResult(text) {
  if (!text || !text.trim()) return null;
  let items;
  try {
    const parsed = JSON.parse(text);
    items = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    items = [];
    for (const line of text.split("\n")) {
      try {
        items.push(JSON.parse(line));
      } catch {
        // A line of log output between the JSON is not ours to fail on.
      }
    }
  }
  const results = items.filter(
    (m) => m && typeof m === "object" && (m.type === "result" || "total_cost_usd" in m),
  );
  const last = results[results.length - 1];
  if (!last) return null;

  const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const u = last.usage ?? {};
  const tokens = {
    input: n(u.input_tokens),
    output: n(u.output_tokens),
    cache_read: n(u.cache_read_input_tokens),
    cache_write: n(u.cache_creation_input_tokens),
  };
  return {
    turns: n(last.num_turns),
    cost_usd: n(last.total_cost_usd ?? last.cost_usd),
    tokens: Object.values(tokens).some((v) => v !== null) ? tokens : null,
  };
}

/**
 * What happened, in one word.
 *
 * The agent step's own outcome when it ran. When it never ran, the job's status says whether
 * that was a cancel (a timeout is one) or a failure somewhere in the setup before it. A mention
 * the agent exited from cleanly without answering is not a success, whatever the agent says.
 */
export function outcomeOf(agentOutcome, jobStatus, unanswered = false) {
  if (agentOutcome === "success" && unanswered) return "unanswered";
  if (["success", "failure", "cancelled"].includes(agentOutcome)) return agentOutcome;
  if (jobStatus === "cancelled") return "cancelled";
  return "setup-failure";
}

export function buildRecord(env, resultText, now = Date.now()) {
  const started = Number(env.ROSTER_STARTED) || null;
  const result = readResult(resultText);
  return {
    v: 1,
    staff: env.STAFF ?? "",
    kind: env.KIND ?? "",
    outcome: outcomeOf(env.AGENT_OUTCOME, env.JOB_STATUS, env.UNANSWERED === "true"),
    started: started ? new Date(started * 1000).toISOString() : null,
    duration_s: started ? Math.max(0, Math.round(now / 1000 - started)) : null,
    agent: env.AGENT_ID || null,
    model: env.MODEL || null,
    turns: result?.turns ?? null,
    cost_usd: result?.cost_usd ?? null,
    tokens: result?.tokens ?? null,
    run_id: env.GITHUB_RUN_ID ?? null,
    run_url:
      env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY && env.GITHUB_RUN_ID
        ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
        : null,
  };
}

/** The same record as the job summary shows it: one table, unknowns as a dash. */
export function summary(record) {
  const dash = (v) => (v === null || v === undefined ? "—" : String(v));
  const mins = record.duration_s === null ? null : `${Math.round(record.duration_s / 60)}m`;
  const cost = record.cost_usd === null ? null : `$${record.cost_usd.toFixed(2)}`;
  const t = record.tokens;
  const tokens = t
    ? [
        t.input !== null ? `${t.input} in` : "",
        t.output !== null ? `${t.output} out` : "",
        t.cache_read !== null ? `${t.cache_read} cached` : "",
      ]
        .filter(Boolean)
        .join(", ")
    : null;
  return [
    `### ${record.staff} · ${record.kind} · ${record.outcome}`,
    "",
    "| duration | turns | cost | tokens | agent |",
    "|---|---|---|---|---|",
    `| ${dash(mins)} | ${dash(record.turns)} | ${dash(cost)} | ${dash(tokens)} | ${dash(record.agent)} |`,
    "",
  ].join("\n");
}

function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, "")] = argv[i + 1];
  const out = resolve(args.out ?? ".roster-run/run.json");
  const file = process.env.RESULT_FILE;
  const text = file && existsSync(file) ? readFileSync(file, "utf8") : "";
  const record = buildRecord(process.env, text);

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(record, null, 2) + "\n");
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary(record));
  process.stdout.write(JSON.stringify(record) + "\n");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(`run-record: ${err.message}`);
    process.exit(1);
  }
}
