import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadComposer } from "../src/lib/workspace.js";
// @ts-expect-error: vendored plain JS, with no types on purpose
import { describe, gather, isHuman, productRepos } from "../templates/ops/inflight.mjs";
import { makeTenant } from "./helpers/tenant.js";

/**
 * While a person had a long branch open rewriting a product's copy, the staff opened five pull
 * requests and nine issues chasing that copy. Nothing in the prompt said the branch existed.
 * These hold the three things that fix that: only people's work is listed, a wide branch is
 * summarised rather than pasted, and the list reaches the prompt as data.
 */

const NOW = Date.UTC(2026, 8, 28);
const pr = (over: Record<string, unknown> = {}) => ({
  number: 412,
  title: "Rewrite the landing copy",
  author: { login: "will", is_bot: false },
  createdAt: new Date(NOW - 12 * 86400_000).toISOString(),
  headRefName: "copy-rewrite",
  isDraft: false,
  changedFiles: 2,
  files: [{ path: "src/copy/home.ts" }, { path: "src/copy/pricing.ts" }],
  ...over,
});

test("only people count: Apps, bots and the staff's own identities are left out", () => {
  assert.equal(isHuman({ login: "will", is_bot: false }), true);
  assert.equal(isHuman({ login: "app/acme-robot", is_bot: true }), false);
  assert.equal(isHuman({ login: "dependabot[bot]", is_bot: false }), false);
  assert.equal(
    isHuman({ login: "acme-machine", is_bot: false }, ["acme-machine[bot]"]),
    false,
    "a bot named in staff.yaml is a bot however gh spells it",
  );
  assert.equal(isHuman(null), false);
});

test("a staff member's own works_in wins, and every product repo is the fallback", () => {
  const org = {
    org: "acme",
    repos: [
      { name: "web", role: "product" },
      { name: "cto", role: "brain" },
    ],
  };
  assert.deepEqual(productRepos(org, {}), ["acme/web"]);
  assert.deepEqual(productRepos(org, { works_in: [{ repo: "acme/app" }] }), ["acme/app"]);
});

test("each pull request says who, how long, which branch and which files", () => {
  const text = describe([{ repo: "acme/web", prs: [pr()] }], NOW);
  assert.match(text, /acme\/web#412\*\* "Rewrite the landing copy" by @will, open 12 days/);
  assert.match(text, /branch `copy-rewrite`, 2 files/);
  assert.match(text, /`src\/copy\/home\.ts`, `src\/copy\/pricing\.ts`/);
  assert.equal(describe([], NOW), "", "nothing open is no section at all");
});

test("a wide branch is capped and summarised by directory, not pasted whole", () => {
  const files = Array.from({ length: 100 }, (_, i) => ({
    path: i < 80 ? `src/copy/page${i}.ts` : `content/blog/post${i}.md`,
  }));
  const text = describe([{ repo: "acme/web", prs: [pr({ changedFiles: 340, files })] }], NOW);
  assert.match(text, /340 files/, "the real count, not the hundred gh returned");
  assert.match(text, /mostly under `src\/copy\/` \(80\), `content\/blog\/` \(20\)/);
  assert.match(text, /, and 320 more/);
  assert.equal((text.match(/`src\/copy\/page/g) ?? []).length, 20, "twenty files, no more");
});

test("gather asks each repo, keeps people's pull requests oldest first, and survives one failing", () => {
  const asked: string[] = [];
  const gh = (args: string[]) => {
    const repo = args[args.indexOf("--repo") + 1]!;
    asked.push(repo);
    if (repo === "acme/broken") throw new Error("HTTP 404");
    return JSON.stringify([
      pr({ number: 2, createdAt: "2026-09-20T00:00:00Z" }),
      pr({ number: 1, createdAt: "2026-08-01T00:00:00Z" }),
      pr({ number: 3, author: { login: "app/acme-robot", is_bot: true } }),
    ]);
  };
  const org = {
    org: "acme",
    repos: [
      { name: "broken", role: "product" },
      { name: "web", role: "product" },
    ],
  };
  const quiet = console.error;
  console.error = () => {};
  try {
    const found = gather({ org, manifest: {}, gh });
    assert.deepEqual(asked, ["acme/broken", "acme/web"]);
    assert.equal(found.length, 1);
    assert.deepEqual(
      found[0].prs.map((p: { number: number }) => p.number),
      [1, 2],
      "the long-lived branch first, and the App's pull request not at all",
    );
  } finally {
    console.error = quiet;
  }
});

test("the list reaches both prompts as data, and only when there is one", async () => {
  const root = mkdtempSync(join(tmpdir(), "roster-inflight-"));
  try {
    const ws = await makeTenant(root);
    const { compose } = await loadComposer(ws.opsDir);
    const args = { opsDir: ws.opsDir, brainsDir: ws.root, staff: "cto", kind: "daily" };
    const before = process.env.ROSTER_CONTEXT;
    process.env.ROSTER_CONTEXT = JSON.stringify({
      issue_number: "1",
      comment_id: "1",
      repo: "acme/cto",
    });
    try {
      assert.doesNotMatch(compose(args), /Human work in flight/, "no list, no section");

      writeFileSync(
        join(root, "inflight.md"),
        '- **acme/web#1** "Say {{staff.name}} less" by @will\n',
      );
      for (const kind of ["daily", "mention"]) {
        const text = compose({ ...args, kind, runDir: root } as never);
        assert.match(text, /## Human work in flight/, `${kind} does not carry it`);
        assert.match(text, /Do not open competing work on files they touch/);
        assert.match(
          text,
          /"Say \{\{staff\.name\}\} less"/,
          "a title is a person's words, substituted as they stand and never rendered",
        );
      }
    } finally {
      if (before === undefined) delete process.env.ROSTER_CONTEXT;
      else process.env.ROSTER_CONTEXT = before;
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
