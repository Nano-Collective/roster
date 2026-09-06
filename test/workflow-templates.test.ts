import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The Actions layer is generated, so every fix to it has to live in the template or the next
 * regeneration quietly undoes it.
 *
 * That is not hypothetical. Migrating `playpip` onto the shared operating layer cut ~265-line
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
  yaml.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

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
  assert.match(MENTION_CODE, /contains\(github\.event\.issue\.body, '%%MENTION%%'\)/,
    "the issues route has to read the issue body; there is no comment on that payload");
});

test("the loop guard is on the sender, not on the author", () => {
  /* Load-bearing, and the reason the `issues` route needs care: the pinned status issue is opened
     by the human and edited by the staff member on every run. An author check would let the
     agent's own edit wake another run, which would edit it again. */
  assert.match(MENTION_CODE, /github\.event\.sender\.login == '%%HUMAN%%'/,
    "restoring the issues trigger without a sender gate reopens the self-trigger loop");
  const guard = MENTION_CODE.slice(MENTION_CODE.indexOf("if: >-"));
  assert.ok(!/github\.event\.issue\.user\.login/.test(guard),
    "gating the issues route on the issue's author is the loop this exists to prevent");
});

test("one spelling of the mention is enough", () => {
  // GitHub documents `contains` as not case sensitive, so the pre-migration file's second
  // uppercase test was redundant rather than load-bearing. Asserted so nobody re-adds it.
  const occurrences = MENTION_CODE.match(/%%MENTION%%/g) ?? [];
  assert.equal(occurrences.length, 2, "one contains() per route, no case variants");
  assert.ok(!/%%MENTION_UPPER%%|'@%%STAFF_UPPER%%'/.test(MENTION_CODE));
});

test("the caller hands the session enough context to acknowledge either route", () => {
  assert.match(MENTION_CODE, /issue_number: \$\{\{ github\.event\.issue\.number \}\}/,
    "present on both payloads, and the only target an issues-route reaction has");
  assert.match(MENTION_CODE, /comment_id: \$\{\{ github\.event\.comment\.id \}\}/);
});

test("a mention gets an eyes reaction, before anything slow happens", () => {
  assert.match(SESSION_CODE, /- name: React to the request/,
    "the only signal between the request and a reply minutes later");

  const at = SESSION_CODE.indexOf("- name: React to the request");
  const firstCheckout = SESSION_CODE.indexOf("uses: actions/checkout");
  assert.ok(at > 0 && at < firstCheckout,
    "the reaction has to land in seconds, so it goes before the first checkout");

  const step = SESSION_CODE.slice(at, SESSION_CODE.indexOf("- name:", at + 10));
  assert.match(step, /if: inputs\.kind == 'mention'/,
    "a pr-mention is already acknowledged by the public forwarder; reacting again would be two");
  assert.match(step, /continue-on-error: true/,
    "a missing reaction is cosmetic and must never cost the answer");
  assert.match(step, /content=eyes/);
});

test("the reaction falls back to the issue when there is no comment", () => {
  const at = SESSION_CODE.indexOf("- name: React to the request");
  const step = SESSION_CODE.slice(at, SESSION_CODE.indexOf("- name:", at + 10));
  assert.match(step, /format\('issues\/comments\/\{0\}', inputs\.comment_id\)/);
  assert.match(step, /format\('issues\/\{0\}', inputs\.issue_number\)/,
    "an issues payload carries no comment, so the eyes go on the issue itself");
  assert.match(step, /inputs\.comment_id != '' \|\| inputs\.issue_number != ''/,
    "and nothing is posted when there is no target at all");
});

test("session.yaml is the framework's, so the tenant copy must not drift", () => {
  /* `compose.mjs` and `runner-plan.mjs` say outright that they are vendored; session.yaml is the
     third piece of the same runner machinery and says nothing, which is what made its ownership a
     question. It is the framework's: a fix applied only to the tenant is lost on the next upgrade.
     Skipped when the ops repo is not checked out beside this one. */
  const tenant = join(ROOT, "..", "roster-ops", ".github", "workflows", "session.yaml");
  if (!existsSync(tenant)) return;
  assert.equal(readFileSync(tenant, "utf8"), SESSION,
    "roster-ops/.github/workflows/session.yaml has diverged from templates/ops — patch the " +
    "template and copy it out, or the next `roster upgrade` reverts the tenant");
});
