import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { available } from "../src/commands/brief.js";
import { briefCommands, briefTemplateDir, orgTokens, tokensFor } from "../src/lib/render.js";

/**
 * The briefs are how a charter, `org/business.md` and the house voice get written, and they
 * are the one place the framework could quietly become Claude-only again. The tests that
 * matter are that they render for any agent and that they say nothing about which one.
 */

const ORG = {
  org: "acme",
  name: "Acme",
  opsRepo: "acme/roster-ops",
  opsDirName: "roster-ops",
  human: "Ada",
  humanMarker: "ada",
};

const STAFF = {
  handle: "cto",
  name: "Chief Technology Officer",
  dir: "technology",
  brain: "acme/technology",
  mention: "@cto",
  statusIssue: 1,
  worksIn: [],
  schedule: "0 7 * * 1-5",
  model: "a-model",
  timeout: 90,
  mentionTimeout: 30,
  prMentionTimeout: 30,
  secretPrefix: "CTO",
  publicSecretPrefix: "PIPWEB",
  app: "acme-cto",
  publicApp: "acme-robot",
  publicTokenEnv: "PIPWEB_TOKEN",
  agentSecret: "AGENT_TOKEN",
};

test("there is a brief for each file a person actually writes", () => {
  /* `org/operating.md`, `voice.md` and `guardrails.md` ship written. A charter and
     `org/business.md` cannot, because they are the half that is about you. */
  assert.deepEqual(available(), ["charter", "discover", "voice"]);
});

test("every brief renders with the tokens the command can supply", () => {
  // A brief with a token nothing fills is a brief that tells an agent to read `%%DIR%%/x`.
  const org = orgTokens(ORG);
  const staff = tokensFor(ORG, STAFF);
  for (const kind of available()) {
    const text = readFileSync(join(briefTemplateDir(), `${kind}.md`), "utf8");
    const tokens = kind === "charter" ? staff : org;
    const out = text.replace(/%%([A-Z_]+)%%/g, (m, name: string) => tokens[name] ?? m);
    assert.ok(
      !/%%[A-Z_]+%%/.test(out),
      `${kind}.md has a token nothing fills: ${out.match(/%%[A-Z_]+%%/g)}`,
    );
    assert.ok(out.includes("Acme"), `${kind}.md never names the org`);
    assert.ok(out.includes("Ada"), `${kind}.md never names the human`);
  }
});

test("no brief names an agent", () => {
  /* The whole point. These are pasted into whatever the person uses, and a brief that says
     "in Claude Code, run /charter" is wrong for three of the four supported runners. */
  for (const kind of available()) {
    const text = readFileSync(join(briefTemplateDir(), `${kind}.md`), "utf8");
    for (const agent of ["Claude", "claude", "Codex", "codex", "nanocoder", "GPT", "Copilot"]) {
      assert.ok(!text.includes(agent), `briefs/${kind}.md names ${agent}`);
    }
    assert.ok(!text.includes("slash command"), `briefs/${kind}.md assumes a slash command`);
  }
});

test("a brief tells the agent what to do when it cannot read the repo", () => {
  // Pasted into a web chat, it has no filesystem. Every brief has to survive that.
  for (const kind of available()) {
    const text = readFileSync(join(briefTemplateDir(), `${kind}.md`), "utf8");
    assert.match(text, /cannot read files/, `briefs/${kind}.md assumes a checkout`);
  }
});

test("the Claude Code commands are generated from the briefs, not kept beside them", () => {
  /* Two copies of an interview script diverge, and only one of them ever gets updated. This
     is the check that they are one file. */
  const generated = briefCommands(["charter"], tokensFor(ORG, STAFF));
  const rendered = generated.get(".claude/commands/charter.md")!;
  assert.ok(rendered, "hire must write /charter");
  const source = readFileSync(join(briefTemplateDir(), "charter.md"), "utf8");
  assert.equal(
    rendered,
    source.replace(/%%([A-Z_]+)%%/g, (m, n: string) => tokensFor(ORG, STAFF)[n] ?? m),
    "the command must be the brief, filled in",
  );

  const org = briefCommands(["discover", "voice"], orgTokens(ORG));
  assert.deepEqual(
    [...org.keys()],
    [".claude/commands/discover.md", ".claude/commands/voice.md"],
    "init must write /discover and /voice",
  );
});

test("nothing ships a hand-maintained copy of a brief", () => {
  // templates/brain used to carry its own .claude/commands/charter.md.
  const brain = join(import.meta.dirname, "..", "templates", "brain");
  const claudeDir = join(brain, ".claude");
  let leftover: string[] = [];
  try {
    leftover = readdirSync(claudeDir);
  } catch {
    /* not there, which is the point */
  }
  assert.deepEqual(leftover, [], "templates/brain/.claude should be generated, not stored");
});
