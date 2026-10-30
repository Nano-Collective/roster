import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { posix } from "../src/lib/paths.js";
import { existsSync, mount, readFileSync, treeOf } from "../src/lib/vfs.js";
import { portalAsset } from "../src/portal/assets.js";

/**
 * On Windows the portal came up unstyled and stuck on "Loading…": every asset failed a
 * containment check written as `startsWith(root + "/")`, and every snapshot read missed its
 * mount because path.join gave backslashes. These hold the platform-neutral halves in place;
 * the Windows job in CI runs the rest for real.
 */

test("a mounted snapshot is found by a Windows-shaped path too", () => {
  mount("/@roster/winco", treeOf({ "cto/staff.yaml": "handle: cto\n" }));
  for (const p of [
    "/@roster/winco/cto/staff.yaml",
    "\\@roster\\winco\\cto\\staff.yaml",
    "C:\\@roster\\winco\\cto\\staff.yaml",
    "C:/@roster/winco/cto/staff.yaml",
  ]) {
    assert.ok(existsSync(p), p);
    assert.equal(readFileSync(p, "utf8"), "handle: cto\n");
  }
});

test("portal assets are served, and nothing outside them is", () => {
  assert.equal(portalAsset("css/base.css")?.type, "text/css; charset=utf-8");
  assert.equal(portalAsset("js/app.js")?.type, "text/javascript; charset=utf-8");
  assert.equal(portalAsset("../../package.json"), null);
  assert.equal(portalAsset(join("..", "..", "src", "cli.ts")), null);
});

test("a relative path is named with forward slashes", () => {
  assert.equal(posix(join("cto", "prompts", "boot.md")), "cto/prompts/boot.md");
});
