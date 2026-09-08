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

function newOrg() {
  const root = mkdtempSync(join(tmpdir(), "roster-init-"));
  const opsDir = join(root, "roster-ops");
  for (const [rel, text] of initFiles({
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

test("a new tenant gets the machinery, the org layer and a recorded base", () => {
  const files = initFiles({
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
  const { root, opsDir } = newOrg();
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

test("business.md is questions, not invented prose", () => {
  /* The one file nothing can generate. An agent that does not know the business writes work
     that is plausible and generic, which takes longer to notice than no work at all. */
  const body = initFiles({
    org: "acme",
    name: "Acme",
    human: "s",
    marker: "s",
    opsName: "roster-ops",
  }).get("org/business.md")!;
  assert.match(body, /stub/i);
  assert.match(body, /\/discover/, "it has to say how to fill it in");
  assert.match(body, /^## /m, "and it has to ask something");
  assert.ok(!/Acme is a leading/i.test(body), "it must not make anything up");
});

test("a brand new org can be hired into, and doctor is happy with the result", async () => {
  const { root, opsDir } = newOrg();
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
  const { root, opsDir } = newOrg();
  try {
    const ws = findWorkspace(opsDir);
    const { parseYaml } = await loadComposer(opsDir);
    const org = readOrg(opsDir, parseYaml) as any;
    const plan = buildPlan(ws, org, "cto", { name: "CTO", dir: "technology" } as never, parseYaml);

    assert.ok(
      plan.warnings.some((w) => /no shared public identity/.test(w)),
      "a silently invented app name would fail at token-minting time, in a scheduled run",
    );
    assert.ok(plan.warnings.some((w) => /no app slug could be inferred/.test(w)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a second hire copies what the first one established", async () => {
  const { root, opsDir } = newOrg();
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
