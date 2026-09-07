import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { amendBrief } from "../src/lib/amend.js";
import { auditPrompt } from "../src/lib/audit.js";
import type { PromptView } from "../src/lib/prompt.js";

/**
 * The audit is the half that makes prompt-writing tractable: knowing there is a problem is
 * hard, writing the paragraph is not. Which means a false positive is expensive — a linter you
 * stop believing is worse than no linter — so the tests are mostly about what it must NOT say.
 */

function scratch() {
  const root = mkdtempSync(join(tmpdir(), "roster-audit-"));
  mkdirSync(join(root, "roster-ops", "org"), { recursive: true });
  mkdirSync(join(root, "brain"), { recursive: true });
  return { root, opsDir: join(root, "roster-ops"), opsName: "roster-ops" };
}

function layer(path: string, over: Record<string, unknown> = {}) {
  return {
    rel: path.replace(/^roster-ops\//, ""),
    path,
    repo: path.split("/")[0]!,
    bytes: 1,
    optional: false,
    missing: false,
    editable: true,
    ...over,
  };
}

function view(composed: string, layers: any[] = [], runtime: any[] = []): PromptView {
  return { staff: "cto", kind: "daily", composed, layers, runtime };
}

test("a stub nobody answered is the loudest finding", () => {
  const ws = scratch();
  writeFileSync(
    join(ws.opsDir, "org", "business.md"),
    "# The business\n\nWhat does this business do?\nWho are the customers?\nWhat is the one fact everything follows from?\n",
  );
  const found = auditPrompt(ws, view("hello", [layer("roster-ops/org/business.md")]), []);
  const stub = found.find((f) => f.id === "stub");
  assert.ok(stub, "an unanswered stub must be found: " + JSON.stringify(found));
  assert.equal(stub.level, "error");
  assert.match(stub.want, /business\.md/, "and it must carry the instruction to fix it");
});

test("a short but real file is not a stub", () => {
  // The check is the questions, not the length. Punishing brevity here would be absurd.
  const ws = scratch();
  writeFileSync(
    join(ws.opsDir, "org", "business.md"),
    "Pip is a poker trainer. It converts and almost nobody arrives: ~10 a day (Aug).\n",
  );
  const found = auditPrompt(ws, view("hello", [layer("roster-ops/org/business.md")]), []);
  assert.equal(found.filter((f) => f.id === "stub").length, 0, JSON.stringify(found));
});

test("an unresolved placeholder in the composed text is an error", () => {
  const ws = scratch();
  const found = auditPrompt(ws, view("Open {{staff.product.repo}} and read it."), []);
  const bad = found.find((f) => f.id === "unresolved");
  assert.ok(bad, "the agent would read those braces literally");
  assert.match(bad.want, /\{\{staff\.product\.repo\}\}/);
});

test("the same rule in two layers is found, and idiom is not", () => {
  const ws = scratch();
  const shared =
    "Never fabricate a number, and never write an estimate as though it were measured.";
  writeFileSync(join(ws.opsDir, "org", "voice.md"), `# Voice\n\n${shared}\n`);
  writeFileSync(join(ws.opsDir, "org", "guardrails.md"), `# Guardrails\n\n${shared}\n`);
  writeFileSync(
    join(ws.root, "brain", "CHARTER.md"),
    "# Charter\n\nShort lines. Not duplicated.\n",
  );
  const found = auditPrompt(
    ws,
    view(
      "x",
      [layer("roster-ops/org/voice.md"), layer("roster-ops/org/guardrails.md")],
      [layer("brain/CHARTER.md")],
    ),
    [],
  );
  const echo = found.find((f) => f.id === "echo");
  assert.ok(echo, "a rule stated twice is stated twice on every run");
  assert.match(echo.want, /voice\.md/);
  assert.match(echo.want, /guardrails\.md/);
  assert.ok(!echo.want.includes("Short lines"), "a short shared line is idiom, not duplication");
});

test("a path the prompt names is resolved against every repo, not just the root", () => {
  /* The first version of this check reported seven files that were all there, because the
     prompt writes `org/voice.md` meaning the ops repo and `src/config/x.ts` meaning the
     product. Reporting real files as missing is how a linter loses its reader. */
  const ws = scratch();
  mkdirSync(join(ws.root, "product", "src"), { recursive: true });
  writeFileSync(join(ws.root, "product", "src", "config.ts"), "export {};\n");
  writeFileSync(join(ws.opsDir, "org", "voice.md"), "# Voice\n");

  const composed = "Read `org/voice.md`, then `src/config.ts`, then `brain/nope.md`.";
  const found = auditPrompt(ws, view(composed), ["roster-ops", "product", "brain"]);
  const dangling = found.filter((f) => f.id === "dangling");
  assert.equal(
    dangling.length,
    1,
    "only the one that is really absent: " + JSON.stringify(dangling),
  );
  assert.match(dangling[0]!.title, /brain\/nope\.md/);
});

test("a healthy prompt produces nothing at all", () => {
  // The finding that matters most is the absence of findings.
  const ws = scratch();
  writeFileSync(join(ws.opsDir, "org", "voice.md"), "# Voice\n\nSay the point first.\n");
  const found = auditPrompt(ws, view("Read `org/voice.md`.", [layer("roster-ops/org/voice.md")]), [
    "roster-ops",
  ]);
  assert.deepEqual(found, [], JSON.stringify(found));
});

test("the amend brief carries the prompt and every layer, fenced so nothing escapes", () => {
  const ws = scratch();
  // A layer containing its own fenced block: a three-backtick wrapper would close early and
  // spill the rest of the brief outside the block.
  writeFileSync(
    join(ws.opsDir, "org", "voice.md"),
    "# Voice\n\n```\nan example fence\n```\n\nSay the point first.\n",
  );
  const v = view("THE COMPOSED PROMPT", [layer("roster-ops/org/voice.md")]);
  const brief = amendBrief(ws, v, { NAME: "the CTO", HUMAN: "Ada", DIR: "brain" }, "be shorter");

  assert.match(brief, /be shorter/, "what was asked for goes at the top");
  assert.match(brief, /THE COMPOSED PROMPT/, "the composed text is attached");
  assert.match(brief, /Say the point first/, "and so is every layer's content");
  assert.match(brief, /roster-ops\/org\/voice\.md/, "named by path, so a diff can be proposed");
  assert.match(brief, /Reaches every staff member/, "with its blast radius");
  assert.ok(brief.includes("````"), "a layer with its own fence needs a longer wrapper");
});

test("an unfilled want tells the person to fill it in rather than shipping blank", () => {
  const ws = scratch();
  const brief = amendBrief(ws, view("x"), { NAME: "the CTO" }, "");
  assert.match(brief, /Replace this line with what you want changed/);
});
