import assert from "node:assert/strict";
import { test } from "node:test";
import { installTargets } from "../src/lib/install.js";

const ws = { root: "/nowhere", opsName: "roster-ops" } as never;
const parse = () => ({});
const spec = { brain: "acme/cto", worksIn: ["acme/app"] };

test("a staff App is installed on the ops repo, because every run checks it out first", () => {
  const t = installTargets(ws, { org: "acme", staff: [] }, parse, "cto", spec);
  assert.deepEqual(t, ["acme/cto", "acme/roster-ops", "acme/app"]);
});

test("the shared public identity only needs the product repos", () => {
  assert.deepEqual(installTargets(ws, { org: "acme", staff: [] }, parse, "cto", spec, "public"), [
    "acme/app",
  ]);
});
