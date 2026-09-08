import assert from "node:assert/strict";
import { test } from "node:test";
import { BEGIN, END, type PasteTarget, parsePaste } from "../src/lib/paste.js";

/**
 * Turning a chat reply into a file.
 *
 * Everything here is about being forgiving in one direction and strict in the other: a model
 * will chat, apologise, fence things and explain itself, and none of that is an error. Writing
 * a file nobody asked for, or handing back the template it was given, is.
 */

const TARGET: PasteTarget[] = [
  {
    path: "growth/CHARTER.md",
    before:
      "# Charter\n\n**This file is a stub, and it is the most important file in this repo.**\n",
  },
];

const REAL = `# Charter - Head of Growth

## Who I am

I own how people find us and what they believe before they sign up. One product, one plan, and
one page that matters, which is the one somebody lands on after a bad month.

## Decision rights

Mine: the landing page and the onboarding sequence. Sam rules on pricing and anything sent
under our name. Never mine: the roadmap, which is Product's and stays theirs.`;

const wrap = (path: string, body: string) => `${BEGIN(path)}\n${body}\n${END}`;

test("the file comes out and the chat around it is ignored", () => {
  const answer = `Sure! Here it is.\n\n${wrap("growth/CHARTER.md", REAL)}\n\nLet me know if you want it shorter.`;
  const { files, problems } = parsePaste(answer, TARGET);
  assert.deepEqual(problems, []);
  assert.equal(files.length, 1);
  assert.equal(files[0]!.path, "growth/CHARTER.md");
  assert.ok(files[0]!.text.startsWith("# Charter - Head of Growth"));
  assert.ok(files[0]!.text.endsWith("\n"), "a file should end with a newline");
  assert.ok(!files[0]!.text.includes("Sure!"), "the chat leaked into the file");
});

test("a model that fences the whole thing anyway still gets parsed", () => {
  // Told to return a bare file, plenty of models will wrap it in markdown regardless.
  const answer = wrap("growth/CHARTER.md", "```markdown\n" + REAL + "\n```");
  const { files, problems } = parsePaste(answer, TARGET);
  assert.deepEqual(problems, []);
  assert.ok(files[0]!.text.startsWith("# Charter"), "one fence layer should come off");
});

test("a fence *inside* the file survives, because it is content", () => {
  const withCode = `${REAL}\n\n## Example\n\n\`\`\`bash\nroster doctor growth\n\`\`\``;
  const { files } = parsePaste(wrap("growth/CHARTER.md", withCode), TARGET);
  assert.match(files[0]!.text, /```bash\nroster doctor growth\n```/);
});

test("prose with no envelope is a next step, not an error", () => {
  const { files, problems } = parsePaste(
    "I'd start the charter by describing who they are…",
    TARGET,
  );
  assert.equal(files.length, 0);
  assert.equal(problems[0]!.id, "no-envelope");
  assert.match(problems[0]!.retry, /<<<ROSTER FILE growth\/CHARTER\.md>>>/);
  assert.match(problems[0]!.retry, new RegExp(END));
});

test("a file nobody asked for is refused, and named", () => {
  const answer = wrap("roster-ops/org/guardrails.md", "Some guardrails I invented.");
  const { files, problems } = parsePaste(answer, TARGET);
  assert.equal(files.length, 0, "an unrequested path must not become a writable file");
  assert.equal(problems[0]!.id, "unknown-path");
  assert.match(problems[0]!.message, /roster-ops\/org\/guardrails\.md/);
});

test("the template handed straight back is caught", () => {
  const { problems } = parsePaste(wrap("growth/CHARTER.md", TARGET[0]!.before), TARGET);
  assert.equal(problems[0]!.id, "brief-echoed");
});

test("the scaffold's own headings coming back means the questions were never answered", () => {
  const stub =
    "# Charter\n\n## Who I am\n\nOne paragraph. What this role is for, in this business specifically.\n\n" +
    "More words to get past the length check. ".repeat(6);
  const { problems } = parsePaste(wrap("growth/CHARTER.md", stub), TARGET);
  assert.equal(problems[0]!.id, "stub-echoed");
});

test("a four-line charter is a failed answer, and says so as one", () => {
  const { problems } = parsePaste(
    wrap("growth/CHARTER.md", "# Charter\n\nDoes growth. Owns the page."),
    TARGET,
  );
  assert.equal(problems[0]!.id, "too-short");
  assert.match(problems[0]!.message, /\d+ words/);
});

test("more than one file comes back when the brief asked for more than one", () => {
  const two: PasteTarget[] = [
    { path: "a/CHARTER.md", before: "" },
    { path: "b/CHARTER.md", before: "" },
  ];
  const answer = `${wrap("a/CHARTER.md", REAL)}\n\nand the other one:\n\n${wrap("b/CHARTER.md", REAL)}`;
  const { files, problems } = parsePaste(answer, two);
  assert.deepEqual(problems, []);
  assert.deepEqual(
    files.map((f) => f.path),
    ["a/CHARTER.md", "b/CHARTER.md"],
  );
});

test("an empty paste says so rather than reporting nothing found", () => {
  assert.equal(parsePaste("   \n ", TARGET).problems[0]!.id, "empty");
});

test("windows line endings do not hide the sentinels", () => {
  const answer = wrap("growth/CHARTER.md", REAL).replace(/\n/g, "\r\n");
  const { files, problems } = parsePaste(answer, TARGET);
  assert.deepEqual(problems, []);
  assert.equal(files.length, 1);
});
