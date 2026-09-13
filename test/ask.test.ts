import assert from "node:assert/strict";
import { test } from "node:test";
import { type AskRequest, askBody, askTitle } from "../src/lib/ask.js";

/**
 * What the tracker issue has to say.
 *
 * This is the whole product-repo lane: a pull request lives where nothing wakes an agent, and
 * this text is what carries it to where something does. Four things have to survive, and all
 * four are silent when they break — a missing mention posts an issue nobody is woken by, and a
 * missing "answer on the pull request" gets an answer on the wrong page.
 */

const REQ: AskRequest = {
  staff: { handle: "cto", name: "Chief Technology Officer", mention: "@cto", brain: "acme/cto" },
  pr: {
    repo: "acme/product",
    number: 42,
    title: "Tighten the hand evaluator",
    url: "https://github.com/acme/product/pull/42",
    head: "fix/hand-eval",
    base: "main",
  },
  body: "This drops the kicker comparison. Put it back and add a test for it.",
};

test("the mention is first, because it is the mechanism", () => {
  const body = askBody(REQ);
  assert.match(body, /^@cto This drops the kicker/);
});

test("a mention already typed is not doubled", () => {
  const body = askBody({ ...REQ, body: "@cto have a look at this" });
  assert.equal(body.match(/@cto/g)?.length, 1, "one mention, where they put it");
  assert.match(body, /^@cto have a look/);
});

test("it names the pull request, links it, and names the branch", () => {
  const body = askBody(REQ);
  assert.match(body, /acme\/product#42/);
  assert.match(body, /Tighten the hand evaluator/);
  assert.match(body, /https:\/\/github\.com\/acme\/product\/pull\/42/);
  assert.match(body, /`fix\/hand-eval` → `main`/);
});

test("it sends the answer to the pull request, not to the tracker it arrived on", () => {
  /* prompts/mention.md tells them to answer where the request came from, which here is this
     issue — leaving the diff silent and the human watching the wrong page. This body is the
     only thing that overrides it. */
  const body = askBody(REQ);
  assert.match(body, /\*\*Answer on the pull request, not here\.\*\*/);
  assert.match(body, /gh issue comment 42 --repo acme\/product/);
  assert.match(body, /Push any change to `fix\/hand-eval`/);
});

test("without a branch it says so rather than naming one it is guessing at", () => {
  const body = askBody({ ...REQ, pr: { ...REQ.pr, head: undefined, base: undefined } });
  assert.doesNotMatch(body, /undefined/);
  assert.match(body, /the pull request's branch/);
});

test("a file they were looking at comes with its hunk", () => {
  const body = askBody({
    ...REQ,
    anchor: { path: "src/eval.ts", patch: "@@ -1,3 +1,3 @@\n-  const a = 1;\n+  const a = 2;" },
  });
  assert.match(body, /`src\/eval\.ts`/);
  assert.match(body, /```diff/);
  assert.match(body, /\+ {2}const a = 2;/);
});

test("a long hunk is clipped, and says it was", () => {
  const patch = Array.from({ length: 200 }, (_, i) => `+ line ${i}`).join("\n");
  const body = askBody({ ...REQ, anchor: { path: "src/big.ts", patch } });
  assert.match(body, /more lines, on the pull request/);
  assert.doesNotMatch(body, /line 150/, "it is a pointer to the diff, not a copy of it");
});

test("a fence inside the diff does not end the block around it", () => {
  /* A diff of a markdown file contains fences. A three-backtick wrapper around one closes in
     the middle of the quote, and everything after it renders as prose. */
  const body = askBody({
    ...REQ,
    anchor: { path: "README.md", patch: "+```js\n+const a = 1;\n+```" },
  });
  assert.match(body, /````diff/, "the wrapper grows past the longest run inside it");
});

test("the title leads with the pull request, because that is what is scanned for", () => {
  assert.equal(askTitle(REQ), "product#42 — Tighten the hand evaluator");
});

test("a very long pull request title is cut, not passed through", () => {
  const title = askTitle({ ...REQ, pr: { ...REQ.pr, title: "x".repeat(400) } });
  assert.ok(title.length <= 120, `${title.length} characters`);
  assert.match(title, /…$/);
});

/* ------------------------ an issue is not a pull request ------------------ */

test("an ask about an issue does not send them looking for a diff", () => {
  /* A product repo has issues on it too, and replying to one can raise an ask the same way.
     Telling an agent to answer "on the pull request" when it is an issue sends them looking
     for something that is not there. */
  const body = askBody({
    ...REQ,
    pr: { ...REQ.pr, kind: "issue", head: undefined, base: undefined },
  });
  assert.match(body, /\*\*Answer on the issue, not here\.\*\*/);
  assert.doesNotMatch(body, /pull request/);
  assert.doesNotMatch(body, /where the diff is/);
  assert.doesNotMatch(body, /Push any change/, "there is no branch to push to");
});

test("an ask about a pull request still says so, and still says push", () => {
  const body = askBody({ ...REQ, pr: { ...REQ.pr, kind: "pr" } });
  assert.match(body, /\*\*Answer on the pull request, not here\.\*\*/);
  assert.match(body, /where the diff is/);
  assert.match(body, /Push any change to `fix\/hand-eval`/);
});

test("the reply command works on either, because GitHub numbers them together", () => {
  // `gh issue comment` addresses a pull request too. One command, one thing to remember.
  for (const kind of ["pr", "issue"] as const) {
    assert.match(
      askBody({ ...REQ, pr: { ...REQ.pr, kind } }),
      /gh issue comment 42 --repo acme\/product/,
    );
  }
});
