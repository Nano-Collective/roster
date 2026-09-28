import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { budgetsFor, DEFAULT_BUDGETS, lintMemory, parseMemory } from "../src/lib/memory.js";

/**
 * The budgets exist because "one line per fact" and "current month only" were prose, and a
 * live org's memory grew past both without anything noticing. So each test here builds a brain
 * that is over by a known amount and checks the finding names what to cut.
 */

function fact(slug: string, chars: number): string {
  const head = `- **\`${slug}\`** · [derived] `;
  const tail = " **So:** it matters.";
  return head + "x".repeat(Math.max(1, chars - head.length - tail.length)) + tail;
}

function brain(facts: string[], decisionsBytes = 0) {
  const root = mkdtempSync(join(tmpdir(), "roster-memory-"));
  mkdirSync(join(root, "memory"), { recursive: true });
  mkdirSync(join(root, "log"), { recursive: true });
  writeFileSync(
    join(root, "memory", "INDEX.md"),
    `# Memory index\n\n## Facts\n\n${facts.join("\n")}\n`,
  );
  writeFileSync(
    join(root, "log", "decisions.md"),
    `# Decisions\n\n${"d".repeat(decisionsBytes)}\n`,
  );
  const dir = join(root, "memory");
  return { root, dir, doc: parseMemory(dir) };
}

test("budgets default, then take org.yaml, then the staff member's own", () => {
  assert.deepEqual(budgetsFor({}), DEFAULT_BUDGETS);
  const org = { memory: { max_index_kb: 30, max_fact_chars: 300 } };
  const staff = { memory: { max_index_kb: 40 } };
  assert.deepEqual(budgetsFor(org, staff), { factChars: 300, indexKb: 40, decisionsKb: 24 });
});

test("a budget that is not a positive number is ignored, so a typo cannot switch a check off", () => {
  const b = budgetsFor({
    memory: { max_index_kb: 0, max_fact_chars: "lots", max_decisions_kb: -1 },
  });
  assert.deepEqual(b, DEFAULT_BUDGETS);
});

test("a memory inside every budget has nothing to say about size", () => {
  const { root, dir, doc } = brain([fact("small", 200)], 1000);
  try {
    const rules = lintMemory(doc, dir).map((p) => p.rule);
    assert.deepEqual(rules, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a long fact is measured against the configured budget, not a constant", () => {
  const { root, dir, doc } = brain([fact("wordy", 350)]);
  try {
    assert.equal(lintMemory(doc, dir).filter((p) => p.rule === "too-long").length, 0);
    const tight = lintMemory(doc, dir, { ...DEFAULT_BUDGETS, factChars: 300 });
    const found = tight.find((p) => p.rule === "too-long");
    assert.ok(found, "350 characters is over a 300 budget");
    assert.equal(found.slug, "wordy");
    assert.match(found.message, /300 budget/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an index over budget names the longest facts, so the fix starts somewhere", () => {
  const facts = Array.from({ length: 40 }, (_, i) => fact(`fact-${i}`, 300));
  facts.push(fact("the-longest", 390), fact("second-longest", 380));
  const { root, dir, doc } = brain(facts);
  try {
    const found = lintMemory(doc, dir, { ...DEFAULT_BUDGETS, indexKb: 8 }).find(
      (p) => p.rule === "index-too-big",
    );
    assert.ok(found, "about 13KB is over an 8KB budget");
    assert.equal(found.level, "warning", "a run still works over budget");
    assert.equal(found.file, "memory/INDEX.md");
    assert.match(found.message, /`the-longest` \(\d+\), `second-longest`/);
    assert.equal(
      lintMemory(doc, dir).some((p) => p.rule === "index-too-big"),
      false,
      "and the same index is fine under the default",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a decision log over budget is told to roll the old months out", () => {
  const { root, dir, doc } = brain([fact("one", 200)], 30 * 1024);
  try {
    const found = lintMemory(doc, dir).find((p) => p.rule === "decisions-too-big");
    assert.ok(found, "30KB is over the 24KB default");
    assert.equal(found.file, "log/decisions.md");
    assert.match(found.message, /log\/decisions\/<YYYY-MM>\.md/);
    assert.equal(
      lintMemory(doc, dir, { ...DEFAULT_BUDGETS, decisionsKb: 40 }).some(
        (p) => p.rule === "decisions-too-big",
      ),
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
