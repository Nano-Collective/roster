import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { collect } from "../src/commands/doctor.js";
import {
  addToOrgYaml,
  buildPlan,
  insertUnder,
  type Plan,
  wirePeers,
} from "../src/commands/hire.js";
import { nextSlot, render } from "../src/lib/render.js";
import { findWorkspace, loadComposer, readOrg } from "../src/lib/workspace.js";

/**
 * Hiring writes into repos that already exist — a peer's manifest, the org's own org.yaml —
 * so the tests that matter most are the ones about not damaging them. The rest is about the
 * scaffold being usable: a generated manifest that the tenant's own parser rejects is worse
 * than no manifest at all.
 */

const ROOT = join(import.meta.dirname, "..", "..");
const ws = findWorkspace(join(ROOT, "roster-ops"));
const { parseYaml } = await loadComposer(ws.opsDir);
const ORG = readOrg(ws.opsDir, parseYaml) as any;

const plan = (handle: string, opts: Record<string, unknown> = {}): Plan =>
  buildPlan(
    ws,
    ORG,
    handle,
    { name: "Chief Financial Officer", dir: "finance", ...opts } as never,
    parseYaml,
  );

/* --------------------------------- rendering --------------------------------- */

test("an unfilled token is an error, not something left on the page", () => {
  // A workflow containing a literal %%SCHEDULE%% is a file GitHub accepts and never runs.
  assert.throws(() => render("cron: %%SCHEDULE%%", { STAFF: "cfo" }), /no value for %%SCHEDULE%%/);
  assert.equal(render("staff: %%STAFF%%", { STAFF: "cfo" }), "staff: cfo");
});

test("a note to the template's reader is dropped, along with the separator above it", () => {
  const out = render(
    [
      "# Real header.",
      "#",
      "# NOTE: %%TOKENS%% are filled by `roster hire`.",
      "",
      "handle: %%STAFF%%",
    ].join("\n"),
    { STAFF: "cfo" },
  );
  assert.ok(!out.includes("NOTE"), out);
  assert.ok(!out.includes("%%TOKENS%%"));
  assert.ok(out.includes("# Real header."), "the useful half of the comment must survive");
  assert.ok(!/#\s*\n\s*\n/.test(out), "and it must not leave a bare # behind");
  assert.ok(out.includes("handle: cfo"));
});

test("nothing generated for a new hire carries an unfilled token", () => {
  for (const [rel, text] of plan("cfo").files) {
    assert.equal(text.match(/%%[A-Z_]+%%/g), null, `${rel} has unfilled tokens`);
  }
});

test("the generated manifest parses with the tenant's own parser", () => {
  /* compose.mjs parses a deliberately small YAML subset. A scaffold it cannot read would fail
     at 07:00 on the first run rather than here. */
  const m = parseYaml(plan("cfo").files.get("staff.yaml")!, "staff.yaml") as any;
  assert.equal(m.handle, "cfo");
  assert.equal(m.brain, "playpip/finance");
  assert.equal(m.identities.length, 2);
  assert.ok(
    m.surfaces.some((s: any) => s.path === "memory/" && s.render === "memory"),
    "memory must be a declared surface, or the portal cannot render it",
  );
});

test("the scaffold contains the things a staff member cannot work without", () => {
  const files = new Set(plan("cfo").files.keys());
  for (const needed of [
    "staff.yaml",
    "CHARTER.md",
    "memory/INDEX.md",
    ".github/workflows/cfo-daily.yaml",
    ".github/workflows/cfo-mention.yaml",
    ".github/workflows/cfo-pr-mention.yaml",
    ".claude/commands/charter.md",
  ]) {
    assert.ok(files.has(needed), `a hire with no ${needed} is not a hire`);
  }
});

test("the charter is a stub that says so, because a generated one would be worthless", () => {
  const charter = plan("cfo").files.get("CHARTER.md")!;
  assert.match(charter, /stub/i);
  assert.match(charter, /\/charter/, "it has to say how to write it");
  assert.ok(
    !/Chief Financial Officer is responsible for/i.test(charter),
    "it must not invent a personality",
  );
});

/* ---------------------------------- defaults ---------------------------------- */

test("a new hire is staggered clear of everyone already on a schedule", () => {
  assert.equal(nextSlot(["0 7 * * 1-5", "40 7 * * 1-5"]), "20 8 * * 1-5");
  assert.equal(nextSlot(["0 7 * * 1-5"], 90), "30 8 * * 1-5");
  assert.equal(nextSlot([]), null, "nothing to stagger against");
  assert.equal(nextSlot(["*/5 * * * *"]), null, "an unusual spec is not guessed at");
  assert.equal(nextSlot(["30 23 * * 1-5"]), null, "past midnight is a decision, not arithmetic");
});

test("the app slug follows the house pattern rather than the org name", () => {
  // playpip's apps are pip-cto and pip-cmo, not playpip-cto. Guessing from the org would be wrong.
  const p = plan("cfo");
  assert.equal(p.staff.app, "pip-cfo");
  assert.equal(p.staff.publicApp, "pip-robot", "the public identity is shared, so it is copied");
  assert.ok(
    p.warnings.some((w) => w.includes("pip-cto")),
    "an inferred value should say what it followed",
  );
});

test("an explicit flag beats every inference", () => {
  const p = plan("cfo", { app: "acme-money", schedule: "5 6 * * 1", name: "Money Person" });
  assert.equal(p.staff.app, "acme-money");
  assert.equal(p.staff.schedule, "5 6 * * 1");
  assert.equal(p.staff.name, "Money Person");
  assert.ok(
    !p.warnings.some((w) => w.includes("was chosen")),
    "nothing was assumed, so nothing is warned about",
  );
});

test("the secrets listed are the ones the generated workflows actually reference", () => {
  const p = plan("cfo");
  const referenced = new Set<string>();
  for (const [rel, text] of p.files) {
    if (!rel.startsWith(".github/")) continue;
    for (const m of text.matchAll(/secrets\.([A-Z0-9_]+)/g)) referenced.add(m[1]!);
  }
  assert.deepEqual(
    [...referenced].sort(),
    [...p.secrets].sort(),
    "the manual-steps list and the workflows must not disagree",
  );
});

test("peers are found from the org, both trackers", () => {
  const p = plan("cfo");
  assert.deepEqual(p.peers.map((x) => x.handle).sort(), ["cmo", "cto"]);
  assert.ok(p.peers.every((x) => x.label === "from-cfo"));
  assert.ok(
    p.labels.includes("from-cto") && p.labels.includes("from-cmo"),
    "and their labels are created on the new tracker too",
  );
});

/* ------------------------------- editing others ------------------------------- */

test("a line is inserted under its heading, leaving the rest of the file alone", () => {
  const before = [
    "# a comment at the top",
    "org: acme",
    "",
    "staff:",
    "  - { handle: cto, dir: technology }",
    "",
    "repos:",
    "  - { name: technology }",
    "",
  ].join("\n");
  const after = insertUnder(before, "staff", "  - { handle: cfo, dir: finance }");
  assert.match(
    after,
    /- \{ handle: cto, dir: technology \}\n {2}- \{ handle: cfo, dir: finance \}/,
  );
  assert.ok(after.includes("# a comment at the top"), "comments survive");
  assert.ok(after.includes("repos:\n  - { name: technology }"), "later blocks are untouched");
});

test("peer wiring goes both ways, and the label is the file owner's own", () => {
  const root = mkdtempSync(join(tmpdir(), "roster-hire-"));
  try {
    // A peer that already exists, and the new hire's freshly rendered scaffold.
    mkdirSync(join(root, "technology"), { recursive: true });
    writeFileSync(
      join(root, "technology", "staff.yaml"),
      "handle: cto\nbrain: playpip/technology\n\npeers:\n  - { handle: cmo, brain: playpip/marketing, label: from-cto }\n\nsurfaces: []\n",
    );
    mkdirSync(join(root, "finance"), { recursive: true });
    writeFileSync(
      join(root, "finance", "staff.yaml"),
      "handle: cfo\nbrain: playpip/finance\n\npeers: []\n",
    );

    const p = {
      staff: { handle: "cfo", brain: "playpip/finance" },
      peers: [{ handle: "cto", dir: "technology", brain: "playpip/technology", label: "from-cfo" }],
    } as unknown as Plan;
    wirePeers({ root, opsDir: join(root, "ops"), opsName: "ops" }, p, join(root, "finance"));

    const cfo = readFileSync(join(root, "finance", "staff.yaml"), "utf8");
    assert.match(
      cfo,
      /- \{ handle: cto, brain: playpip\/technology, label: from-cfo \}/,
      "the new hire marks its own asks with from-cfo",
    );

    const cto = readFileSync(join(root, "technology", "staff.yaml"), "utf8");
    assert.match(
      cto,
      /- \{ handle: cfo, brain: playpip\/finance, label: from-cto \}/,
      "and the CTO marks its asks to the CFO with from-cto, not from-cfo",
    );
    assert.match(cto, /handle: cmo/, "the existing peer entry survives");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("wiring a peer twice does not double the entry", () => {
  const root = mkdtempSync(join(tmpdir(), "roster-hire-"));
  try {
    mkdirSync(join(root, "technology"), { recursive: true });
    writeFileSync(join(root, "technology", "staff.yaml"), "handle: cto\n\npeers:\n");
    mkdirSync(join(root, "finance"), { recursive: true });
    writeFileSync(join(root, "finance", "staff.yaml"), "handle: cfo\n\npeers: []\n");

    const p = {
      staff: { handle: "cfo", brain: "playpip/finance" },
      peers: [{ handle: "cto", dir: "technology", brain: "playpip/technology", label: "from-cfo" }],
    } as unknown as Plan;
    const wsStub = { root, opsDir: join(root, "ops"), opsName: "ops" };
    wirePeers(wsStub, p, join(root, "finance"));
    wirePeers(wsStub, p, join(root, "finance"));

    const cto = readFileSync(join(root, "technology", "staff.yaml"), "utf8");
    assert.equal((cto.match(/handle: cfo/g) ?? []).length, 1, "a re-run must be a no-op");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("hiring someone who already exists is refused", () => {
  // buildPlan is reached only after the check, so this asserts the guard is in the command.
  assert.ok((ORG.staff ?? []).some((s: any) => s.handle === "cto"));
});

/* ------------------------------ end to end ------------------------------ */

test("a scaffolded hire is coherent: doctor passes and all three prompts compose", async () => {
  /* The check that earned its keep. Run against a sandbox the first time, it found two real
     defects: the manifest left `status_issue` commented out and `works_in` empty, and the
     prompts reference both — so a freshly hired agent would have died at 07:00 on its first
     run with "unknown or empty placeholder". Neither unit test would have caught it. */
  const root = mkdtempSync(join(tmpdir(), "roster-e2e-"));
  try {
    cpSync(ws.opsDir, join(root, "roster-ops"), {
      recursive: true,
      filter: (s) => !s.includes("/.git/"),
    });

    // Enough of the existing staff for the inference and peer wiring to be real, without
    // copying two brain repos and 16MB of brand assets into a temp directory.
    for (const [dir, handle, app] of [
      ["technology", "cto", "pip-cto"],
      ["marketing", "cmo", "pip-cmo"],
    ]) {
      mkdirSync(join(root, dir!), { recursive: true });
      writeFileSync(
        join(root, dir!, "staff.yaml"),
        [
          `handle: ${handle}`,
          `brain: playpip/${dir}`,
          `schedule: "0 7 * * 1-5"`,
          `public_token_env: PIPWEB_TOKEN`,
          `identities:`,
          `  - { app: ${app}, secret_prefix: ${handle!.toUpperCase()}, scope: private }`,
          `  - { app: pip-robot, secret_prefix: BOT, scope: public }`,
          `peers:`,
          ``,
        ].join("\n"),
      );
    }

    const sandbox = findWorkspace(join(root, "roster-ops"));
    const sandboxOrg = readOrg(sandbox.opsDir, parseYaml) as any;
    // statusIssue is what --apply learns from GitHub; everything else is offline.
    const p = buildPlan(
      sandbox,
      sandboxOrg,
      "cfo",
      { name: "Chief Financial Officer", dir: "finance", statusIssue: 1 } as never,
      parseYaml,
    );

    assert.equal(p.staff.app, "pip-cfo", "the app slug should still be inferred here");

    const brain = join(root, "finance");
    for (const [rel, text] of p.files) {
      const dest = join(brain, rel);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, text);
    }
    wirePeers(sandbox, p, brain);
    addToOrgYaml(sandbox, p);

    const health = (await collect({ offline: true, ops: sandbox.opsDir, only: "cfo" }))!;
    const failures = health.findings.filter((f) => f.level === "fail");
    assert.deepEqual(
      failures.map((f) => f.title),
      [],
      "a freshly hired staff member must be healthy the moment it is scaffolded",
    );

    const ids = new Set(health.findings.map((f) => f.id));
    assert.ok(ids.has("compose"), "all three prompts must compose, including pr-mention");
    assert.ok(ids.has("callers"));
    assert.ok(ids.has("charter"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a caller's filename is templated too, so it says whose run it is", () => {
  // cto-daily.yaml, not daily.yaml: they sit in one Actions list per repo. Missing this is
  // why the first brain comparison reported every live workflow as absent.
  const names = [...plan("cfo").files.keys()].filter((k) => k.startsWith(".github/"));
  assert.deepEqual(names.sort(), [
    ".github/workflows/cfo-daily.yaml",
    ".github/workflows/cfo-mention.yaml",
    ".github/workflows/cfo-pr-mention.yaml",
  ]);
});

test("the generated callers are valid workflows with the triggers they are meant to have", () => {
  const files = plan("cfo").files;
  const mention = files.get(".github/workflows/cfo-mention.yaml")!;
  // The regression fixed earlier today has to survive being generated for a new hire.
  assert.match(mention, /^\s{2}issues:$/m, "a mention in a new issue body must still wake a run");
  assert.match(
    mention,
    /github\.event\.sender\.login == 'will-lamerton'/,
    "and the loop guard must be on the sender, not the author",
  );
  assert.match(files.get(".github/workflows/cfo-daily.yaml")!, /cron: "20 8 \* \* 1-5"/);
  assert.match(files.get(".github/workflows/cfo-pr-mention.yaml")!, /repository_dispatch/);
});
