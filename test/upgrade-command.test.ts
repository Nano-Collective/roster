import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { upgradeCommand } from "../src/commands/upgrade.js";
import { opsTemplateDir } from "../src/lib/templates.js";
import { quietly } from "./helpers/fakegh.js";
import { makeTenant } from "./helpers/tenant.js";

/**
 * `roster upgrade` end to end, against a generated tenant and the framework's real templates.
 *
 * upgrade.test.ts proves the planner and the merge on hand-made trees. What it cannot show is
 * the command's own decisions: what `--check` fails on, what `--apply` writes and refuses to
 * write, when the recorded base advances, and what happens in the brain repos. The framework
 * cannot be moved from a test, so "the framework has changed since" is staged the other way
 * round: the recorded base is set back to an older text.
 */

const roots: string[] = [];
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

async function tenant() {
  const root = mkdtempSync(join(tmpdir(), "roster-upcmd-"));
  roots.push(root);
  const ws = await makeTenant(root, { org: "acme" });
  const ops = (...p: string[]) => join(ws.opsDir, ...p);
  const seed = (...p: string[]) => join(ws.opsDir, ".roster", "seed", ...p);
  cpSync(opsTemplateDir(), seed(), { recursive: true });
  const tpl = (rel: string) => readFileSync(join(opsTemplateDir(), rel), "utf8");
  const read = (path: string) => readFileSync(path, "utf8");
  const upgrade = (...args: string[]) =>
    quietly(() => upgradeCommand([...args, "--ops", ws.opsDir]));
  return { root, ws, ops, seed, tpl, read, upgrade };
}

/** The template with one line rewritten: what the framework shipped before its latest change. */
function older(text: string, from: string, to: string): string {
  assert.ok(text.includes(from), `the template no longer contains ${JSON.stringify(from)}`);
  return text.replace(from, to);
}

test("a tenant straight from init is in sync: --check passes and nothing is proposed", async () => {
  const t = await tenant();
  const { value, out } = await t.upgrade("--check");
  assert.equal(value, 0, out);
  assert.doesNotMatch(out, /Re-run with --apply/);
});

test("a file the tenant never touched follows the framework, and the base advances with it", async () => {
  const t = await tenant();
  const now = t.tpl("org/voice.md");
  const then = older(now, "# Voice", "# House voice");
  writeFileSync(t.seed("org/voice.md"), then);
  writeFileSync(t.ops("org/voice.md"), then);

  let run = await t.upgrade("--check");
  assert.equal(run.value, 1, "--check fails while a file is behind");

  run = await t.upgrade();
  assert.equal(run.value, 0, "a dry run is not a failure");
  assert.match(run.out, /↑ org\/voice\.md\s+updated from the framework/);
  assert.match(run.out, /Nothing was written\. Re-run with --apply/);
  assert.equal(t.read(t.ops("org/voice.md")), then, "and it wrote nothing");

  run = await t.upgrade("--apply");
  assert.equal(run.value, 0);
  assert.equal(t.read(t.ops("org/voice.md")), now);
  assert.equal(t.read(t.seed("org/voice.md")), now, "the base is what was just merged against");
  assert.ok(existsSync(t.ops(".roster-version")));
  assert.equal((await t.upgrade("--check")).value, 0, "and a second look finds nothing to do");
});

test("a conflict is written beside the file, never into it, and the base does not move", async () => {
  const t = await tenant();
  const now = t.tpl("org/voice.md");
  const then = older(now, "# Voice", "# House voice");
  writeFileSync(t.seed("org/voice.md"), then);
  const mine = older(now, "# Voice", "# Our voice, not yours");
  writeFileSync(t.ops("org/voice.md"), mine);
  writeFileSync(t.ops(".roster-version"), "before\n");

  const run = await t.upgrade("--apply");
  assert.equal(run.value, 1, "a conflict left for a human is not a success");
  assert.match(run.out, /wrote org\/voice\.md\.roster-merge/);
  assert.equal(t.read(t.ops("org/voice.md")), mine, "an agent reads this file every morning");
  assert.match(t.read(t.ops("org/voice.md.roster-merge")), /^<{7}/m);
  assert.equal(t.read(t.seed("org/voice.md")), then, "or the next attempt has nothing to merge");
  assert.equal(
    t.read(t.ops(".roster-version")),
    "before\n",
    "and the tenant is not stamped as upgraded",
  );
});

test("an edited framework-owned file is never overwritten, and --check will not pass it", async () => {
  /* The framework has not moved, so there is nothing to write; the edit is reported because it
     survives only until the framework next touches this file. */
  const t = await tenant();
  appendFileSync(t.ops("runner-plan.mjs"), "\n// a fix made in the wrong place\n");

  assert.equal((await t.upgrade("--check")).value, 1);
  const run = await t.upgrade("--apply");
  assert.equal(run.value, 1, "--apply agrees with --check about an edited framework file");
  assert.match(run.out, /! runner-plan\.mjs\s+edited here, but the framework owns it/);
  assert.match(run.out, /That is how a fix gets quietly reverted/);
  assert.match(t.read(t.ops("runner-plan.mjs")), /a fix made in the wrong place/);
});

test("an edited framework file still takes the framework's change, and stays flagged", async () => {
  const t = await tenant();
  const now = t.tpl("runner-plan.mjs");
  const then = older(now, "export { main };", "export { main as plan };");
  writeFileSync(t.seed("runner-plan.mjs"), then);
  writeFileSync(t.ops("runner-plan.mjs"), `// a fix made in the wrong place\n${then}`);

  const run = await t.upgrade("--apply");
  assert.equal(run.value, 1, "the merge landed, but the tenant is not clean");
  assert.match(run.out, /merged, but this is a framework file/);
  const merged = t.read(t.ops("runner-plan.mjs"));
  assert.match(merged, /^\/\/ a fix made in the wrong place/, "the tenant's line survives");
  assert.match(merged, /export \{ main \};/, "and the framework's change arrives");
  assert.equal(t.read(t.seed("runner-plan.mjs")), now);

  const again = await t.upgrade("--check");
  assert.equal(again.value, 1, "merged is not the same as fixed: the edit is still in the tenant");
  assert.match(again.out, /edited here, but the framework owns it/);
});

test("a file new in the framework is added by --apply", async () => {
  const t = await tenant();
  rmSync(t.ops("org/guardrails.md"));
  rmSync(t.seed("org/guardrails.md"));
  const run = await t.upgrade("--apply");
  assert.match(run.out, /\+ org\/guardrails\.md\s+new in the framework/);
  assert.equal(t.read(t.ops("org/guardrails.md")), t.tpl("org/guardrails.md"));
});

test("a file with no recorded base is left alone and points at --baseline", async () => {
  const t = await tenant();
  rmSync(t.seed("org/voice.md"));
  appendFileSync(t.ops("org/voice.md"), "\nOur own rule.\n");
  const run = await t.upgrade("--apply");
  assert.equal(run.value, 1);
  assert.match(run.out, /roster upgrade --baseline <git-ref>/);
  assert.match(t.read(t.ops("org/voice.md")), /Our own rule/);
});

test("in a brain repo, an edited caller is shown as a diff and regenerated; a dropped one is removed", async () => {
  const t = await tenant();
  const wf = join(t.root, "cto", ".github", "workflows");
  const daily = join(wf, "cto-daily.yaml");
  const generated = t.read(daily);
  writeFileSync(daily, generated.replace("timeout_minutes: 90", "timeout_minutes: 45"));
  // A caller an older framework generated and this one does not: it still dispatches.
  writeFileSync(
    join(wf, "cto-weekly.yaml"),
    "jobs:\n  run:\n    uses: acme/roster-ops/.github/workflows/session.yaml@main\n",
  );
  // And the staff member's own workflow, which is not roster's to remove.
  writeFileSync(join(wf, "canary.yaml"), "jobs:\n  c:\n    runs-on: ubuntu-latest\n");

  let run = await t.upgrade();
  assert.match(run.out, /↑ \.github\/workflows\/cto-daily\.yaml\s+differs from the template/);
  assert.match(run.out, /-\s+timeout_minutes: 45/);
  assert.match(
    run.out,
    /- \.github\/workflows\/cto-weekly\.yaml\s+the framework no longer generates/,
  );
  assert.doesNotMatch(run.out, /canary/);
  assert.equal((await t.upgrade("--check")).value, 1);

  run = await t.upgrade("--apply");
  assert.equal(run.value, 0);
  assert.equal(t.read(daily), generated);
  assert.deepEqual(readdirSync(wf).sort(), ["canary.yaml", "cto-daily.yaml", "cto-mention.yaml"]);
  assert.match(run.out, /regenerated 2 caller workflows/);
});

test("a charter or memory the staff member rewrote is theirs; one that went missing comes back", async () => {
  const t = await tenant();
  const brain = join(t.root, "cto");
  writeFileSync(join(brain, "CHARTER.md"), "# Entirely rewritten by the agent\n");
  rmSync(join(brain, "README.md"));

  const run = await t.upgrade("--apply");
  assert.equal(t.read(join(brain, "CHARTER.md")), "# Entirely rewritten by the agent\n");
  assert.ok(existsSync(join(brain, "README.md")), "a scaffold file the tenant lacks is added");
  assert.match(run.out, /\+ README\.md\s+new in the framework/);
});

test("flags: --apply and --check together, or an unknown one, are refused before anything runs", async () => {
  const t = await tenant();
  await assert.rejects(() => t.upgrade("--apply", "--check"), /pick one/);
  await assert.rejects(() => t.upgrade("--force"), /unknown flag --force/);
});

test("--baseline at a ref that does not exist fails and leaves the recorded base alone", async () => {
  const t = await tenant();
  const before = t.read(t.seed("org/voice.md"));
  const run = await t.upgrade("--baseline", "no-such-ref-anywhere");
  assert.equal(run.value, 2);
  assert.match(run.err, /cannot read templates\/ops at "no-such-ref-anywhere"/);
  assert.equal(t.read(t.seed("org/voice.md")), before, "a failed baseline must not wipe the base");
});

test("--baseline at a real ref records the framework's templates as they were", async (ctx) => {
  const framework = join(opsTemplateDir(), "..", "..");
  let head: string;
  try {
    head = execFileSync("git", ["-C", framework, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    ctx.skip("the framework is not a git checkout here");
    return;
  }
  const t = await tenant();
  // A base left over from somewhere else: the baseline replaces the whole base, not a part.
  writeFileSync(t.seed("stray.md"), "not the framework's\n");

  const run = await t.upgrade("--baseline", head);
  assert.equal(run.value, 0, run.err);
  const shipped = execFileSync(
    "git",
    ["-C", framework, "show", `${head}:templates/ops/compose.mjs`],
    { encoding: "utf8" },
  );
  assert.equal(t.read(t.seed("compose.mjs")), shipped);
  assert.equal(t.read(t.ops(".roster-version")), `${head}\n`);
  assert.equal(existsSync(t.seed("stray.md")), false);
});
