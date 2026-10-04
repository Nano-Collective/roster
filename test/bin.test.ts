import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { bin, withBin } from "../src/lib/bin.js";

test("run through npx, commands are spelled the npx way", () => {
  assert.equal(bin({ npm_command: "exec" }, "/x/bin/roster"), "npx @nanocollective/roster@latest");
  assert.equal(
    bin({}, "/Users/a/.npm/_npx/abc/node_modules/.bin/roster"),
    "npx @nanocollective/roster@latest",
  );
});

test("installed, it is just roster, and ROSTER_BIN wins over both", () => {
  assert.equal(bin({}, "/usr/local/bin/roster"), "roster");
  assert.equal(
    bin({ ROSTER_BIN: "pnpm dlx @nanocollective/roster", npm_command: "exec" }),
    "pnpm dlx @nanocollective/roster",
  );
});

test("only a command is rewritten, not the word roster", () => {
  const n = "npx @nanocollective/roster@latest";
  assert.equal(withBin("run roster upgrade --apply", n), `run ${n} upgrade --apply`);
  assert.equal(withBin("0 on the roster. Hire someone", n), "0 on the roster. Hire someone");
  assert.equal(withBin("roster-ops is callable", n), "roster-ops is callable");
  assert.equal(withBin("run roster upgrade", "roster"), "run roster upgrade");
});

test("flags with no command go to the portal, not to unknown command", () => {
  const cli = (args: string[]) =>
    spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { encoding: "utf8" });

  // An unknown flag is the portal's to refuse, which proves the portal was the one asked.
  const flag = cli(["--not-a-flag", "x"]);
  assert.match(flag.stderr, /unknown flag --not-a-flag/);
  assert.doesNotMatch(flag.stderr, /unknown command/);

  // Help is still help, not the portal.
  const help = cli(["--help"]);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /roster help \[command\]/);
});
