#!/usr/bin/env node
// Opens this week's status issue, before the prompt is composed, when the one in staff.yaml is
// from an earlier week.
//
// Written because one status issue that lasts forever turns into a diary. Pip's ran from August
// to October as forty-odd run reports in one thread, and the human stopped reading it. A week
// per issue keeps a thread short, and the closed ones read back as the history, a week at a time.
//
// The housekeeping is here rather than in the prompt because it has to happen every week, the
// same way, whatever the agent does: open the issue, pin it, carry last week's body across, and
// move staff.yaml on, so every reader of `status_issue` (the prompts, the portal, doctor, the
// failure notice) follows without knowing weeks exist. What only the agent can write, the week's
// summary on the old issue, is left to it: the old issue loses `keep-open` and its pin, and the
// prompt is told its number.
//
// Vendored alongside compose.mjs for the same reason: it runs on the runner and must not depend
// on npm. It asks GitHub through `gh`. It never fails a run: if anything here goes wrong, the run
// carries on with last week's issue, which is how every run went before this existed.
//
// Usage:  node roster-ops/status-week.mjs --staff cto --ops roster-ops --brains .
// Prints `previous=#15` for $GITHUB_OUTPUT when a week's issue is waiting for its summary.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseYaml } from "./compose.mjs";

export const STATUS_LABEL = "status";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Monday 00:00 UTC of the week `now` falls in. */
export function weekStart(now) {
  const d = new Date(now);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back));
}

export function weekTitle(now) {
  const m = weekStart(now);
  return `📍 Where we are: week of ${m.getUTCDate()} ${MONTHS[m.getUTCMonth()]}`;
}

/** Whether `issue` is this week's, and still the one to write to. */
export function isCurrent(issue, now) {
  return Boolean(issue) && issue.state === "open" && new Date(issue.created_at) >= weekStart(now);
}

/** staff.yaml with `status_issue:` moved to `n`, keeping everything else byte for byte. */
export function withStatusIssue(yaml, n) {
  if (/^status_issue:.*$/m.test(yaml)) return yaml.replace(/^status_issue:.*$/m, `status_issue: ${n}`);
  return yaml.replace(/^(brain:.*\n)/m, `$1status_issue: ${n}\n`);
}

const FIRST_BODY = "Nothing yet. The first run of the week rewrites this.";

/**
 * Works out the week and does the GitHub half of it. Returns the issue to write to and the
 * earlier ones still waiting for a summary. `gh` takes argv and returns stdout, so a test
 * drives it without the network.
 */
export function rollWeek({ repo, current, gh, now = Date.now() }) {
  const issue = current ? JSON.parse(gh(["api", `repos/${repo}/issues/${current}`])) : null;

  // Created on every run because it costs one call and an org that upgraded never had it.
  try {
    gh(["label", "create", STATUS_LABEL, "--repo", repo, "--color", "0e8a16",
      "--description", "A week's status issue"]);
  } catch {
    // Already there, which is the usual answer.
  }

  let next = current;
  let rolled = false;
  if (!isCurrent(issue, now)) {
    const opened = JSON.parse(
      gh([
        "api", `repos/${repo}/issues`, "-X", "POST",
        "-f", `title=${weekTitle(now)}`,
        "-f", `body=${issue?.state === "open" && issue.body?.trim() ? issue.body : FIRST_BODY}`,
        "-f", `labels[]=${STATUS_LABEL}`,
        "-f", "labels[]=keep-open",
      ]),
    );
    next = opened.number;
    rolled = true;

    // Three issues can be pinned, so the old one comes off first.
    if (issue?.state === "open") {
      quietly(() => gh(["api", "graphql", "-f", "query=mutation($id:ID!){unpinIssue(input:{issueId:$id}){issue{number}}}", "-f", `id=${issue.node_id}`]));
      // Without keep-open the agent may close it, which is what the summary ends with. The
      // label marks it as a week's issue for the sweep below, should that run not finish.
      quietly(() => gh(["api", `repos/${repo}/issues/${current}/labels/keep-open`, "-X", "DELETE"]));
      quietly(() => gh(["api", `repos/${repo}/issues/${current}/labels`, "-X", "POST", "-f", `labels[]=${STATUS_LABEL}`]));
    }
    quietly(() => gh(["api", "graphql", "-f", "query=mutation($id:ID!){pinIssue(input:{issueId:$id}){issue{number}}}", "-f", `id=${opened.node_id}`]));
  }

  // Every earlier week still open: last week's, and any week whose summary run did not finish.
  // Last week's is added by hand when it was just rolled: the label filter lags a label added a
  // moment ago, and on Pip's first roll the listing came back without it, so no summary was asked for.
  const open = JSON.parse(
    gh(["api", `repos/${repo}/issues?state=open&labels=${STATUS_LABEL}&per_page=20`]) || "[]",
  );
  const numbers = new Set(open.filter((i) => !i.pull_request).map((i) => i.number));
  if (rolled && issue?.state === "open") numbers.add(current);
  numbers.delete(next);
  const previous = [...numbers].sort((a, b) => a - b);
  return { current: next, rolled, previous };
}

function quietly(fn) {
  try {
    fn();
  } catch (err) {
    console.error(`::warning::status-week: ${String(err.message).split("\n")[0]}`);
  }
}

/** Commits staff.yaml's new number, retrying the push over anything another run pushed. */
function commit(brainDir, n) {
  const git = (...a) => execFileSync("git", ["-C", brainDir, ...a], { stdio: ["ignore", "pipe", "pipe"] });
  git("add", "staff.yaml");
  git("commit", "-m", `roster: this week's status issue is #${n}`);
  for (let i = 0; ; i++) {
    try {
      git("push");
      return;
    } catch (err) {
      if (i === 2) throw err;
      git("pull", "--rebase");
    }
  }
}

function main(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, "")] = argv[i + 1];
  if (!args.staff) throw new Error("--staff is required");
  const opsDir = resolve(args.ops ?? ".");
  const org = parseYaml(readFileSync(join(opsDir, "org.yaml"), "utf8"), "org.yaml");
  const entry = (org.staff ?? []).find((s) => s.handle === args.staff);
  if (!entry) throw new Error(`org.yaml has no staff member "${args.staff}"`);
  const brainDir = join(resolve(args.brains ?? ".."), entry.dir ?? entry.handle);
  const file = join(brainDir, "staff.yaml");
  if (!existsSync(file)) throw new Error(`no staff.yaml at ${file}`);
  const yaml = readFileSync(file, "utf8");
  const manifest = parseYaml(yaml, "staff.yaml");
  const repo = String(manifest.brain ?? `${org.org}/${entry.dir ?? entry.handle}`);

  const gh = (a) => execFileSync("gh", a, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const week = rollWeek({ repo, current: Number(manifest.status_issue) || 0, gh });
  if (week.rolled) {
    writeFileSync(file, withStatusIssue(yaml, week.current));
    commit(brainDir, week.current);
    console.error(`opened #${week.current} for this week`);
  }
  if (week.previous.length) {
    process.stdout.write(`previous=${week.previous.map((n) => `#${n}`).join(", ")}\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(`::warning::status-week: ${err.message}`);
  }
}
