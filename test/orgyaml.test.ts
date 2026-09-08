import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { isWritable, validateOrgYaml } from "../src/lib/prompt.js";
import { loadComposer } from "../src/lib/workspace.js";

/**
 * `org.yaml` is the one file the portal writes that stops every prompt composing when it is
 * wrong, rather than just reading oddly. So it is writable, and checked first.
 */

const { parseYaml } = await loadComposer(join(import.meta.dirname, "..", "..", "roster-ops"));
const ws = { root: "/ws", opsDir: "/ws/roster-ops", opsName: "roster-ops" };

test("a good org.yaml passes", () => {
  const text =
    "org: acme\nname: Acme\nhuman: { github: ada }\n" +
    "staff:\n  - { handle: cto, dir: technology }\nrepos:\n  - { name: technology }\n";
  assert.equal(validateOrgYaml(text, parseYaml), null);
});

test("losing a key every prompt composes against is refused, and says which", () => {
  assert.match(validateOrgYaml("name: Acme\n", parseYaml)!, /"org"/);
  assert.match(validateOrgYaml("org: acme\n", parseYaml)!, /"name"/);
});

test("a staff entry with no handle is refused", () => {
  const text = "org: acme\nname: Acme\nstaff:\n  - { dir: technology }\n";
  assert.match(validateOrgYaml(text, parseYaml)!, /handle/);
});

test("a list that is not a list is refused", () => {
  const text = "org: acme\nname: Acme\nstaff: cto\n";
  assert.match(validateOrgYaml(text, parseYaml)!, /list/);
});

test("org.yaml is writable, and the files that break composition are not", () => {
  const brains = ["technology"];
  assert.equal(isWritable(ws, "roster-ops/org.yaml", brains), true);
  assert.equal(isWritable(ws, "roster-ops/org/voice.md", brains), true);
  for (const no of [
    "roster-ops/compose.mjs",
    "roster-ops/agents.mjs",
    "technology/staff.yaml",
    "technology/.github/workflows/cto-daily.yaml",
    "technology/memory/INDEX.md",
  ]) {
    assert.equal(isWritable(ws, no, brains), false, no + " must not be writable");
  }
});
