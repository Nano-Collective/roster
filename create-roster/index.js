#!/usr/bin/env node
/**
 * `npm create roster`, which is the shortest thing a person can type to get started.
 *
 * It is deliberately a shim rather than a second implementation: everything it could do,
 * `roster` already does, and a create-* package that drifts from the tool it creates is worse
 * than not having one. All this decides is which directory you land in.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const arg = process.argv.slice(2).find((a) => !a.startsWith("-"));
const dir = resolve(arg ?? process.cwd());

if (arg) mkdirSync(dir, { recursive: true });

/* A workspace holds the ops repo and every brain repo side by side, so it wants a directory of
   its own. Landing in a full one is how you end up with roster-ops inside an unrelated project. */
if (!arg && existsSync(dir) && readdirSync(dir).some((f) => !f.startsWith("."))) {
  process.stderr.write(
    `\n  ${dir} is not empty.\n` +
      `  A roster workspace holds the ops repo and every staff repo side by side, so give it\n` +
      `  its own directory:\n\n      npm create roster my-org\n\n`,
  );
  process.exit(2);
}

/* Pinned to the matching line, so `npm create roster` and the package it runs cannot drift
   apart across a release. */
const child = spawn("npx", ["--yes", "@nanocollective/roster@0.1.0-alpha.2"], {
  cwd: dir,
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));
child.on("error", (err) => {
  process.stderr.write(`create-roster: could not start roster: ${err.message}\n`);
  process.exit(1);
});
