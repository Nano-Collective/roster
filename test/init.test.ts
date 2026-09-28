import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { collect } from "../src/commands/doctor.js";
import { addToOrgYaml, buildPlan, wirePeers } from "../src/commands/hire.js";
import { initFiles } from "../src/commands/init.js";
import { findWorkspace, loadComposer, readOrg } from "../src/lib/workspace.js";

/**
 * The plan's own acceptance test for this phase: stand up a throwaway org end to end and hand
 * it nothing by hand. Everything except the GitHub calls happens here for real — the ops repo,
 * the first hire, the peer wiring, and then `doctor` over the result.
 *
 * What is not covered is the half that needs a browser and a human: creating the App and
 * granting it. That is stated in the help rather than pretended about.
 */

async function newOrg() {
  const root = mkdtempSync(join(tmpdir(), "roster-init-"));
  const opsDir = join(root, "roster-ops");
  for (const [rel, text] of await initFiles({
    org: "acme",
    name: "Acme Robotics",
    human: "someone",
    marker: "boss",
    opsName: "roster-ops",
  })) {
    const dest = join(opsDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, text);
  }
  return { root, opsDir };
}

test("a new tenant gets the machinery, the org layer and a recorded base", async () => {
  const files = await initFiles({
    org: "acme",
    name: "Acme",
    human: "someone",
    marker: "boss",
    opsName: "roster-ops",
  });
  for (const needed of [
    "org.yaml",
    "org/business.md",
    "org/voice.md",
    "org/guardrails.md",
    "org/operating.md",
    "compose.mjs",
    "runner-plan.mjs",
    ".github/workflows/session.yaml",
    ".roster-version",
  ]) {
    assert.ok(files.has(needed), `a tenant without ${needed} cannot run`);
  }
});

test("the org manifest a new tenant gets parses with the parser it ships with", async () => {
  const { root, opsDir } = await newOrg();
  try {
    const { parseYaml } = await loadComposer(opsDir);
    const org = readOrg(opsDir, parseYaml) as any;
    assert.equal(org.org, "acme");
    assert.equal(org.name, "Acme Robotics");
    assert.equal(org.human.github, "someone");
    assert.equal(org.human.marker, "boss");
    assert.deepEqual(org.staff, [], "nobody is hired yet, and that is a valid state");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("business.md is questions, not invented prose", async () => {
  /* The one file nothing can generate. An agent that does not know the business writes work
     that is plausible and generic, which takes longer to notice than no work at all. */
  const body = (
    await initFiles({
      org: "acme",
      name: "Acme",
      human: "s",
      marker: "s",
      opsName: "roster-ops",
    })
  ).get("org/business.md")!;
  assert.match(body, /stub/i);
  assert.match(body, /\/discover/, "it has to say how to fill it in");
  assert.match(body, /^## /m, "and it has to ask something");
  assert.ok(!/Acme is a leading/i.test(body), "it must not make anything up");
});

test("a brand new org can be hired into, and doctor is happy with the result", async () => {
  const { root, opsDir } = await newOrg();
  try {
    const ws = findWorkspace(opsDir);
    const { parseYaml } = await loadComposer(opsDir);
    const org = readOrg(opsDir, parseYaml) as any;

    // The first hire has no sibling to copy an identity from, so both are given explicitly —
    // which is exactly what the plan output tells a human to do.
    const plan = buildPlan(
      ws,
      org,
      "cto",
      {
        name: "Chief Technology Officer",
        dir: "technology",
        app: "acme-cto",
        publicApp: "acme-robot",
        statusIssue: 1,
      } as never,
      parseYaml,
    );

    const brain = join(root, "technology");
    for (const [rel, text] of plan.files) {
      const dest = join(brain, rel);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, text);
    }
    wirePeers(ws, plan, brain);
    addToOrgYaml(ws, plan);

    const health = (await collect({ offline: true, ops: opsDir }))!;
    const failures = health.findings.filter((f) => f.level === "fail");
    assert.deepEqual(
      failures.map((f) => `${f.scope}: ${f.title}`),
      [],
      "an org stood up from nothing must be coherent before anyone touches it",
    );

    const ids = new Set(health.findings.map((f) => f.id));
    assert.ok(ids.has("compose"), "and both prompts must compose");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the first hire is told it has no shared identity rather than being given a made-up one", async () => {
  const { root, opsDir } = await newOrg();
  try {
    const ws = findWorkspace(opsDir);
    const { parseYaml } = await loadComposer(opsDir);
    const org = readOrg(opsDir, parseYaml) as any;
    const flags = { name: "CTO", dir: "technology" } as never;
    org.repos = [...(org.repos ?? []), { name: "site", visibility: "public", role: "product" }];
    const plan = buildPlan(ws, org, "cto", flags, parseYaml);

    assert.ok(
      plan.warnings.some((w) => /no shared public identity.*site, which is public/.test(w)),
      "a silently invented app name would fail at token-minting time, in a scheduled run",
    );
    assert.ok(plan.warnings.some((w) => /no app slug could be inferred/.test(w)));

    /* The session clones and commits on a private product repo with the private token, so
       there the warning sent a first hire off to make an App nothing would use. */
    org.repos = org.repos.map((r: any) =>
      r.name === "site" ? { ...r, visibility: "private" } : r,
    );
    const quiet = buildPlan(ws, org, "cto", flags, parseYaml);
    assert.ok(!quiet.warnings.some((w) => /public identity/.test(w)), quiet.warnings.join("\n"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a second hire copies what the first one established", async () => {
  const { root, opsDir } = await newOrg();
  try {
    const ws = findWorkspace(opsDir);
    const { parseYaml } = await loadComposer(opsDir);

    const first = buildPlan(
      ws,
      readOrg(opsDir, parseYaml) as any,
      "cto",
      {
        name: "CTO",
        dir: "technology",
        app: "acme-cto",
        publicApp: "acme-robot",
        statusIssue: 1,
      } as never,
      parseYaml,
    );
    for (const [rel, text] of first.files) {
      const dest = join(root, "technology", rel);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, text);
    }
    addToOrgYaml(ws, first);

    const second = buildPlan(
      ws,
      readOrg(opsDir, parseYaml) as any,
      "cmo",
      { name: "CMO", dir: "marketing" } as never,
      parseYaml,
    );

    assert.equal(second.staff.app, "acme-cmo", "the house naming pattern is followed");
    assert.equal(
      second.staff.publicApp,
      "acme-robot",
      "and the shared identity is genuinely shared",
    );
    assert.deepEqual(
      second.peers.map((p) => p.handle),
      ["cto"],
    );
    assert.notEqual(
      second.staff.schedule,
      first.staff.schedule,
      "and they do not both start at once",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("choosing an agent brings its own boilerplate with it", async () => {
  /* The point of picking one in org.yaml: what that agent needs to run should arrive with it,
     with the parts only a person can supply marked as blanks rather than invented. */
  const files = await initFiles({
    org: "acme",
    name: "Acme",
    human: "someone",
    marker: "boss",
    opsName: "roster-ops",
    agent: "nanocoder",
  });

  const config = files.get("agents.config.json");
  assert.ok(config, "nanocoder cannot run without a provider, so one is scaffolded");
  assert.match(config, /\$\{NANOCODER_API_KEY\}/, "and the key is expanded, never stored");
  assert.match(config, /FILL IN/, "with the part only a person can answer marked");

  const org = files.get("org.yaml")!;
  assert.match(org, /permissions: full/, "and the level, which every agent understands");
  assert.match(org, /id: nanocoder/);
});

test("an agent that needs no config file gets none, and its own default model", async () => {
  const files = await initFiles({
    org: "acme",
    name: "Acme",
    human: "someone",
    marker: "boss",
    opsName: "roster-ops",
    agent: "codex",
  });
  assert.ok(!files.has("agents.config.json"), "codex configures itself from flags");
  assert.match(files.get("org.yaml")!, /model: gpt-5-codex/, "the preset's own default");
});

test("an agent nobody has heard of is refused with the list", async () => {
  await assert.rejects(
    initFiles({
      org: "acme",
      name: "Acme",
      human: "someone",
      marker: "boss",
      opsName: "roster-ops",
      agent: "not-an-agent",
    }),
    /unknown agent "not-an-agent"/,
  );
});

test("priorities.md ships as a stub, reaches the daily prompt, and doctor follows it", async () => {
  /* The shared direction. Tenant-owned like business.md, and optional in the prompt, so an org
     that predates it still composes and doctor says what is missing rather than failing. */
  const { root, opsDir } = await newOrg();
  try {
    const ws = findWorkspace(opsDir);
    const { parseYaml, compose } = await loadComposer(opsDir);
    const plan = buildPlan(
      ws,
      readOrg(opsDir, parseYaml) as any,
      "cto",
      {
        name: "CTO",
        dir: "technology",
        app: "acme-cto",
        publicApp: "acme-robot",
        statusIssue: 1,
      } as never,
      parseYaml,
    );
    const brain = join(root, "technology");
    for (const [rel, text] of plan.files) {
      mkdirSync(dirname(join(brain, rel)), { recursive: true });
      writeFileSync(join(brain, rel), text);
    }
    addToOrgYaml(ws, plan);

    const ids = async () =>
      new Set(
        (await collect({ offline: true, ops: opsDir }))!.findings.map((f) => `${f.level}:${f.id}`),
      );
    const daily = () => compose({ opsDir, brainsDir: root, staff: "cto", kind: "daily" });

    assert.ok((await ids()).has("warn:priorities.stub"), "the stub is noticed");
    assert.match(daily(), /What matters this month/, "and it is composed into the daily run");

    writeFileSync(
      join(opsDir, "org", "priorities.md"),
      "## What matters this month\n\n1. Ship the beta.\n",
    );
    assert.ok((await ids()).has("ok:priorities"));
    assert.match(daily(), /Ship the beta/);

    rmSync(join(opsDir, "org", "priorities.md"));
    assert.ok((await ids()).has("warn:priorities"), "an org without one is told, not failed");
    assert.doesNotMatch(daily(), /Ship the beta/, "and still composes");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
