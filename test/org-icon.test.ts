import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { orgIcon } from "../src/portal/assets.js";

test("an org's icon is found in portal/, svg first, and is absent without one", () => {
  const ops = mkdtempSync(join(tmpdir(), "roster-icon-"));
  try {
    assert.equal(orgIcon(ops), null);
    mkdirSync(join(ops, "portal"));
    writeFileSync(join(ops, "portal", "icon.png"), "png");
    assert.deepEqual(orgIcon(ops), {
      path: join(ops, "portal", "icon.png"),
      rel: "portal/icon.png",
      type: "image/png",
    });
    writeFileSync(join(ops, "portal", "icon.svg"), "<svg/>");
    assert.equal(orgIcon(ops)?.type, "image/svg+xml");
  } finally {
    rmSync(ops, { recursive: true, force: true });
  }
});
