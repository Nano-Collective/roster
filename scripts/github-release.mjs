#!/usr/bin/env node
/**
 * The GitHub Release for the version just published to npm. Runs as `postpublish`, so it only
 * happens once npm has the version: a release can't exist for a publish that failed.
 *
 * The docs site finds Roster's versions through GitHub Releases, not npm or git tags, so a
 * version published without one never shows up there.
 *
 * The notes are the subjects of the commits since the last `release:` commit. Edit them on
 * GitHub afterwards if they want more than that.
 *
 *   node scripts/github-release.mjs            create the release (a no-op if it exists)
 *   node scripts/github-release.mjs --dry-run  print what it would create
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (cmd, args) =>
  execFileSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const dryRun = process.argv.includes("--dry-run");

const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const tag = `v${version}`;
const sha = run("git", ["rev-parse", "HEAD"]);

const exists = (() => {
  try {
    run("gh", ["release", "view", tag, "--json", "tagName"]);
    return true;
  } catch {
    return false;
  }
})();
if (exists && !dryRun) {
  console.log(`github-release: ${tag} already has a GitHub Release`);
  process.exit(0);
}

/* GitHub can only tag a commit it has. */
run("git", ["fetch", "--quiet", "origin"]);
if (!dryRun && !run("git", ["branch", "--remotes", "--contains", sha])) {
  console.error(
    `github-release: ${sha.slice(0, 7)} isn't pushed, so ${tag} has no GitHub Release.\n` +
      "Push it, then run: node scripts/github-release.mjs",
  );
  process.exit(1);
}

const previous = run("git", ["log", "--format=%H", "--grep=^release: ", "-n", "1", `${sha}~1`]);
const subjects = run("git", ["log", "--format=%s", "--reverse", `${previous}..${sha}`])
  .split("\n")
  .filter((s) => s && !s.startsWith("release: "));
const notes = subjects.length ? subjects.map((s) => `- ${s}`).join("\n") : `Release ${tag}.`;

const args = ["release", "create", tag, "--target", sha, "--title", tag, "--notes", notes];
if (version.includes("-")) args.push("--prerelease");

if (dryRun) {
  console.log(`gh ${args.slice(0, 7).join(" ")}${version.includes("-") ? " --prerelease" : ""}`);
  console.log(`\n${notes}`);
} else {
  console.log(run("gh", args));
}
