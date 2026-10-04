import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { plan } from "../src/commands/upgrade.js";

/**
 * The Actions layer is generated, so every fix to it has to live in the template or the next
 * regeneration quietly undoes it.
 *
 * That is not hypothetical. Migrating `acme` onto the shared operating layer cut ~265-line
 * per-repo workflows down to ~40-line callers, and three behaviours went missing in the process:
 * the eyes reaction that acknowledges a mention, the `issues` trigger that lets a mention be typed
 * straight into a new issue, and — apparently — case-insensitive matching. Two were real. Each
 * assertion below names the behaviour it is holding in place.
 */

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const MENTION = read("templates/brain/.github/workflows/%%STAFF%%-mention.yaml");
const SESSION = read("templates/ops/.github/workflows/session.yaml");

/** Strip comments: every behaviour here must hold in the workflow itself, not in its prose. */
const code = (yaml: string) =>
  yaml
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");

const MENTION_CODE = code(MENTION);
const SESSION_CODE = code(SESSION);

test("a mention caller wakes on a new issue as well as on a comment", () => {
  // The route that went missing: "@cto do this" typed into the body of a new issue is one box,
  // rather than a create-then-comment round trip.
  assert.match(MENTION_CODE, /^\s{2}issues:\s*$/m, "no `issues:` trigger");
  assert.match(MENTION_CODE, /^\s{2}issues:\s*\n\s+types:\s*\[opened, edited\]/m);
  assert.match(MENTION_CODE, /^\s{2}issue_comment:\s*\n\s+types:\s*\[created, edited\]/m);
});

test("the mention condition covers both routes", () => {
  assert.match(MENTION_CODE, /github\.event_name == 'issue_comment'/);
  assert.match(MENTION_CODE, /github\.event_name == 'issues'/);
  assert.match(MENTION_CODE, /contains\(github\.event\.comment\.body, '%%MENTION%%'\)/);
  assert.match(
    MENTION_CODE,
    /contains\(github\.event\.issue\.body, '%%MENTION%%'\)/,
    "the issues route has to read the issue body; there is no comment on that payload",
  );
});

test("the loop guard is on the sender, not on the author", () => {
  /* Load-bearing, and the reason the `issues` route needs care: the pinned status issue is opened
     by a human and edited by the staff member on every run. An author check would let the
     agent's own edit wake another run, which would edit it again.

     The gate is a list because an org can have more than one human. It used to be `== '%%HUMAN%%'`,
     which silently dropped everything the second founder wrote. */
  assert.match(
    MENTION_CODE,
    /contains\(fromJSON\('%%HUMAN_LOGINS%%'\), github\.event\.sender\.login\)/,
    "restoring the issues trigger without a sender gate reopens the self-trigger loop",
  );
  const guard = MENTION_CODE.slice(MENTION_CODE.indexOf("if: >-"));
  assert.ok(
    !/github\.event\.issue\.user\.login/.test(guard),
    "gating the issues route on the issue's author is the loop this exists to prevent",
  );
});

test("one spelling of the mention is enough", () => {
  // GitHub documents `contains` as not case sensitive, so the pre-migration file's second
  // uppercase test was redundant rather than load-bearing. Asserted so nobody re-adds it.
  const occurrences = MENTION_CODE.match(/%%MENTION%%/g) ?? [];
  assert.equal(occurrences.length, 2, "one contains() per route, no case variants");
  assert.ok(!/%%MENTION_UPPER%%|'@%%STAFF_UPPER%%'/.test(MENTION_CODE));
});

test("the caller hands the session enough context to acknowledge either route", () => {
  assert.match(
    MENTION_CODE,
    /issue_number: \$\{\{ github\.event\.issue\.number \}\}/,
    "present on both payloads, and the only target an issues-route reaction has",
  );
  assert.match(MENTION_CODE, /comment_id: \$\{\{ github\.event\.comment\.id \}\}/);
});

test("a mention gets an eyes reaction, before anything slow happens", () => {
  assert.match(
    SESSION_CODE,
    /- name: React to the request/,
    "the only signal between the request and a reply minutes later",
  );

  const at = SESSION_CODE.indexOf("- name: React to the request");
  const firstCheckout = SESSION_CODE.indexOf("uses: actions/checkout");
  assert.ok(
    at > 0 && at < firstCheckout,
    "the reaction has to land in seconds, so it goes before the first checkout",
  );

  const step = SESSION_CODE.slice(at, SESSION_CODE.indexOf("- name:", at + 10));
  assert.match(step, /if: inputs\.kind == 'mention'/, "a daily run has nothing to react to");
  assert.match(
    step,
    /continue-on-error: true/,
    "a missing reaction is cosmetic and must never cost the answer",
  );
  assert.match(step, /content=eyes/);
});

test("the reaction falls back to the issue when there is no comment", () => {
  const at = SESSION_CODE.indexOf("- name: React to the request");
  const step = SESSION_CODE.slice(at, SESSION_CODE.indexOf("- name:", at + 10));
  assert.match(step, /format\('issues\/comments\/\{0\}', inputs\.comment_id\)/);
  assert.match(
    step,
    /format\('issues\/\{0\}', inputs\.issue_number\)/,
    "an issues payload carries no comment, so the eyes go on the issue itself",
  );
  assert.match(
    step,
    /inputs\.comment_id != '' \|\| inputs\.issue_number != ''/,
    "and nothing is posted when there is no target at all",
  );
});

test("session.yaml is the framework's, so the tenant copy must not drift", () => {
  /* `compose.mjs` and `runner-plan.mjs` say outright that they are vendored; session.yaml is the
     third piece of the same runner machinery and says nothing, which is what made its ownership a
     question. It is the framework's: a fix applied only to the tenant is lost on the next upgrade.

     Behind is not drift. A template change leaves the tenant on its old copy until `roster
     upgrade` lands, so the question is the one upgrade asks: is there an edit here that the
     framework does not have. Skipped when the ops repo is not checked out beside this one. */
  const ops = join(ROOT, "..", "roster-ops");
  if (!existsSync(join(ops, ".github", "workflows", "session.yaml"))) return;
  const verdict = plan(
    ".github/workflows/session.yaml",
    join(ROOT, "templates", "ops"),
    join(ops, ".roster", "seed"),
    ops,
  ).verdict;
  assert.notEqual(
    verdict,
    "edited-managed",
    "roster-ops/.github/workflows/session.yaml has an edit the template does not — patch the " +
      "template and run `roster upgrade`, or the next upgrade reverts the tenant",
  );
});

/** One step of session.yaml, by name, without its neighbours. */
function step(name: string): string {
  const at = SESSION_CODE.indexOf(`- name: ${name}`);
  assert.ok(at > 0, `no step called "${name}"`);
  const next = SESSION_CODE.indexOf("- name:", at + 10);
  return SESSION_CODE.slice(at, next < 0 ? undefined : next);
}

test("the failure notice does not depend on the token whose failure it reports", () => {
  /* A canary sat red for twelve days because its alert used the App token, and the App token
     was what had broken. The notice falls back to the job's own token, and to the caller's repo
     when the plan never ran. */
  const notice = step("Say so if the run did not finish");
  assert.match(notice, /if: failure\(\) \|\| cancelled\(\)/);
  assert.match(notice, /JOB_TOKEN: \$\{\{ github\.token \}\}/, "no fallback token");
  assert.match(notice, /GH_TOKEN="\$JOB_TOKEN" gh issue comment/, "the fallback is never used");
  assert.match(
    notice,
    /steps\.plan\.outputs\.brain_repo \|\| github\.repository/,
    "a run that died minting its token never reached the plan",
  );
  assert.match(
    notice,
    /contents\/staff\.yaml/,
    "the status issue has to be findable without a checkout",
  );
});

test("the job token may comment, and every caller grants it", () => {
  /* A called workflow can only narrow what its caller grants, so asking for issues: write in
     session.yaml alone is asking for something nobody gave it. */
  assert.match(SESSION_CODE, /^ {4}permissions:\n {6}contents: read\n {6}issues: write$/m);
  for (const kind of ["daily", "mention"]) {
    const caller = code(read(`templates/brain/.github/workflows/%%STAFF%%-${kind}.yaml`));
    assert.match(
      caller,
      /^ {4}permissions:\n {6}contents: read\n {6}issues: write$/m,
      `the ${kind} caller does not grant issues: write, so the fallback cannot post`,
    );
  }
});

test("the run is written down whatever happened, under a name the portal can find", () => {
  const record = step("Write down the run");
  assert.match(record, /if: always\(\)/, "a failed run is the one most worth a record");
  assert.match(record, /continue-on-error: true/, "a missing record must never cost the run");
  assert.match(record, /steps\.session_action\.outputs\.execution_file/);
  const keep = step("Keep the run record");
  assert.match(keep, /if: always\(\)/);
  assert.match(keep, /name: roster-run$/m, "lib/runs.ts downloads it by this name");
  assert.ok(
    SESSION_CODE.indexOf("- name: Write down the run") >
      SESSION_CODE.lastIndexOf("- name: Run the session"),
    "the record is written after the agent",
  );
});

test("a session cannot end its turn waiting on a background job", () => {
  /* A test suite past Claude Code's ten-minute cap was moved to the background, the agent ended
     its turn to wait for it, and the session ended with the merge unpushed. Twice. */
  assert.match(SESSION_CODE, /^ {6}CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1"$/m);
  assert.match(SESSION_CODE, /^ {6}BASH_MAX_TIMEOUT_MS: "\d+"$/m);
});

test("a mention that ends unanswered fails the job and says so in the thread", () => {
  const check = step("Check the request was answered");
  assert.match(check, /inputs\.kind == 'mention'/);
  assert.match(
    check,
    /state.*closed/s,
    "a forwarded request answers elsewhere and closes the issue",
  );
  assert.match(check, /\.user\.login == \\"\$BOT\\"/, "only the staff member's own reply counts");
  assert.match(check, /unanswered=true/);
  assert.match(check, /exit 1/, "a green job is how nobody found out");
  assert.ok(
    SESSION_CODE.indexOf("- name: Check the request was answered") <
      SESSION_CODE.indexOf("- name: Write down the run"),
    "the record has to know",
  );
  assert.match(
    step("Write down the run"),
    /UNANSWERED: \$\{\{ steps\.answered\.outputs\.unanswered \}\}/,
  );
  assert.match(step("Say so if the run did not finish"), /UNANSWERED/);
});

test("human work in flight is gathered before the prompt, and never fails the run", () => {
  const gather = step("Gather human work in flight");
  assert.match(gather, /continue-on-error: true/);
  assert.match(gather, /--out \.roster-run\/inflight\.md/, "where compose.mjs looks for it");
  assert.ok(
    SESSION_CODE.indexOf("- name: Gather human work in flight") <
      SESSION_CODE.indexOf("- name: Compose the prompt"),
  );
  assert.match(
    step("Compose the prompt"),
    /--brains \. /,
    "compose reads .roster-run from the brains directory, which has to be the checkout root",
  );
});
