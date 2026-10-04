import assert from "node:assert/strict";
import { test } from "node:test";

/* Built rather than written: the portal ships plain ES modules with no types. */
const dir = new URL("../templates/portal/js/", import.meta.url).href;
const { progress, staffProgress } = (await import(dir + "readiness.js")) as {
  progress(unfinished: string[], staff: any[], readiness: Record<string, string[]>): any;
  staffProgress(handle: string, readiness: Record<string, string[]>): any;
};

const ops = { handle: "ops", name: "Head of Operations" };
const qa = { handle: "qa", name: "Quality" };

test("a new org counts the first hire's five steps as still to do", () => {
  assert.deepEqual(progress(["hire", "business", "priorities"], [], {}), { done: 1, total: 8 });
  assert.deepEqual(progress(["hire"], [], {}), { done: 3, total: 8 });
});

test("each hire adds five, and what is left for them comes off", () => {
  const left = { ops: ["write the charter", "run once"], qa: [] };
  assert.deepEqual(progress([], [ops, qa], left), { done: 11, total: 13 });
  assert.deepEqual(staffProgress("ops", left), { done: 3, total: 5 });
});

test("no count until every staff member has answered", () => {
  assert.equal(progress([], [ops, qa], { ops: [] }), null);
  assert.equal(staffProgress("qa", {}), null);
});
