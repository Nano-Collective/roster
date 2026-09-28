import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { initCommand } from "../src/commands/init.js";
import { opsTemplateDir, templateFiles } from "../src/lib/templates.js";
import { fakeGh, quietly, type Route } from "./helpers/fakegh.js";

/**
 * `roster init` as a command: the order it checks things in, what it refuses, what it writes
 * before it touches GitHub, and what it leaves behind when GitHub says no.
 *
 * init.test.ts covers the files themselves through `initFiles`. Here `gh` answers from a table
 * and `git push` is redirected to a bare repository in a temp directory, so the whole command
 * runs without the network and without anybody's org.
 */

const roots: string[] = [];
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function scratch() {
  const root = mkdtempSync(join(tmpdir(), "roster-initcmd-"));
  roots.push(root);
  return root;
}

const signedIn: Route = { match: /^api user /, stdout: { login: "sam-rivera" } };

async function init(routes: Route[], ...argv: string[]) {
  const gh = fakeGh(routes);
  try {
    const run = await quietly(() => initCommand(argv));
    return { ...run, calls: gh.calls() };
  } finally {
    gh.restore();
  }
}

test("no --org is refused before anything is asked of gh", async () => {
  const run = await init([signedIn]);
  assert.equal(run.value, 2);
  assert.match(run.err, /init needs --org/);
  assert.deepEqual(run.calls, []);
});

test("gh that is not signed in stops it, with the command that fixes it", async () => {
  const run = await init(
    [{ match: /^api user /, stderr: "HTTP 401: Bad credentials" }],
    "--org",
    "acme",
  );
  assert.equal(run.value, 1);
  assert.match(run.err, /gh auth login/);
});

test("without --apply it prints the plan and creates nothing", async () => {
  const root = scratch();
  const run = await init([signedIn], "--org", "acme", "--dir", root);
  assert.equal(run.value, 0);
  assert.equal(existsSync(join(root, "roster-ops")), false);
  assert.match(run.out, /Nothing was created\. Re-run with --apply/);
  // The human defaults to whoever gh says you are, and their marker to the login's first part.
  assert.match(run.out, /human\s+sam-rivera, tagged \[sam\]/);
  assert.match(run.out, /\+ org\/business\.md/);
  assert.deepEqual(
    run.calls.map((c) => c.slice(0, 2).join(" ")),
    ["api user"],
    "a dry run asks gh who you are and nothing else",
  );
});

test("an ops repo that already exists is never overwritten", async () => {
  const root = scratch();
  mkdirSync(join(root, "tenant-ops"), { recursive: true });
  writeFileSync(join(root, "tenant-ops", "org.yaml"), "org: acme\n");
  const run = await init(
    [signedIn],
    "--org",
    "acme",
    "--dir",
    root,
    "--ops",
    "tenant-ops",
    "--apply",
  );
  assert.equal(run.value, 2);
  assert.match(run.err, /already exists/);
  assert.equal(readFileSync(join(root, "tenant-ops", "org.yaml"), "utf8"), "org: acme\n");
});

test("when GitHub refuses the repo, the files are kept and nothing is committed", async () => {
  const root = scratch();
  const run = await init(
    [signedIn, { match: /^api orgs\/acme\/repos /, stderr: '{"message":"Must be an owner"}' }],
    "--org",
    "acme",
    "--human",
    "pat",
    "--dir",
    root,
    "--apply",
  );
  const ops = join(root, "roster-ops");
  assert.equal(run.value, 1);
  assert.match(run.err, /could not create acme\/roster-ops: Must be an owner/);
  assert.match(run.err, /The files are still in/);
  assert.ok(existsSync(join(ops, "org.yaml")));
  assert.ok(existsSync(join(ops, ".roster", "seed", "compose.mjs")), "the base is written first");
  assert.equal(existsSync(join(ops, ".git")), false, "no repo to push is no repo at all");
  assert.match(readFileSync(join(ops, "org.yaml"), "utf8"), /github: pat\n/);
});

test("--apply writes the tenant and its base, creates the repo private, and pushes main", async () => {
  const root = scratch();
  const remote = join(root, "remote.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);

  /* `git push` goes to https://github.com/acme/roster-ops.git. Rewritten to the bare repo for
     this process only, through git's environment config, so nothing leaves the machine. */
  const env = {
    // Nobody's own git config either: a global hook or signing key would make this their test.
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: `url.${remote}.insteadOf`,
    GIT_CONFIG_VALUE_0: "https://github.com/acme/roster-ops.git",
    GIT_CONFIG_KEY_1: "commit.gpgsign",
    GIT_CONFIG_VALUE_1: "false",
    GIT_AUTHOR_NAME: "test",
    GIT_AUTHOR_EMAIL: "test@example.invalid",
    GIT_COMMITTER_NAME: "test",
    GIT_COMMITTER_EMAIL: "test@example.invalid",
  };
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  let run: Awaited<ReturnType<typeof init>>;
  try {
    run = await init(
      [signedIn, { match: /^api orgs\/acme\/repos /, stdout: { full_name: "acme/roster-ops" } }],
      "--org",
      "acme",
      "--name",
      "Acme Bakeries",
      "--dir",
      root,
      "--apply",
    );
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }

  assert.equal(run.value, 0, run.err);
  const ops = join(root, "roster-ops");

  const create = run.calls.find((c) => c[1] === "orgs/acme/repos")!;
  assert.ok(create, "the repo is created through gh");
  assert.ok(create.includes("POST"));
  assert.ok(create.includes("name=roster-ops"));
  assert.ok(create.includes("private=true"), "an ops repo holds the org layer; it is never public");

  // The recorded base is the framework byte for byte, or the first upgrade merges against fiction.
  for (const rel of templateFiles(opsTemplateDir())) {
    assert.equal(
      readFileSync(join(ops, ".roster", "seed", rel), "utf8"),
      readFileSync(join(opsTemplateDir(), rel), "utf8"),
      rel,
    );
  }
  assert.match(readFileSync(join(ops, "org.yaml"), "utf8"), /^name: Acme Bakeries$/m);

  const pushed = execFileSync("git", ["-C", remote, "ls-tree", "-r", "--name-only", "main"], {
    encoding: "utf8",
  });
  assert.match(pushed, /^org\.yaml$/m);
  assert.match(pushed, /^\.roster\/seed\/compose\.mjs$/m, "the base is committed with the rest");
});

test("a flag missing its value, or one it does not know, is refused", async () => {
  await assert.rejects(() => initCommand(["--org"]), /--org needs a value/);
  await assert.rejects(
    () => initCommand(["--org", "acme", "--colour", "blue"]),
    /unknown flag --colour/,
  );
});
