/* What the portal says when a checkout will not sync.
 *
 * The bug this pins: three repos failed to fetch and the portal reported
 * "Command failed: git -C /…/cto fetch --quiet --prune" for each. That is the command, which
 * you can already see, and not the reason, which you cannot. */

import assert from "node:assert/strict";
import { test } from "node:test";
import { reason } from "../src/lib/sync.js";

/** The shape `promisify(execFile)` rejects with: message, stdout and stderr on one Error. */
function execFileError(stderr: string, command = "git -C /repo fetch --quiet --prune") {
  const e: any = new Error(`Command failed: ${command}\n${stderr}`);
  e.stderr = stderr;
  e.stdout = "";
  e.code = 128;
  return e;
}

test("a failed fetch reports git's words, not the command that was run", () => {
  const out = reason(
    execFileError(
      "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
    ),
  );
  assert.match(out, /could not read Username/, "the reason has to survive");
  assert.ok(!out.startsWith("Command failed:"), "and the command must not be what is shown");
});

test("git's own prefixes are kept, because they are the sentence", () => {
  const out = reason(
    execFileError("fatal: unable to access 'https://github.com/a/b.git/': timed out"),
  );
  assert.ok(out.startsWith("fatal:"), out);
});

test("a multi-line stderr is cut to its first real line", () => {
  const out = reason(
    execFileError("\n\nerror: cannot lock ref 'refs/remotes/origin/main'\nsome other repo detail"),
  );
  assert.equal(out, "error: cannot lock ref 'refs/remotes/origin/main'");
});

test("an empty stderr falls back to the message, minus the boilerplate", () => {
  const e: any = new Error("Command failed: git -C /repo fetch\nfatal: not a git repository");
  e.stderr = "";
  assert.equal(reason(e), "fatal: not a git repository");
});

test("a failure with nothing but the boilerplate still says something", () => {
  const e: any = new Error("Command failed: git -C /repo fetch");
  e.stderr = "";
  assert.match(reason(e), /Command failed/, "there is nothing else to show, so show that");
});

test("a plain thrown value does not become the string 'undefined'", () => {
  assert.equal(reason(new Error("boom")), "boom");
  assert.equal(reason("boom"), "boom");
});

test("a very long reason is truncated rather than filling the sidebar", () => {
  const out = reason(execFileError("fatal: " + "x".repeat(400)));
  assert.equal(out.length, 180);
  assert.ok(out.endsWith("…"));
});
