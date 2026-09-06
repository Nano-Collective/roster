import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { planAll, apply, type FilePlan } from "../src/commands/upgrade.js";
import { classify } from "../src/lib/templates.js";
import { merge3 } from "../src/lib/merge.js";

/**
 * Upgrading is the one operation that can silently destroy a tenant's work, so these tests
 * care about two things above all: a local edit is never lost, and a conflict never reaches a
 * live file. Agents read org/voice.md at every boot; conflict markers in it would land in
 * every prompt.
 */

function scratch() {
  const root = mkdtempSync(join(tmpdir(), "roster-upgrade-"));
  const dirs = { tpl: join(root, "tpl"), seed: join(root, "ops", ".roster", "seed"), ops: join(root, "ops") };
  const put = (base: string, rel: string, text: string) => {
    const p = join(base, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  };
  return {
    root,
    ...dirs,
    template: (rel: string, t: string) => put(dirs.tpl, rel, t),
    base: (rel: string, t: string) => put(dirs.seed, rel, t),
    tenant: (rel: string, t: string) => put(dirs.ops, rel, t),
    read: (rel: string) => readFileSync(join(dirs.ops, rel), "utf8"),
    has: (rel: string) => existsSync(join(dirs.ops, rel)),
    plans: () => planAll(dirs.tpl, dirs.seed, dirs.ops),
    run: (plans: FilePlan[]) => apply(dirs.ops, dirs.seed, dirs.tpl, plans),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

const VOICE = ["# Voice", "", "Concision, not word counts.", "", "Orwell's rules are the guide."].join("\n");

test("a file the tenant never touched follows the framework", () => {
  const s = scratch();
  try {
    s.template("org/voice.md", VOICE + "\nNo adverbs.\n");
    s.base("org/voice.md", VOICE + "\n");
    s.tenant("org/voice.md", VOICE + "\n");

    const p = s.plans()[0]!;
    assert.equal(p.verdict, "updated");
    s.run(s.plans());
    assert.match(s.read("org/voice.md"), /No adverbs/);
  } finally { s.cleanup(); }
});

test("a local edit survives an unrelated framework change", () => {
  // The case the whole command exists for: Pip's voice.md carries its own additions.
  const s = scratch();
  try {
    s.base("org/voice.md", VOICE + "\n");
    s.template("org/voice.md", "# Voice\n\nConcision, not word counts.\n\nOrwell's rules are the guide.\nNo adverbs.\n");
    s.tenant("org/voice.md", "# Voice\n\nPip never says 'leverage'.\n\nConcision, not word counts.\n\nOrwell's rules are the guide.\n");

    const p = s.plans()[0]!;
    assert.equal(p.verdict, "merged", p.note);
    s.run(s.plans());

    const out = s.read("org/voice.md");
    assert.match(out, /Pip never says/, "the tenant's line must survive");
    assert.match(out, /No adverbs/, "and the framework's must arrive");
    assert.ok(!out.includes("<<<<<<<"), "a clean merge must not carry markers");
  } finally { s.cleanup(); }
});

test("the framework standing still leaves a rewritten file alone", () => {
  const s = scratch();
  try {
    s.base("org/guardrails.md", "a\nb\n");
    s.template("org/guardrails.md", "a\nb\n");
    s.tenant("org/guardrails.md", "a\nb\nPip's own rule.\n");

    const p = s.plans()[0]!;
    assert.equal(p.verdict, "local");
    assert.equal(p.next, undefined, "there is nothing to write");
    s.run(s.plans());
    assert.match(s.read("org/guardrails.md"), /Pip's own rule/);
  } finally { s.cleanup(); }
});

test("a conflict never reaches the live file", () => {
  const s = scratch();
  try {
    s.base("org/voice.md", "# Voice\n\nthe original rule\n");
    s.template("org/voice.md", "# Voice\n\nthe framework's new rule\n");
    s.tenant("org/voice.md", "# Voice\n\nPip's incompatible rule\n");

    const p = s.plans()[0]!;
    assert.equal(p.verdict, "conflict");
    assert.ok((p.conflicts ?? 0) > 0);

    const code = s.run(s.plans());
    assert.equal(code, 1, "an unresolved conflict is a non-zero exit");
    assert.equal(s.read("org/voice.md"), "# Voice\n\nPip's incompatible rule\n",
      "the file an agent reads every morning must be untouched");
    assert.ok(s.has("org/voice.md.roster-merge"), "the merge goes beside it, for a human");
    const rej = s.read("org/voice.md.roster-merge");
    assert.match(rej, /<<<<<<</);
    assert.match(rej, /the original rule/, "--diff3 keeps what it used to say");
  } finally { s.cleanup(); }
});

test("a conflicted file keeps its old base, so it can still be merged next time", () => {
  // Advancing the base past an unresolved conflict silently discards the only thing that can
  // reconcile the file later, and the next upgrade would report it as unmergeable.
  const s = scratch();
  try {
    s.base("org/voice.md", "one\n");
    s.template("org/voice.md", "two\n");
    s.tenant("org/voice.md", "three\n");
    s.base("prompts/daily.md", "x\n");
    s.template("prompts/daily.md", "y\n");
    s.tenant("prompts/daily.md", "x\n");

    s.run(s.plans());
    assert.equal(readFileSync(join(s.seed, "org/voice.md"), "utf8"), "one\n",
      "the conflicted file's base must not move");
    assert.equal(readFileSync(join(s.seed, "prompts/daily.md"), "utf8"), "y\n",
      "the resolved one's must");
  } finally { s.cleanup(); }
});

test("editing a framework-owned file is called out, not silently merged away", () => {
  /* Exactly what happened with session.yaml: the eyes-reaction fix was applied to the
     tenant, where the next upgrade would have reverted it. */
  const s = scratch();
  try {
    s.base(".github/workflows/session.yaml", "steps:\n  - a\n");
    s.template(".github/workflows/session.yaml", "steps:\n  - a\n  - from the framework\n");
    s.tenant(".github/workflows/session.yaml", "steps:\n  - a patched in the tenant\n  - a\n");

    const p = s.plans()[0]!;
    assert.equal(p.kind, "managed");
    assert.equal(p.verdict, "edited-managed");
    assert.match(p.note, /move your change upstream/);
    // Still merged rather than clobbered: naming the mistake is not a licence to destroy work.
    s.run(s.plans());
    assert.match(s.read(".github/workflows/session.yaml"), /patched in the tenant/);
    assert.match(s.read(".github/workflows/session.yaml"), /from the framework/);
  } finally { s.cleanup(); }
});

test("without a base nothing is guessed at", () => {
  const s = scratch();
  try {
    s.template("org/voice.md", "new\n");
    s.tenant("org/voice.md", "different\n");

    const p = s.plans()[0]!;
    assert.equal(p.verdict, "no-base");
    assert.equal(p.next, undefined);
    assert.equal(s.run(s.plans()), 1);
    assert.equal(s.read("org/voice.md"), "different\n", "and nothing is overwritten");
  } finally { s.cleanup(); }
});

test("a file new in the framework is added", () => {
  const s = scratch();
  try {
    s.template("prompts/review.md", "a new fragment\n");
    const p = s.plans()[0]!;
    assert.equal(p.verdict, "added");
    s.run(s.plans());
    assert.equal(s.read("prompts/review.md"), "a new fragment\n");
    assert.equal(readFileSync(join(s.seed, "prompts/review.md"), "utf8"), "a new fragment\n");
  } finally { s.cleanup(); }
});

test("dotfiles are compared, which is how the reusable workflow got missed before", () => {
  const s = scratch();
  try {
    s.template(".github/workflows/session.yaml", "name: roster session\n");
    const plans = s.plans();
    assert.equal(plans.length, 1);
    assert.equal(plans[0]!.rel, ".github/workflows/session.yaml");
  } finally { s.cleanup(); }
});

test("ownership follows the org/prompts split the design already draws", () => {
  assert.equal(classify("org/voice.md"), "seeded");
  assert.equal(classify("prompts/daily.md"), "seeded");
  assert.equal(classify("compose.mjs"), "managed");
  assert.equal(classify("runner-plan.mjs"), "managed");
  assert.equal(classify(".github/workflows/session.yaml"), "managed");
});

test("merge3 reports the number of conflicts rather than throwing", () => {
  // Changes far enough apart to land in different hunks. Adjacent edits genuinely do conflict
  // in git, which is why the two edits here are separated by context rather than by one line.
  const base = ["one", "two", "three", "four", "five", "six", "seven", "eight"].join("\n") + "\n";
  const mine = base.replace("two", "MINE");
  const theirs = base.replace("seven", "THEIRS");

  const clean = merge3(mine, base, theirs);
  assert.equal(clean.conflicts, 0);
  assert.match(clean.text, /MINE/);
  assert.match(clean.text, /THEIRS/);

  const clash = merge3(base.replace("two", "MINE"), base, base.replace("two", "THEIRS"));
  assert.equal(clash.conflicts, 1);
  assert.match(clash.text, /<<<<<<< yours/);
  assert.match(clash.text, /the framework's/);
  assert.match(clash.text, /\|\|\|\|\|\|\| the version you started from/);
});

test("a framework file edited in the tenant is flagged before the framework moves", () => {
  /* The real case, replayed: on 2026-09-06 the eyes-reaction fix was committed to
     roster-ops/.github/workflows/session.yaml while templates/ops still had the old copy.
     Nothing was broken yet — base and template agreed — so a merge had nothing to say. The
     edit was one framework commit away from being reverted, and that is the moment worth
     catching, not the one after. */
  const s = scratch();
  try {
    s.base(".github/workflows/session.yaml", "steps:\n  - a\n");
    s.template(".github/workflows/session.yaml", "steps:\n  - a\n");
    s.tenant(".github/workflows/session.yaml", "steps:\n  - a\n  - react with eyes\n");

    const p = s.plans()[0]!;
    assert.equal(p.verdict, "edited-managed",
      "a local edit to a framework file is never merely 'yours to keep'");
    assert.match(p.note, /move your change upstream/);
    assert.equal(p.next, undefined, "there is nothing to write; the fix has to move, not merge");

    s.run(s.plans());
    assert.match(s.read(".github/workflows/session.yaml"), /react with eyes/,
      "and the tenant's file is left exactly as it was");
  } finally { s.cleanup(); }
});

test("the same edit to a seeded file is nobody's business", () => {
  const s = scratch();
  try {
    s.base("org/voice.md", "a\n");
    s.template("org/voice.md", "a\n");
    s.tenant("org/voice.md", "a\nPip's own line\n");
    assert.equal(s.plans()[0]!.verdict, "local");
  } finally { s.cleanup(); }
});
