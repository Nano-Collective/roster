import assert from "node:assert/strict";
import { test } from "node:test";
import { openerFor, shouldOpen } from "../src/lib/browser.js";

test("a person at a terminal gets the page opened for them", () => {
  assert.equal(shouldOpen({}, true, false), true);
});

test("nobody to show it to means no browser: a pipe, CI, SSH, BROWSER=none or --no-open", () => {
  assert.equal(shouldOpen({}, false, false), false);
  assert.equal(shouldOpen({ CI: "true" }, true, false), false);
  assert.equal(shouldOpen({ SSH_CONNECTION: "1 2 3 4" }, true, false), false);
  assert.equal(shouldOpen({ BROWSER: "none" }, true, false), false);
  assert.equal(shouldOpen({}, true, true), false);
});

test("each platform opens with its own opener", () => {
  assert.deepEqual(openerFor("darwin", "http://x"), ["open", ["http://x"]]);
  assert.deepEqual(openerFor("linux", "http://x"), ["xdg-open", ["http://x"]]);
  assert.deepEqual(openerFor("win32", "http://x"), ["cmd", ["/c", "start", "", "http://x"]]);
});
