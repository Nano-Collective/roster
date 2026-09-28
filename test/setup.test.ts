import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { businessStub, prioritiesStub } from "../src/commands/init.js";
import { AGENTS, setupStatus, unfinished } from "../src/lib/setup.js";
import { tryWorkspace } from "../src/lib/workspace.js";
import { makeTenant } from "./helpers/tenant.js";

/**
 * What the setup screen reads before it offers anything.
 *
 * The clone half of joining an org is exercised by the smoke test rather than here: it takes a
 * real repository and a network, and a test that faked both would only prove the fake works.
 */

const empty = mkdtempSync(join(tmpdir(), "roster-setup-empty-"));
const withTenant = mkdtempSync(join(tmpdir(), "roster-setup-tenant-"));
await makeTenant(withTenant, { org: "acme" });

after(() => {
  rmSync(empty, { recursive: true, force: true });
  rmSync(withTenant, { recursive: true, force: true });
});

test("an empty directory is a setup, not an error", async () => {
  assert.equal(tryWorkspace(empty), null, "tryWorkspace must answer rather than throw");
  const status = await setupStatus(empty);
  assert.equal(status.tenant.found, false);
  assert.equal(status.startedIn, empty, "the page has to say where it would put things");
});

test("a directory that already holds a tenant is recognised, with its repos", async () => {
  const status = await setupStatus(withTenant);
  assert.equal(status.tenant.found, true);
  assert.equal(status.tenant.org, "acme");
  assert.ok(status.tenant.repos?.includes("roster-ops"));
  assert.ok(status.tenant.repos?.includes("cto"), "a hire should be listed as a repo");
  assert.ok(status.tenant.left, "what is left travels with the status");
  assert.ok(
    !status.tenant.left.includes("hire"),
    "a tenant with a staff member has hired: " + status.tenant.left,
  );
});

test("the repo list is scoped to the block repos: introduces", async () => {
  /* A staff entry opens with `handle:` today, so a looser pattern happens to work and would
     stop the day somebody reorders the keys. This is the test that would catch that. */
  const path = join(withTenant, "roster-ops", "org.yaml");
  writeFileSync(
    path,
    [
      "org: acme",
      "staff:",
      "  - { name: Chief Technology Officer, handle: cto, dir: cto }",
      "repos:",
      "  - { name: roster-ops, visibility: private, role: ops }",
      "  - { name: the-product, visibility: public, role: product }",
      "",
    ].join("\n"),
  );
  const status = await setupStatus(withTenant);
  assert.deepEqual(status.tenant.repos, ["roster-ops", "the-product"]);
});

test("every agent preset names the secret it needs", () => {
  // Setup promises to name the credential exactly rather than saying "it depends".
  assert.ok(AGENTS.length >= 4);
  for (const preset of AGENTS) {
    assert.match(preset.tokenEnv, /^[A-Z][A-Z0-9_]+$/, `${preset.id} has no usable secret name`);
    assert.ok(preset.label.trim(), `${preset.id} has no label`);
  }
  assert.equal(AGENTS[0]!.id, "claude-code-action", "the reference runner should be first");
});

test("what is left is read off disk, and a written file drops off the list", () => {
  /* The portal offers Getting started while this is non-empty, so a stub that read as written
     would hide setup with the work still undone, and the reverse would never let it go. */
  const ops = mkdtempSync(join(tmpdir(), "roster-setup-left-"));
  try {
    mkdirSync(join(ops, "org"));
    assert.deepEqual(unfinished(ops, 0), ["hire", "business", "priorities"], "absent is unwritten");

    writeFileSync(join(ops, "org", "business.md"), businessStub("Acme", "acme"));
    writeFileSync(join(ops, "org", "priorities.md"), prioritiesStub());
    assert.deepEqual(
      unfinished(ops, 1),
      ["business", "priorities"],
      "the shipped stubs are not done",
    );

    writeFileSync(join(ops, "org", "business.md"), "# Acme\n\nWe sell poker lessons.\n");
    assert.deepEqual(unfinished(ops, 1), ["priorities"]);
    writeFileSync(join(ops, "org", "priorities.md"), "## This month\n\n1. Ship the course.\n");
    assert.deepEqual(
      unfinished(ops, 2),
      [],
      "nothing left once both are written and someone is hired",
    );
  } finally {
    rmSync(ops, { recursive: true, force: true });
  }
});
