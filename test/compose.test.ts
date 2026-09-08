import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
// The tenant vendors this file; the framework tests the same copy it ships.
// @ts-expect-error - plain JS, no types by design
import { parseYaml, render } from "../templates/ops/compose.mjs";
import { testWorkspace } from "./helpers/workspace.js";

const OPS = join(import.meta.dirname, "..", "templates", "ops");

test("parses a map with scalars, and types them", () => {
  const y = parseYaml(`org: acme\nname: Pip\nprivate: true\ncount: 3\nmissing: null`);
  assert.deepEqual(y, { org: "acme", name: "Pip", private: true, count: 3, missing: null });
});

test("parses nested maps", () => {
  const y = parseYaml(`human:\n  name: Will\n  github: you\ntop: 1`);
  assert.deepEqual(y, { human: { name: "Will", github: "you" }, top: 1 });
});

test("parses a list of inline maps, which is how staff and repos are written", () => {
  const y = parseYaml(
    `staff:\n  - { handle: cto, dir: technology }\n  - { handle: cmo, dir: marketing }`,
  ) as any;
  assert.equal(y.staff.length, 2);
  assert.deepEqual(y.staff[0], { handle: "cto", dir: "technology" });
  assert.deepEqual(y.staff[1], { handle: "cmo", dir: "marketing" });
});

test("parses a list of scalars, inline and block", () => {
  assert.deepEqual(parseYaml(`tools: [Bash, Read, Write]`), { tools: ["Bash", "Read", "Write"] });
  assert.deepEqual(parseYaml(`tools:\n  - Bash\n  - Read`), { tools: ["Bash", "Read"] });
});

test("keeps a colon inside a quoted scalar", () => {
  const y = parseYaml(`schedule: "40 7 * * 1-5"\nmention: "@cmo"`);
  assert.deepEqual(y, { schedule: "40 7 * * 1-5", mention: "@cmo" });
});

test("strips comments but not a # inside a value", () => {
  const y = parseYaml(`a: 1 # trailing\nb: "has # hash"\n# whole line`);
  assert.deepEqual(y, { a: 1, b: "has # hash" });
});

test("refuses to guess at malformed input rather than misparsing it", () => {
  assert.throws(() => parseYaml(`this is not yaml`), /expected "key: value"/);
  assert.throws(() => parseYaml(`a: 1\n    b: 2`), /unexpected indentation/);
});

test("reports the file and line on failure", () => {
  assert.throws(() => parseYaml(`ok: 1\nbroken line here`, "staff.yaml"), /staff\.yaml:2/);
});

test("renders placeholders and fails loudly on an unknown one", () => {
  const ctx = { a: { b: "x" } };
  assert.equal(
    render("v={{a.b}}", ctx, () => null),
    "v=x",
  );
  assert.throws(() => render("{{a.nope}}", ctx, () => null), /unknown or empty placeholder/);
});

test("conditionals include and exclude whole blocks", () => {
  const read = () => null;
  assert.equal(render("{{#if on}}yes{{/if}}", { on: true }, read), "yes");
  assert.equal(render("{{#if on}}yes{{/if}}", { on: false }, read), "");
  assert.equal(render("{{#if list}}yes{{/if}}", { list: [] }, read), "");
});

test("an excluded block's partials are never read", () => {
  let reads = 0;
  const read = () => {
    reads++;
    return "boom";
  };
  render("{{#if off}}{{> never.md}}{{/if}}", { off: false }, read);
  assert.equal(reads, 0, "a partial inside a false conditional must not be resolved");
});

test("required partials throw, optional ones render empty", () => {
  assert.throws(() => render("{{> gone.md}}", {}, () => null), /partial not found/);
  assert.equal(
    render("{{>? gone.md}}", {}, () => null),
    "",
  );
});

test("stops runaway includes instead of hanging the runner", () => {
  assert.throws(() => render("{{> self.md}}", {}, () => "{{> self.md}}"), /include depth exceeded/);
});

test("the shipped org.yaml template parses", async () => {
  // Guards against a template edit that composes locally and breaks in a runner.
  const org = parseYaml(
    readFileSync(join((await testWorkspace()).opsDir, "org.yaml"), "utf8"),
  ) as any;
  assert.equal(typeof org.org, "string");
  assert.ok(Array.isArray(org.staff) && org.staff.length > 0, "org.yaml must list staff");
  for (const s of org.staff) assert.ok(s.handle, "every staff entry needs a handle");
});
