import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isWritable, promptView, saveFile } from "../src/lib/prompt.js";
import { findWorkspace, loadComposer } from "../src/lib/workspace.js";
import { testWorkspace } from "./helpers/workspace.js";

/**
 * The prompt screen and the one write path that touches a repo the agents run from.
 *
 * `saveFile` commits and pushes, so it is exercised against a scratch repo with a real
 * remote rather than against the live workspace. `promptView` runs against the live one,
 * because the thing worth catching is the real composition growing a shape it cannot walk.
 */

const ROOT = join(import.meta.dirname, "..");
const ws = await testWorkspace();
const { compose } = await loadComposer(ws.opsDir);

test("the layers are walked out of the includes, not written down", async () => {
  const view = promptView(ws, compose, "cto", join(ws.root, "technology"), "daily");

  assert.ok(view.composed.length > 1000, "a daily prompt is not a stub");
  const rels = view.layers.map((l) => l.rel);
  assert.equal(rels[0], "prompts/daily.md", "the kind file is the entry point");
  for (const want of ["org/operating.md", "org/guardrails.md", "org/voice.md"]) {
    assert.ok(rels.includes(want), want + " should be a layer: " + rels.join(", "));
  }
  // Order is source order, and it is what the composed text follows.
  assert.ok(
    rels.indexOf("prompts/_paths.md") < rels.indexOf("org/operating.md"),
    "layers are listed in the order they are pulled in",
  );
  // Every layer that exists must be findable on disk from the path the portal will fetch.
  for (const l of view.layers) {
    if (l.missing) {
      assert.ok(l.optional, l.rel + " is missing and was not optional");
      continue;
    }
    assert.ok(l.bytes > 0, l.rel + " resolved to an empty file");
    assert.doesNotThrow(() => readFileSync(join(ws.root, l.path)), l.path + " is not readable");
  }
});

test("a staff override resolves inside that staff member's own repo", async () => {
  const view = promptView(ws, compose, "cto", join(ws.root, "technology"), "daily");
  const own = view.layers.filter((l) => l.rel.startsWith("staff:"));
  assert.ok(own.length, "the CTO has prompt fragments of its own");
  for (const l of own) {
    assert.ok(l.path.startsWith("technology/"), l.rel + " resolved to " + l.path);
    assert.equal(l.repo, "technology");
  }
});

test("the charter is named by the prompt, not pasted into it", async () => {
  /* AGENT-ORG-PLAN.md reads as though the charter is part of the composed prompt. It is not:
     the prompt tells the agent to open it. The screen makes that distinction, so the data
     behind it has to hold. */
  const view = promptView(ws, compose, "cto", join(ws.root, "technology"), "daily");
  const charter = view.runtime.find((l) => l.rel === "CHARTER.md");
  assert.ok(charter, "the charter belongs in the runtime list");
  assert.ok(charter.bytes > 0);
  assert.ok(
    !view.layers.some((l) => l.rel.endsWith("CHARTER.md")),
    "and must not also be listed as inlined",
  );

  const body = readFileSync(join(ws.root, charter.path), "utf8");
  const distinctive = body.split("\n").find((l) => l.length > 60 && !l.startsWith("#"));
  if (distinctive) {
    assert.ok(
      !view.composed.includes(distinctive.trim()),
      "the charter's text must not appear in the composed prompt",
    );
  }
});

test("every kind composes for every staff member", async () => {
  const org = JSON.parse(
    execFileSync(
      "node",
      [
        "-e",
        `import(${JSON.stringify(`file://${join(ws.opsDir, "compose.mjs")}`)}).then(async (m) => {` +
          `const fs = await import("node:fs");` +
          `process.stdout.write(JSON.stringify(m.parseYaml(fs.readFileSync(${JSON.stringify(join(ws.opsDir, "org.yaml"))}, "utf8"))));})`,
      ],
      { encoding: "utf8" },
    ),
  );
  for (const s of org.staff ?? []) {
    for (const kind of ["daily", "mention", "pr-mention"]) {
      const view = promptView(ws, compose, s.handle, join(ws.root, s.dir ?? s.handle), kind);
      assert.ok(view.composed.length > 500, `${s.handle}/${kind} composed to nothing`);
      assert.ok(view.layers.length >= 2, `${s.handle}/${kind} found no layers`);
    }
  }
});

test("the allowlist covers the prompt layers and nothing else", () => {
  const brains = ["technology", "marketing"];
  const yes = [
    "roster-ops/org/voice.md",
    "roster-ops/org/guardrails.md",
    "roster-ops/prompts/daily.md",
    "technology/CHARTER.md",
    "technology/prompts/work.md",
  ];
  const no = [
    "roster-ops/compose.mjs",
    "roster-ops/.github/workflows/session.yaml",
    "technology/staff.yaml",
    "technology/memory/INDEX.md",
    "technology/.github/workflows/cto-daily.yaml",
    "../../etc/hosts",
    "roster-ops/org/../../technology/staff.yaml",
  ];
  // org.yaml is writable too, but only behind validateOrgYaml. See orgyaml.test.ts.
  for (const p of yes) assert.equal(isWritable(ws, p, brains), true, p + " should be writable");
  for (const p of no) assert.equal(isWritable(ws, p, brains), false, p + " must not be writable");
});

test("saving commits just that file, and leaves an unrelated edit alone", () => {
  const dir = mkdtempSync(join(tmpdir(), "roster-save-"));
  const bare = join(dir, "remote.git");
  const work = join(dir, "ws", "roster-ops");
  mkdirSync(work, { recursive: true });
  execFileSync("git", ["init", "--bare", "-b", "main", bare]);

  const git = (...a: string[]) => execFileSync("git", ["-C", work, ...a], { encoding: "utf8" });
  git("init", "-b", "main");
  git("config", "user.email", "t@example.invalid");
  git("config", "user.name", "test");
  mkdirSync(join(work, "org"), { recursive: true });
  writeFileSync(join(work, "org", "voice.md"), "before\n");
  writeFileSync(join(work, "org.yaml"), "org: acme\n");
  git("add", "-A");
  git("commit", "-m", "seed");
  git("remote", "add", "origin", bare);
  git("push", "-u", "origin", "main");

  // Something else the person was in the middle of. It must survive untouched.
  writeFileSync(join(work, "org.yaml"), "org: acme\nname: half an edit\n");

  const scratch = { root: join(dir, "ws"), opsDir: work, opsName: "roster-ops" };
  const out = saveFile(scratch, "roster-ops/org/voice.md", "after\n", "portal: edit org/voice.md");

  assert.equal(out.committed, true);
  assert.equal(out.pushed, true, out.note);
  assert.equal(readFileSync(join(work, "org", "voice.md"), "utf8"), "after\n");

  const files = git("show", "--name-only", "--format=", "HEAD").trim().split("\n");
  assert.deepEqual(files, ["org/voice.md"], "only the edited file belongs in the commit");
  assert.match(git("status", "--short"), /org\.yaml/, "the unrelated edit is still uncommitted");
  assert.equal(
    execFileSync("git", ["-C", bare, "show", "main:org/voice.md"], { encoding: "utf8" }),
    "after\n",
    "and it reached the remote",
  );
});

test("saving the same text does nothing at all", () => {
  const dir = mkdtempSync(join(tmpdir(), "roster-save-"));
  const work = join(dir, "ws", "roster-ops");
  mkdirSync(join(work, "org"), { recursive: true });
  execFileSync("git", ["-C", work, "init", "-b", "main"]);
  execFileSync("git", ["-C", work, "config", "user.email", "t@example.invalid"]);
  execFileSync("git", ["-C", work, "config", "user.name", "test"]);
  writeFileSync(join(work, "org", "voice.md"), "same\n");
  execFileSync("git", ["-C", work, "add", "-A"]);
  execFileSync("git", ["-C", work, "commit", "-m", "seed"]);
  const before = execFileSync("git", ["-C", work, "rev-parse", "HEAD"], { encoding: "utf8" });

  const scratch = { root: join(dir, "ws"), opsDir: work, opsName: "roster-ops" };
  const out = saveFile(scratch, "roster-ops/org/voice.md", "same\n", "portal: edit");
  assert.equal(out.committed, false);
  assert.equal(out.note, "no change");
  assert.equal(
    execFileSync("git", ["-C", work, "rev-parse", "HEAD"], { encoding: "utf8" }),
    before,
  );
});

test("a failed push still reports the commit that succeeded", () => {
  // The edit is on disk and committed; only the push failed. Saying "it failed" would send
  // someone off to redo work that is already done.
  const dir = mkdtempSync(join(tmpdir(), "roster-save-"));
  const work = join(dir, "ws", "roster-ops");
  mkdirSync(join(work, "org"), { recursive: true });
  execFileSync("git", ["-C", work, "init", "-b", "main"]);
  execFileSync("git", ["-C", work, "config", "user.email", "t@example.invalid"]);
  execFileSync("git", ["-C", work, "config", "user.name", "test"]);
  writeFileSync(join(work, "org", "voice.md"), "before\n");
  execFileSync("git", ["-C", work, "add", "-A"]);
  execFileSync("git", ["-C", work, "commit", "-m", "seed"]);
  // No remote, so the push cannot work.

  const scratch = { root: join(dir, "ws"), opsDir: work, opsName: "roster-ops" };
  const out = saveFile(scratch, "roster-ops/org/voice.md", "after\n", "portal: edit");
  assert.equal(out.committed, true);
  assert.equal(out.pushed, false);
  assert.ok(out.sha, "the commit it did make must be named");
  assert.ok(out.note, "and the reason the push did not");
  assert.equal(readFileSync(join(work, "org", "voice.md"), "utf8"), "after\n");
});
