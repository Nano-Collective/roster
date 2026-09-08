import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { AGENTS, setupStatus } from "../src/lib/setup.js";
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
    assert.ok(preset.label.trim() && preset.note.trim(), `${preset.id} is unexplained`);
  }
  assert.equal(AGENTS[0]!.id, "claude-code-action", "the reference runner should be first");
});
