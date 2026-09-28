import assert from "node:assert/strict";
import { test } from "node:test";
import { isPlanLimit, judgeGate } from "../src/lib/reviewgate.js";

test("a private repo on GitHub Free is named as a plan limit, not a read failure", () => {
  const error =
    "Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)";
  assert.ok(isPlanLimit(error));
  const v = judgeGate({ repo: "acme/app", approvals: null, bypass: [], error });
  assert.equal(v.level, "warn");
  assert.match(v.title, /paid plan/);
  assert.doesNotMatch(v.title, /could not read/);
});

test("any other error is still a read failure", () => {
  assert.equal(isPlanLimit("Not Found (HTTP 404)"), false);
  assert.match(
    judgeGate({ repo: "acme/app", approvals: null, bypass: [], error: "boom" }).title,
    /could not read/,
  );
});

test("the gate is on only when org.yaml says so", async () => {
  const { gateOn } = await import("../src/lib/reviewgate.js");
  assert.equal(gateOn({}), false);
  assert.equal(gateOn({ review_gate: false }), false);
  assert.equal(gateOn({ review_gate: true }), true);
  assert.equal(gateOn({ review_gate: "on" }), true);
});
