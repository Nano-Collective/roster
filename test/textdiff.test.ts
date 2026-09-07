import assert from "node:assert/strict";
import { test } from "node:test";

/* The portal ships plain ES modules with no types, so the import is built rather than
   written: a literal specifier makes tsc try to resolve declarations that do not exist. The
   shape is declared here instead, which is stricter than the `any` a .d.ts would give. */
const { unifiedDiff, diffStat } = (await import(
  new URL("../templates/portal/js/textdiff.js", import.meta.url).href
)) as {
  unifiedDiff(before: string, after: string, name: string, context?: number): string;
  diffStat(before: string, after: string): { added: number; removed: number };
};

/**
 * Editing a layer changes a file, but what you meant to change is the composed prompt, and
 * those are not the same thing: a line added to one fragment can land three times or not at
 * all. This is what turns "I edited voice.md" into "here is what the agent will now read".
 */

test("an unchanged prompt produces no diff at all", () => {
  // Which is a real answer: editing whitespace in a layer can compose to nothing.
  assert.equal(unifiedDiff("a\nb\nc", "a\nb\nc", "prompt"), "");
});

test("a change is a unified diff that renderDiff can parse", () => {
  const before = ["one", "two", "three", "four", "five"].join("\n");
  const after = ["one", "two", "changed", "four", "five"].join("\n");
  const out = unifiedDiff(before, after, "the daily prompt");

  assert.match(out, /^diff --git a\/the daily prompt b\/the daily prompt$/m);
  assert.match(out, /^@@ -\d+,\d+ \+\d+,\d+ @@$/m);
  assert.ok(out.includes("-three"), out);
  assert.ok(out.includes("+changed"), out);
  assert.ok(out.includes(" one"), "context is kept, with its leading space");
});

test("only the neighbourhood of a change is printed", () => {
  // A 400-line prompt with six lines highlighted is not a diff, it is the prompt again.
  const before = Array.from({ length: 200 }, (_, i) => "line " + i).join("\n");
  const after = before.replace("line 100", "line one hundred");
  const out = unifiedDiff(before, after, "p");
  assert.ok(out.split("\n").length < 20, "expected a small hunk: " + out.split("\n").length);
  assert.ok(out.includes("+line one hundred"));
  assert.ok(!out.includes("line 5\n"), "the far side of the file is not in it");
});

test("the line numbers are the ones the reader would count to", () => {
  assert.match(unifiedDiff("a\nb\nc", "a\nB\nc", "p", 1), /@@ -1,3 \+1,3 @@/);
});

test("the stat counts what moved", () => {
  assert.deepEqual(diffStat("a\nb", "a\nb"), { added: 0, removed: 0 });
  assert.deepEqual(diffStat("a\nb", "a\nb\nc"), { added: 1, removed: 0 });
  assert.deepEqual(diffStat("a\nb\nc", "a\nc"), { added: 0, removed: 1 });
  assert.deepEqual(diffStat("a\nb", "a\nB"), { added: 1, removed: 1 }, "an edit is both");
});

test("an empty side is handled rather than throwing", () => {
  assert.match(unifiedDiff("", "hello", "p"), /\+hello/);
  assert.match(unifiedDiff("hello", "", "p"), /-hello/);
});
