import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";

/**
 * roster is not a Claude harness that happens to be configurable. A runner is three shell-level
 * facts — install, run, and which env var carries the credential — and everything else is a
 * convenience. These tests care mostly that the escape hatch is real: an agent nobody has heard
 * of has to work without editing anything the framework owns.
 */

const mod = await import(`file://${join(import.meta.dirname, "..", "templates", "ops", "agents.mjs")}`);
const { resolveAgent, PRESETS } = mod as {
  resolveAgent: (org: any, staff?: any) => any;
  PRESETS: Record<string, any>;
};

test("the default is the reference runner, so an org that says nothing keeps working", () => {
  const a = resolveAgent({}, {});
  assert.equal(a.id, "claude-code-action");
  assert.equal(a.kind, "action");
  assert.equal(a.token_env, "CLAUDE_CODE_OAUTH_TOKEN");
});

test("every preset says how to install it, how to run it, and what credential it needs", () => {
  for (const [id, p] of Object.entries(PRESETS)) {
    assert.ok(p.token_env, `${id} does not say which env var carries its credential`);
    if (p.kind === "cli") {
      assert.ok(p.install, `${id} has no install command`);
      assert.ok(p.run, `${id} has no run command`);
      assert.match(p.run, /\$AGENT_PROMPT_FILE/,
        `${id} must take the prompt from a file: it is thousands of words with quotes in it`);
    }
  }
});

test("the presets name packages that exist, with the binaries they actually install", () => {
  // Checked against npm rather than guessed at. @nanocollective, not @nano-collective.
  assert.match(PRESETS.claude.install, /@anthropic-ai\/claude-code/);
  assert.match(PRESETS.claude.run, /^claude /);
  assert.match(PRESETS.codex.install, /@openai\/codex/);
  assert.match(PRESETS.codex.run, /^codex exec/);
  assert.match(PRESETS.nanocoder.install, /@nanocollective\/nanocoder/);
  assert.match(PRESETS.nanocoder.run, /^nanocoder .* run /);
});

test("each preset carries the flags that make it survive a runner", () => {
  // Every one of these was read off the tool's own help or docs, not assumed.
  assert.match(PRESETS.codex.run, /--sandbox danger-full-access/,
    "a session edits the checkout and pushes; a sandbox that forbids that fails silently");
  assert.match(PRESETS.codex.run, /exec -/, "the prompt arrives on stdin");
  assert.match(PRESETS.nanocoder.run, /--trust-directory/,
    "without it the first-run trust prompt hangs an unattended runner");
  assert.match(PRESETS.nanocoder.run, /--plain/, "the TUI has nothing to draw to in CI");
});

test("an org can pick an agent by name", () => {
  const a = resolveAgent({ agent: { id: "codex" } }, {});
  assert.equal(a.kind, "cli");
  assert.equal(a.token_env, "CODEX_API_KEY");
  assert.match(a.install, /@openai\/codex/);
});

test("a bare string is a name too, because that is what people will write", () => {
  assert.equal(resolveAgent({ agent: "nanocoder" }, {}).id, "nanocoder");
});

test("one staff member can run a different agent from the rest", () => {
  /* The point of per-staff choice: a research role on a long-context model and an engineering
     role on a coding model are a reasonable thing to want. */
  const org = { agent: { id: "claude-code-action" } };
  assert.equal(resolveAgent(org, { agent: "codex" }).id, "codex");
  assert.equal(resolveAgent(org, {}).id, "claude-code-action");
});

test("an agent nobody has heard of works without touching the framework", () => {
  const a = resolveAgent({
    agent: {
      id: "some-future-thing",
      install: "cargo install future-agent",
      run: 'future-agent --headless < "$AGENT_PROMPT_FILE"',
      token_env: "FUTURE_TOKEN",
    },
  }, {});
  assert.equal(a.kind, "cli", "anything unrecognised is a CLI; only the reference runner is an action");
  assert.equal(a.token_env, "FUTURE_TOKEN");
  assert.match(a.run, /future-agent/);
});

test("a preset can be overridden a field at a time", () => {
  // The common case is a preset that is right except for one flag.
  const a = resolveAgent({ agent: { id: "codex", run: "codex exec - --sandbox workspace-write" } }, {});
  assert.equal(a.install, PRESETS.codex.install, "the rest of the preset still applies");
  assert.match(a.run, /workspace-write/);
  assert.equal(a.token_env, "CODEX_API_KEY");
});

test("an unknown agent with no commands is refused, and the error says what to write", () => {
  /* Failing here is the whole point: the alternative is an empty run command, a workflow that
     exits 0 having done nothing, and a staff member that looks like it is working. */
  assert.throws(() => resolveAgent({ agent: { id: "nope" } }, {}), (err: Error) => {
    assert.match(err.message, /unknown agent "nope"/);
    assert.match(err.message, /Known: /, "it should say what it does know");
    assert.match(err.message, /install:/, "and how to describe one it does not");
    return true;
  });
});

test("an agent with no credential env var is refused", () => {
  assert.throws(
    () => resolveAgent({ agent: { id: "x", install: "true", run: "true", token_env: "" } }, {}),
    /which env var carries its credential/,
  );
});

test("the staff member's model wins over the agent's default", () => {
  assert.equal(resolveAgent({ agent: "codex" }, { model: "gpt-5-mini" }).model, "gpt-5-mini");
  assert.equal(resolveAgent({ agent: "codex" }, {}).model, PRESETS.codex.model);
});
