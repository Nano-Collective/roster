import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadComposer } from "../src/lib/workspace.js";
import { makeTenant } from "./helpers/tenant.js";

/**
 * What wakes a staff member besides the schedule and a person's @mention: a peer's ask, and a
 * follow-on to a daily run. Both start runs nobody asked for, so each assertion here holds a
 * piece of what keeps them bounded.
 */

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const code = (yaml: string) =>
  yaml
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");

const MENTION = code(read("templates/brain/.github/workflows/%%STAFF%%-mention.yaml"));
const DAILY = code(read("templates/brain/.github/workflows/%%STAFF%%-daily.yaml"));
const SESSION = code(read("templates/ops/.github/workflows/session.yaml"));

test("a peer's ask wakes on a new issue only, from an App that is not this staff member's own", () => {
  assert.match(MENTION, /github\.event\.action == 'opened'/, "an edit by the peer must not wake");
  assert.match(MENTION, /endsWith\(github\.event\.sender\.login, '\[bot\]'\)/);
  assert.match(MENTION, /github\.event\.sender\.login != '%%APP%%\[bot\]'/, "never its own App");
  assert.match(MENTION, /contains\(join\(github\.event\.issue\.labels\.\*\.name, ','\), 'from-'\)/);
});

test("both callers name their runs by trigger, which is what the limit counts", () => {
  assert.match(MENTION, /^run-name: >-\n\s+%%STAFF%% \$\{\{ .*'mention' \|\| 'peer' \}\}/m);
  assert.match(
    DAILY,
    /^run-name: "%%STAFF%% \$\{\{ .*'daily' \|\| inputs\.trigger \|\| 'manual' \}\}"/m,
  );
  for (const caller of [MENTION, DAILY]) {
    assert.match(caller, /max_runs_per_day: %%MAX_RUNS%%/);
    assert.match(caller, /^\s+trigger: \$\{\{/m);
  }
  assert.match(DAILY, /actions: write/, "the follow-on is started with the job token");
});

test("the session waits on the budget, which counts only peer and follow-on runs that ran", () => {
  assert.match(
    SESSION,
    /^\s{2}session:\n\s+needs: budget\n\s+if: needs\.budget\.outputs\.go == 'true'/m,
  );
  assert.match(SESSION, /peer\|follow-on\) ;;/, "mentions and daily runs go straight through");
  assert.match(SESSION, /select\(\.conclusion != \\"skipped\\"\)/);
  assert.match(SESSION, /n=999999/, "a count that cannot be read holds the run back");
});

test("a follow-on starts only after a daily run that finished and asked for one", () => {
  const step = SESSION.slice(SESSION.indexOf("- name: Start a follow-on run"));
  assert.match(step, /inputs\.kind == 'daily' && success\(\)/);
  assert.match(step, /hashFiles\('\.roster-run\/continue'\) != ''/);
  assert.match(step, /gh workflow run "\$file" .* -f trigger=follow-on/);
});

test("a peer's ask is framed as one, and forbids filing on another peer", async () => {
  const root = mkdtempSync(join(tmpdir(), "roster-wakes-"));
  const before = process.env.ROSTER_CONTEXT;
  try {
    const ws = await makeTenant(root);
    const { compose } = await loadComposer(ws.opsDir);
    const as = (trigger: string, kind: string) => {
      process.env.ROSTER_CONTEXT = JSON.stringify({
        issue_number: "4",
        comment_id: "",
        repo: "acme/cto",
        trigger,
      });
      return compose({ opsDir: ws.opsDir, brainsDir: ws.root, staff: "cto", kind });
    };

    const peer = as("peer", "mention");
    assert.match(peer, /Another staff member has filed something on your\s+tracker/);
    assert.match(peer, /Do not file anything on another staff member's tracker in this run/);
    assert.doesNotMatch(peer, /has asked you something directly/);

    const person = as("mention", "mention");
    assert.match(person, /has asked you something directly/);
    assert.doesNotMatch(person, /Do not file anything on another staff member's tracker/);

    assert.match(as("follow-on", "daily"), /This is a follow-on run/);
    const daily = as("daily", "daily");
    assert.doesNotMatch(daily, /This is a follow-on run/);
    assert.match(daily, /up to 6 a day that nobody asked\s+for/, "the limit falls back to 6");
  } finally {
    if (before === undefined) delete process.env.ROSTER_CONTEXT;
    else process.env.ROSTER_CONTEXT = before;
    rmSync(root, { recursive: true, force: true });
  }
});

test("each caller grants every permission session.yaml's jobs ask for", () => {
  /* A called job that asks for more than its caller granted fails before its first step, on
     every run. The mention caller once granted `actions: read` under a session asking for
     `write`, which would have stopped every mention. */
  const RANK: Record<string, number> = { none: 0, read: 1, write: 2 };
  const grants = (yaml: string) => {
    const out: Record<string, string> = {};
    for (const block of yaml.matchAll(/^\s+permissions:\n((?:\s{6,}\w[\w-]*: \w+\n)+)/gm)) {
      for (const [, k, v] of block[1]!.matchAll(/(\w[\w-]*): (\w+)/g)) {
        if ((RANK[v!] ?? 0) > (RANK[out[k!] ?? "none"] ?? 0)) out[k!] = v!;
      }
    }
    return out;
  };
  const asked = grants(SESSION);
  for (const [name, caller] of [
    ["mention", MENTION],
    ["daily", DAILY],
  ] as const) {
    const given = grants(caller);
    for (const [k, v] of Object.entries(asked)) {
      assert.ok(
        (RANK[given[k] ?? "none"] ?? 0) >= (RANK[v] ?? 0),
        `the ${name} caller grants ${k}: ${given[k] ?? "none"}, and session.yaml asks for ${v}`,
      );
    }
  }
});
