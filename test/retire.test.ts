import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  buildRetirePlan,
  removeFromOrgYaml,
  removeOrgLines,
  removePeerLine,
} from "../src/commands/retire.js";
import { loadComposer } from "../src/lib/workspace.js";
import { testWorkspace } from "./helpers/workspace.js";

/**
 * Retiring is the destructive-looking operation that must not destroy anything. What the tests
 * are for is the two ways it could quietly do the wrong thing: touching the repo it promised
 * to keep, and deleting the wrong label from the wrong repo.
 */

const REAL_OPS = (await testWorkspace()).opsDir;
const { parseYaml } = await loadComposer(REAL_OPS);

const ORG_YAML = `org: acme
name: Acme

human: { github: ada, marker: ada }

staff:
  - { handle: cto, dir: technology, name: Chief Technology Officer, schedule: "0 7 * * 1-5" }
  - { handle: cmo, dir: marketing, name: Chief Marketing Officer, schedule: "0 8 * * 1-5" }

repos:
  # a comment nobody should lose
  - { name: technology, visibility: private, role: brain }
  - { name: marketing, visibility: private, role: brain }
  - { name: product, visibility: public, role: product }
`;

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "roster-retire-"));
  const opsDir = join(root, "roster-ops");
  mkdirSync(opsDir, { recursive: true });
  writeFileSync(join(opsDir, "org.yaml"), ORG_YAML);

  const brains: Array<[string, string, string]> = [
    ["technology", "cto", "cmo"],
    ["marketing", "cmo", "cto"],
  ];
  for (const [dir, handle, peer] of brains) {
    mkdirSync(join(root, dir, ".github", "workflows"), { recursive: true });
    mkdirSync(join(root, dir, "memory"), { recursive: true });
    writeFileSync(
      join(root, dir, "staff.yaml"),
      `handle: ${handle}\nbrain: acme/${dir}\npeers:\n` +
        `  - { handle: ${peer}, brain: acme/${peer === "cto" ? "technology" : "marketing"}, label: from-${handle} }\n`,
    );
    writeFileSync(
      join(root, dir, "memory", "INDEX.md"),
      "- **`a-fact`** · [will] It is so. **So:** act.\n- **`b-fact`** · [will] Also so. **So:** act.\n",
    );
    for (const kind of ["daily", "mention"]) {
      writeFileSync(join(root, dir, ".github", "workflows", `${handle}-${kind}.yaml`), "on: {}\n");
    }
  }
  return { root, opsDir, opsName: "roster-ops" };
}

const org = () => parseYaml(ORG_YAML, "org.yaml") as any;

test("the plan says what stops and what is kept", () => {
  const ws = workspace();
  const plan = buildRetirePlan(ws, org(), "cmo", parseYaml);

  assert.equal(plan.name, "Chief Marketing Officer");
  assert.equal(plan.brain, "acme/marketing");
  assert.deepEqual(plan.workflows, ["cmo-daily.yaml", "cmo-mention.yaml"]);
  assert.ok(
    plan.keeps.some((k) => k.includes("acme/marketing")),
    "the repo it is keeping has to be named: " + plan.keeps.join(" | "),
  );
  assert.ok(
    plan.keeps.some((k) => /2 facts/.test(k)),
    "and what is in it, so the size of what survives is visible: " + plan.keeps.join(" | "),
  );
});

test("the label it deletes lives on the peer's repo, not the retiree's", () => {
  /* Got this backwards first time. `from-cmo` is the label the CMO uses to file work on the
     CTO's tracker, so it lives on the CTO's repo. Retiring the CMO deletes that one. The
     `from-cto` label on the CMO's own repo is on a repo this command does not touch. */
  const ws = workspace();
  const plan = buildRetirePlan(ws, org(), "cmo", parseYaml);

  assert.equal(plan.peers.length, 1);
  const [peer] = plan.peers;
  assert.equal(peer!.handle, "cto");
  assert.equal(peer!.brain, "acme/technology", "the peer's repo is where the label is");
  assert.equal(peer!.label, "from-cmo", "and the label is the retiree's, not the peer's");
});

test("org.yaml loses both their lines and keeps everything else", () => {
  const ws = workspace();
  removeFromOrgYaml(ws, buildRetirePlan(ws, org(), "cmo", parseYaml));
  const after = readFileSync(join(ws.opsDir, "org.yaml"), "utf8");

  assert.ok(!/handle: cmo/.test(after), "the staff entry goes");
  assert.ok(!/name: marketing/.test(after), "and so does the repo entry");
  assert.ok(/handle: cto/.test(after), "the other staff member stays");
  assert.ok(/name: product/.test(after), "and so does a repo that is not a brain");
  assert.ok(/a comment nobody should lose/.test(after), "and every comment");
});

test("a product repo that shares a name with nothing is not mistaken for a brain", () => {
  // The repo line is only removed when it is both the right name and role: brain.
  const text = "repos:\n  - { name: cmo, visibility: public, role: product }\n";
  assert.equal(removeOrgLines(text, "cmo", "cmo"), text);
});

test("a peer's manifest loses only that entry", () => {
  const text =
    "peers:\n" +
    "  - { handle: cmo, brain: acme/marketing, label: from-cto }\n" +
    "  - { handle: cfo, brain: acme/finance, label: from-cto }\n";
  const after = removePeerLine(text, "cmo");
  assert.ok(!after.includes("handle: cmo"));
  assert.ok(after.includes("handle: cfo"), "the other peer stays");
});

test("nothing in the plan touches the retiree's own repo", () => {
  /* The promise of retiring is that the memory survives. A plan that names their repo as
     something to change is the bug this exists to prevent. */
  const ws = workspace();
  const plan = buildRetirePlan(ws, org(), "cmo", parseYaml);
  for (const p of plan.peers) {
    assert.notEqual(p.dir, plan.dir, "a peer must never be the retiree");
    assert.notEqual(p.brain, plan.brain, "and never their repo");
  }
});

test("a staff member with no checkout still produces a plan, and says so", () => {
  const ws = workspace();
  const withGhost = {
    ...org(),
    staff: [...org().staff, { handle: "cfo", dir: "finance", name: "Chief Financial Officer" }],
  };
  const plan = buildRetirePlan(ws, withGhost, "cfo", parseYaml);
  assert.deepEqual(plan.workflows, []);
  assert.ok(
    plan.warnings.some((w) => /not checked out/.test(w)),
    "expected a warning: " + plan.warnings.join(" | "),
  );
});
