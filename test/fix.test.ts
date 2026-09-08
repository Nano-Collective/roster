import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { collect } from "../src/commands/doctor.js";
import { classifyFinding, type FixItem, fixBrief, gather } from "../src/commands/fix.js";
import { businessStub } from "../src/commands/init.js";
import { brainTemplateDir } from "../src/lib/render.js";
import { looksUnwritten } from "../src/lib/stub.js";
import { makeTenant } from "./helpers/tenant.js";

/**
 * The findings, turned into something an agent can act on.
 *
 * The two things worth holding here are the split and the guardrail. Handing an agent a
 * finding only a person can clear does not fail cleanly — it invents a workaround — and an
 * agent that "fixes" a framework-owned file produces a change the next upgrade reverts.
 */

const root = mkdtempSync(join(tmpdir(), "roster-fix-test-"));
const ws = await makeTenant(root, {
  staff: [
    { handle: "growth", name: "Head of Growth" },
    { handle: "product", name: "Head of Product" },
  ],
});

after(() => rmSync(root, { recursive: true, force: true }));

test("what only a person can do is separated from what an agent can", () => {
  for (const id of ["actions-access", "secrets", "runs", "repo", "status-issue"]) {
    assert.equal(classifyFinding(id), "human", `${id} must never be handed to an agent`);
  }
  // App tokens cannot push under .github/workflows anywhere, so a caller fix is not an edit
  // an agent can land even when it is right.
  for (const id of ["callers", "callers.uses", "callers.target"]) {
    assert.equal(classifyFinding(id), "human");
  }
  for (const id of ["business.stub", "charter.stub", "compose", "memory"]) {
    assert.equal(classifyFinding(id), "agent");
  }
});

test("the brief names the framework-owned files before it names any of the work", () => {
  const items: FixItem[] = [
    {
      id: "business.stub",
      scope: "workspace",
      level: "warn",
      title: "still the stub",
      fix: "write it",
      who: "agent",
    },
  ];
  const text = fixBrief(ws, items);

  const guardrail = text.indexOf("What you must not edit");
  const work = text.indexOf("## What to fix");
  assert.ok(guardrail > 0 && work > 0);
  assert.ok(guardrail < work, "an agent that has started editing has stopped reading");

  for (const owned of [
    "compose.mjs",
    "agents.mjs",
    "runner-plan.mjs",
    ".github/workflows/",
    ".roster/",
  ]) {
    assert.ok(text.includes(owned), `${owned} is framework-owned and must be named`);
  }
  assert.match(text, /reverted by the next `roster upgrade`/);
});

test("findings only a person can clear are listed, and marked not to attempt", () => {
  const items: FixItem[] = [
    {
      id: "actions-access",
      scope: "workspace",
      level: "fail",
      title: "not callable org-wide",
      fix: "",
      who: "human",
    },
  ];
  const text = fixBrief(ws, items);
  assert.match(text, /Not yours/);
  assert.match(text, /Do not attempt them, and do not work around them/);
  assert.ok(
    !/## What to fix\n\n### 1\./.test(text),
    "a human-only finding is not work for the agent",
  );
});

test("a clean workspace says so instead of producing a brief with nothing in it", () => {
  assert.match(fixBrief(ws, []), /Nothing to fix/);
});

test("counts read as English", () => {
  const one: FixItem[] = [
    { id: "a", scope: "s", level: "warn", title: "t", fix: "f", who: "agent" },
  ];
  assert.match(fixBrief(ws, one), /1 thing below is yours/);
  const two: FixItem[] = [...one, { ...one[0]!, id: "b" }];
  assert.match(fixBrief(ws, two), /2 things below are yours/);
});

test("an unwritten business.md and charter reach the brief, from three different scanners", async () => {
  /* The stubs, as a real tenant carries them for the first hour of its life. That is the
     state where nothing errors and the output is quietly generic. */
  writeFileSync(join(ws.opsDir, "org", "business.md"), businessStub("Acme", "acme"));
  const stub = readFileSync(join(brainTemplateDir(), "CHARTER.md"), "utf8").replace(
    /%%[A-Z_]+%%/g,
    "x",
  );
  writeFileSync(join(root, "growth", "CHARTER.md"), stub);

  const report = await collect({ ops: ws.opsDir, offline: true });
  const ids = (report?.findings ?? []).filter((f) => f.level !== "ok").map((f) => f.id);
  assert.ok(ids.includes("business.stub"), "doctor should notice the questions are unanswered");
  assert.ok(ids.includes("charter.stub"), "and that a charter is still the scaffold");

  const items = await gather(ws, true);
  const collected = items.map((i) => i.id);
  assert.ok(collected.includes("business.stub"));
  assert.ok(collected.includes("charter.stub"));
  // Every item carries the sentence that fixes it, or it is not worth collecting.
  for (const item of items) {
    assert.ok(item.fix.trim(), `${item.id} arrived with no fix to offer`);
  }
});

test("looksUnwritten fires on the shipped stubs and not on real prose", () => {
  assert.equal(looksUnwritten(businessStub("Acme", "acme")), true);
  assert.equal(looksUnwritten(readFileSync(join(brainTemplateDir(), "CHARTER.md"), "utf8")), true);
  assert.equal(looksUnwritten(""), true);
  assert.equal(
    looksUnwritten(
      "# Charter\n\n## Who I am\n\nI own how people find us, and what they believe before " +
        "they sign up. One product, one plan, one page that matters.\n",
    ),
    false,
    "a written charter must not be mistaken for a stub",
  );
});
