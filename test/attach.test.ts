import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { attach, MAX_UPLOAD } from "../src/lib/attach.js";

/**
 * Files dropped onto an issue land in the repo the issue is in, because that is the copy the
 * agent working the issue will have on disk. Everything below is about that path being one a
 * person can read and a second upload cannot quietly overwrite.
 *
 * No remote here on purpose: a repo with nowhere to push exercises the branch that matters
 * most, which is the one where the commit is made and the push is not.
 */

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "roster-attach-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" });
  git("init", "--quiet", "--initial-branch", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  writeFileSync(join(dir, "README.md"), "hello\n");
  git("add", "-A");
  git("commit", "--quiet", "-m", "first");
  return dir;
}

const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

test("an attachment is committed into the repo, under attachments/", () => {
  const dir = repo();
  const a = attach({
    repoDir: dir,
    repo: "acme/technology",
    name: "Screenshot 2026-09-08 at 20.30.46.png",
    data: png,
    today: "2026-09-08",
  });

  assert.equal(a.path, "attachments/2026-09-08-screenshot-2026-09-08-at-20-30-46.png");
  assert.deepEqual(readFileSync(join(dir, a.path)), png);
  assert.equal(a.bytes, png.length);

  const log = execFileSync("git", ["-C", dir, "log", "--oneline", "--name-only", "-1"], {
    encoding: "utf8",
  });
  assert.match(log, /portal: attach attachments\//);
  assert.match(log, /attachments\/2026-09-08-screenshot/);
});

test("the link is to the file on GitHub, on the branch it was committed to", () => {
  const dir = repo();
  const a = attach({
    repoDir: dir,
    repo: "acme/technology",
    name: "a.png",
    data: png,
    today: "2026-09-08",
  });
  assert.equal(a.url, "https://github.com/acme/technology/blob/main/attachments/2026-09-08-a.png");
});

test("a repo with no remote reports the failed push rather than claiming a link that works", () => {
  const dir = repo();
  const a = attach({
    repoDir: dir,
    repo: "acme/technology",
    name: "a.png",
    data: png,
    today: "2026-09-08",
  });
  assert.equal(a.pushed, false);
  assert.ok(a.note, "the reason the push did not happen should be on the result");
  // Committed anyway: the file is on disk and in history, which is what the note is about.
  assert.ok(existsSync(join(dir, a.path)));
});

test("the same name twice in a day does not overwrite the first", () => {
  const dir = repo();
  const first = attach({
    repoDir: dir,
    repo: "acme/x",
    name: "shot.png",
    data: png,
    today: "2026-09-08",
  });
  const second = attach({
    repoDir: dir,
    repo: "acme/x",
    name: "shot.png",
    data: Buffer.from("second"),
    today: "2026-09-08",
  });

  assert.equal(first.path, "attachments/2026-09-08-shot.png");
  assert.equal(second.path, "attachments/2026-09-08-shot-2.png");
  assert.deepEqual(readFileSync(join(dir, first.path)), png);
});

test("a name from a browser cannot walk out of the attachments directory", () => {
  const dir = repo();
  const a = attach({
    repoDir: dir,
    repo: "acme/x",
    name: "../../../etc/passwd",
    data: png,
    today: "2026-09-08",
  });
  assert.equal(a.path, "attachments/2026-09-08-passwd");
  assert.ok(existsSync(join(dir, a.path)));
});

test("what git should not be asked to hold is refused at the door", () => {
  const dir = repo();
  assert.throws(
    () =>
      attach({
        repoDir: dir,
        repo: "acme/x",
        name: "huge.mp4",
        data: Buffer.alloc(MAX_UPLOAD + 1),
        today: "2026-09-08",
      }),
    /larger than 25MB/,
  );
  assert.throws(
    () =>
      attach({
        repoDir: dir,
        repo: "acme/x",
        name: "empty.png",
        data: Buffer.alloc(0),
        today: "2026-09-08",
      }),
    /empty/,
  );
});

test("a repo that is not checked out says so, rather than writing somewhere else", () => {
  const dir = mkdtempSync(join(tmpdir(), "roster-attach-bare-"));
  assert.throws(
    () =>
      attach({ repoDir: dir, repo: "acme/nowhere", name: "a.png", data: png, today: "2026-09-08" }),
    /not checked out/,
  );
});
