import assert from "node:assert/strict";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { apply, type FilePlan, planAll, planBrains } from "../src/commands/upgrade.js";
import { merge3 } from "../src/lib/merge.js";
import { classify } from "../src/lib/templates.js";
import { findWorkspace, loadComposer } from "../src/lib/workspace.js";

/**
 * Upgrading is the one operation that can silently destroy a tenant's work, so these tests
 * care about two things above all: a local edit is never lost, and a conflict never reaches a
 * live file. Agents read org/voice.md at every boot; conflict markers in it would land in
 * every prompt.
 */

function scratch() {
  const root = mkdtempSync(join(tmpdir(), "roster-upgrade-"));
  const dirs = {
    tpl: join(root, "tpl"),
    seed: join(root, "ops", ".roster", "seed"),
    ops: join(root, "ops"),
  };
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

const VOICE = [
  "# Voice",
  "",
  "Concision, not word counts.",
  "",
  "Orwell's rules are the guide.",
].join("\n");

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
  } finally {
    s.cleanup();
  }
});

test("a local edit survives an unrelated framework change", () => {
  // The case the whole command exists for: Pip's voice.md carries its own additions.
  const s = scratch();
  try {
    s.base("org/voice.md", VOICE + "\n");
    s.template(
      "org/voice.md",
      "# Voice\n\nConcision, not word counts.\n\nOrwell's rules are the guide.\nNo adverbs.\n",
    );
    s.tenant(
      "org/voice.md",
      "# Voice\n\nPip never says 'leverage'.\n\nConcision, not word counts.\n\nOrwell's rules are the guide.\n",
    );

    const p = s.plans()[0]!;
    assert.equal(p.verdict, "merged", p.note);
    s.run(s.plans());

    const out = s.read("org/voice.md");
    assert.match(out, /Pip never says/, "the tenant's line must survive");
    assert.match(out, /No adverbs/, "and the framework's must arrive");
    assert.ok(!out.includes("<<<<<<<"), "a clean merge must not carry markers");
  } finally {
    s.cleanup();
  }
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
  } finally {
    s.cleanup();
  }
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
    assert.equal(
      s.read("org/voice.md"),
      "# Voice\n\nPip's incompatible rule\n",
      "the file an agent reads every morning must be untouched",
    );
    assert.ok(s.has("org/voice.md.roster-merge"), "the merge goes beside it, for a human");
    const rej = s.read("org/voice.md.roster-merge");
    assert.match(rej, /<<<<<<</);
    assert.match(rej, /the original rule/, "--diff3 keeps what it used to say");
  } finally {
    s.cleanup();
  }
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
    assert.equal(
      readFileSync(join(s.seed, "org/voice.md"), "utf8"),
      "one\n",
      "the conflicted file's base must not move",
    );
    assert.equal(
      readFileSync(join(s.seed, "prompts/daily.md"), "utf8"),
      "y\n",
      "the resolved one's must",
    );
  } finally {
    s.cleanup();
  }
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
  } finally {
    s.cleanup();
  }
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
  } finally {
    s.cleanup();
  }
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
  } finally {
    s.cleanup();
  }
});

test("dotfiles are compared, which is how the reusable workflow got missed before", () => {
  const s = scratch();
  try {
    s.template(".github/workflows/session.yaml", "name: roster session\n");
    const plans = s.plans();
    assert.equal(plans.length, 1);
    assert.equal(plans[0]!.rel, ".github/workflows/session.yaml");
  } finally {
    s.cleanup();
  }
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
    assert.equal(
      p.verdict,
      "edited-managed",
      "a local edit to a framework file is never merely 'yours to keep'",
    );
    assert.match(p.note, /move your change upstream/);
    assert.equal(p.next, undefined, "there is nothing to write; the fix has to move, not merge");

    s.run(s.plans());
    assert.match(
      s.read(".github/workflows/session.yaml"),
      /react with eyes/,
      "and the tenant's file is left exactly as it was",
    );
  } finally {
    s.cleanup();
  }
});

test("the same edit to a seeded file is nobody's business", () => {
  const s = scratch();
  try {
    s.base("org/voice.md", "a\n");
    s.template("org/voice.md", "a\n");
    s.tenant("org/voice.md", "a\nPip's own line\n");
    assert.equal(s.plans()[0]!.verdict, "local");
  } finally {
    s.cleanup();
  }
});

/* ------------------------------ brain repos ------------------------------ */

function brainWorkspace() {
  const root = mkdtempSync(join(tmpdir(), "roster-brain-"));
  const ops = join(root, "roster-ops");
  mkdirSync(ops, { recursive: true });
  copyFileSync(
    join(import.meta.dirname, "..", "templates", "ops", "compose.mjs"),
    join(ops, "compose.mjs"),
  );
  writeFileSync(
    join(ops, "org.yaml"),
    [
      "org: acme",
      "name: Acme",
      "human:",
      "  github: someone",
      "  marker: boss",
      "staff:",
      "  - { handle: cto, dir: technology, name: Chief Technology Officer }",
      "repos:",
      "  - { name: product, visibility: public, role: product }",
    ].join("\n") + "\n",
  );
  return { root, ops };
}

function writeManifest(root: string, extra: string[] = []) {
  mkdirSync(join(root, "technology"), { recursive: true });
  writeFileSync(
    join(root, "technology", "staff.yaml"),
    [
      "handle: cto",
      "name: Chief Technology Officer",
      'mention: "@cto"',
      "brain: acme/technology",
      "status_issue: 15",
      'schedule: "0 7 * * 1-5"',
      "model: claude-opus-5",
      "timeout_minutes: 60",
      "public_token_env: PRODUCT_TOKEN",
      "identities:",
      "  - { app: acme-cto, secret_prefix: CTO, scope: private }",
      "  - { app: acme-robot, secret_prefix: BOT, scope: public }",
      "works_in:",
      "  - { repo: acme/product, role: contributor, checkout: true }",
      "peers: []",
      "surfaces:",
      "  - { path: memory/, render: memory }",
      ...extra,
    ].join("\n") + "\n",
  );
}

test("a caller that matches the template is left alone", async () => {
  const { root, ops } = brainWorkspace();
  try {
    writeManifest(root);
    const ws = findWorkspace(ops);
    const { parseYaml } = await loadComposer(ops);
    const [brain] = planBrains(ws, parseYaml);

    // Write exactly what the plan says the callers should be, then re-plan.
    for (const f of brain!.files) {
      if (f.next === undefined) continue;
      const dest = join(brain!.root, f.rel);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, f.next);
    }
    const [again] = planBrains(ws, parseYaml);
    assert.deepEqual(
      again!.files.filter((f) => f.verdict !== "same").map((f) => f.rel),
      [],
      "a freshly generated brain must be idempotent under upgrade",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a value that lives in the manifest is never mistaken for drift", async () => {
  /* The trap this was written to avoid. The CTO's daily ceiling is 90 while the org default is
     60, so a renderer reading org.yaml would report a deliberate change as something to
     revert — and `upgrade --apply` would quietly put the timeouts back. */
  const { root, ops } = brainWorkspace();
  try {
    writeManifest(root);
    const ws = findWorkspace(ops);
    const { parseYaml } = await loadComposer(ops);
    for (const f of planBrains(ws, parseYaml)[0]!.files) {
      if (f.next === undefined) continue;
      const dest = join(brainRoot(root), f.rel);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, f.next);
    }

    // Raise the ceiling the way a human would: in the manifest and the caller together.
    const mf = join(root, "technology", "staff.yaml");
    writeFileSync(
      mf,
      readFileSync(mf, "utf8").replace("timeout_minutes: 60", "timeout_minutes: 90"),
    );
    const daily = join(brainRoot(root), ".github", "workflows", "cto-daily.yaml");
    writeFileSync(
      daily,
      readFileSync(daily, "utf8").replace("timeout_minutes: 60", "timeout_minutes: 90"),
    );

    const [after] = planBrains(ws, parseYaml);
    const dailyPlan = after!.files.find((f) => f.rel.endsWith("cto-daily.yaml"))!;
    assert.equal(
      dailyPlan.verdict,
      "same",
      "a manifest value must render into both sides and cancel, not read as drift",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a caller the framework has dropped is removed, not left to fail at run time", async () => {
  /* pr-mention was removed from the framework. A tenant that upgraded and kept the workflow
     would have a route that still dispatches into session.yaml with a kind that no longer
     composes: worse than absent, because it fails several minutes into a run instead. */
  const { root, ops } = brainWorkspace();
  try {
    writeManifest(root);
    const stale = join(brainRoot(root), ".github", "workflows", "cto-pr-mention.yaml");
    mkdirSync(dirname(stale), { recursive: true });
    writeFileSync(
      stale,
      ["jobs:", "  amend:", "    uses: acme/roster-ops/.github/workflows/session.yaml@main"].join(
        "\n",
      ),
    );
    // Something of the staff member's own, in the same directory, that is nobody's business.
    const theirs = join(brainRoot(root), ".github", "workflows", "cto-something-custom.yaml");
    writeFileSync(theirs, "on: workflow_dispatch\njobs: {}\n");

    const ws = findWorkspace(ops);
    const { parseYaml } = await loadComposer(ops);
    const [plan] = planBrains(ws, parseYaml);

    const gone = plan!.files.find((f) => f.rel.endsWith("cto-pr-mention.yaml"));
    assert.equal(gone?.verdict, "obsolete", "a dropped caller is reported");
    assert.equal(gone?.next, undefined, "and there is nothing to write in its place");
    assert.ok(
      !plan!.files.some((f) => f.rel.endsWith("cto-something-custom.yaml")),
      "a workflow that does not call the ops repo is the staff member's own, and is left alone",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("raising the daily ceiling does not drag the mention ceiling with it", async () => {
  // They shared %%TIMEOUT%% and had only ever coincided at 60, which hid the coupling.
  const { root, ops } = brainWorkspace();
  try {
    writeManifest(root);
    const mf = join(root, "technology", "staff.yaml");
    writeFileSync(
      mf,
      readFileSync(mf, "utf8").replace("timeout_minutes: 60", "timeout_minutes: 90"),
    );
    const ws = findWorkspace(ops);
    const { parseYaml } = await loadComposer(ops);
    const files = planBrains(ws, parseYaml)[0]!.files;

    const text = (name: string) => files.find((f) => f.rel.endsWith(name))!.next!;
    assert.match(text("cto-daily.yaml"), /timeout_minutes: 90/);
    assert.match(text("cto-mention.yaml"), /timeout_minutes: 30/, "a mention is not a session");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the files a staff member owns are never rewritten", async () => {
  const { root, ops } = brainWorkspace();
  try {
    writeManifest(root);
    const brainDir = brainRoot(root);
    mkdirSync(join(brainDir, "memory"), { recursive: true });
    // What a working agent's memory index looks like: nothing like the template.
    writeFileSync(
      join(brainDir, "memory", "INDEX.md"),
      "# Memory index\n\n- **`a-fact`** · it is so. **So:** it matters.\n",
    );
    writeFileSync(join(brainDir, "CHARTER.md"), "# Charter\n\nEntirely rewritten by hand.\n");

    const ws = findWorkspace(ops);
    const { parseYaml } = await loadComposer(ops);
    const files = planBrains(ws, parseYaml)[0]!.files;

    for (const owned of ["memory/INDEX.md", "CHARTER.md"]) {
      assert.equal(
        files.find((f) => f.rel === owned),
        undefined,
        `${owned} belongs to the staff member and must not appear in a plan at all`,
      );
    }
    assert.ok(
      files.some((f) => f.rel.endsWith("cto-daily.yaml")),
      "the callers still do",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a template change to a caller shows up, with the diff", async () => {
  const { root, ops } = brainWorkspace();
  try {
    writeManifest(root);
    const ws = findWorkspace(ops);
    const { parseYaml } = await loadComposer(ops);
    for (const f of planBrains(ws, parseYaml)[0]!.files) {
      if (f.next === undefined) continue;
      const dest = join(brainRoot(root), f.rel);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, f.next);
    }
    // Someone edits a generated caller by hand, which is the thing that must not go quietly.
    const daily = join(brainRoot(root), ".github", "workflows", "cto-daily.yaml");
    writeFileSync(
      daily,
      readFileSync(daily, "utf8").replace("workflow_dispatch:", "workflow_dispatch: # tweaked"),
    );

    const plan = planBrains(ws, parseYaml)[0]!.files.find((f) => f.rel.endsWith("cto-daily.yaml"))!;
    assert.equal(plan.verdict, "regenerate");
    assert.ok(plan.diff?.includes("tweaked"), "the diff must show what would be lost");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a staff member with no manifest is reported, not skipped or crashed on", async () => {
  const { root, ops } = brainWorkspace();
  try {
    const [brain] = planBrains(findWorkspace(ops), (await loadComposer(ops)).parseYaml);
    assert.match(brain!.problem ?? "", /not checked out|no staff.yaml/);
    assert.deepEqual(brain!.files, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** The brain repo inside a scratch workspace. */
function brainRoot(root: string): string {
  return join(root, "technology");
}
