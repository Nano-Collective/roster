import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

/**
 * roster is not a Claude harness that happens to be configurable. A runner is three shell-level
 * facts — install, run, and which env var carries the credential — and everything else is a
 * convenience. These tests care mostly that the escape hatch is real: an agent nobody has heard
 * of has to work without editing anything the framework owns.
 */

const mod = await import(
  `file://${join(import.meta.dirname, "..", "templates", "ops", "agents.mjs")}`
);
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
      assert.match(
        p.run,
        /\$AGENT_PROMPT_FILE/,
        `${id} must take the prompt from a file: it is thousands of words with quotes in it`,
      );
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
  assert.match(PRESETS.nanocoder.run, /\bnanocoder .* run /);
});

test("each preset carries the flags that make it survive a runner", () => {
  // Every one of these was read off the tool's own help or docs, not assumed.
  assert.match(PRESETS.codex.run, /exec -/, "the prompt arrives on stdin");
  assert.match(
    PRESETS.nanocoder.run,
    /--trust-directory/,
    "without it the first-run trust prompt hangs an unattended runner",
  );
  assert.match(PRESETS.nanocoder.run, /--plain/, "the TUI has nothing to draw to in CI");
  assert.match(
    PRESETS.nanocoder.run,
    /NANOCODER_PROVIDERS_FILE=.*roster-ops\/agents\.config\.json/,
    "nanocoder is a client, not a model: without a providers file it has nothing to call, " +
      "and the working directory in a session belongs to no repo",
  );
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
  const a = resolveAgent(
    {
      agent: {
        id: "some-future-thing",
        install: "cargo install future-agent",
        run: 'future-agent --headless < "$AGENT_PROMPT_FILE"',
        token_env: "FUTURE_TOKEN",
      },
    },
    {},
  );
  assert.equal(
    a.kind,
    "cli",
    "anything unrecognised is a CLI; only the reference runner is an action",
  );
  assert.equal(a.token_env, "FUTURE_TOKEN");
  assert.match(a.run, /future-agent/);
});

test("a preset can be overridden a field at a time", () => {
  // The common case is a preset that is right except for one flag.
  const a = resolveAgent(
    { agent: { id: "codex", run: "codex exec - --sandbox workspace-write" } },
    {},
  );
  assert.equal(a.install, PRESETS.codex.install, "the rest of the preset still applies");
  assert.match(a.run, /workspace-write/);
  assert.equal(a.token_env, "CODEX_API_KEY");
});

test("an unknown agent with no commands is refused, and the error says what to write", () => {
  /* Failing here is the whole point: the alternative is an empty run command, a workflow that
     exits 0 having done nothing, and a staff member that looks like it is working. */
  assert.throws(
    () => resolveAgent({ agent: { id: "nope" } }, {}),
    (err: Error) => {
      assert.match(err.message, /unknown agent "nope"/);
      assert.match(err.message, /Known: /, "it should say what it does know");
      assert.match(err.message, /install:/, "and how to describe one it does not");
      return true;
    },
  );
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

/* ---------------------------- permissions ---------------------------- */

test("one word in org.yaml becomes each agent's own way of saying it", () => {
  /* The point of the level. Claude takes a list of tool names, Codex a sandbox and an approval
     policy, nanocoder a development mode, and none of the three can read the others' spelling. */
  const flags = (agent: unknown, permissions?: string) =>
    resolveAgent({ agent, permissions }, {}).flags;

  assert.match(
    flags("claude"),
    /--allowedTools "Bash,Read,Write,Edit,Glob,Grep,WebFetch,WebSearch"/,
  );
  assert.match(flags("codex"), /--sandbox danger-full-access/);
  assert.match(flags("nanocoder"), /--mode yolo/);

  assert.match(flags("codex", "read-only"), /--sandbox read-only/);
  assert.match(flags("nanocoder", "read-only"), /--mode plan/, "plan edits nothing");
  assert.match(flags("claude", "read-only"), /--allowedTools "Read,Glob,Grep/);
  assert.ok(!/Write|Edit/.test(flags("claude", "read-only")), "and nothing that writes");

  assert.match(flags("codex", "workspace"), /--sandbox workspace-write/);
  assert.match(flags("nanocoder", "workspace"), /--mode auto-accept/);
});

test("an unattended run is never left waiting for an approval it cannot get", () => {
  // A sandbox that permits writes still stops to ask by default, and a run that stops to ask
  // at 07:00 times out having done nothing.
  for (const level of ["full", "workspace", "read-only"]) {
    assert.match(
      resolveAgent({ agent: "codex", permissions: level }, {}).flags,
      /approval_policy="never"/,
      `codex at ${level} must not wait for approval`,
    );
  }
});

test("an unknown permission level is refused rather than guessed at", () => {
  assert.throws(
    () => resolveAgent({ agent: "codex", permissions: "yolo" }, {}),
    /unknown permissions "yolo"/,
  );
});

test("options are passed through in the agent's own vocabulary", () => {
  // Codex takes -c key=value; the others take flags. Neither is roster's business to model.
  assert.match(
    resolveAgent({ agent: { id: "codex", options: { model_reasoning_effort: "high" } } }, {}).flags,
    /-c model_reasoning_effort='"high"'/,
  );
  assert.match(
    resolveAgent({ agent: { id: "nanocoder", options: { provider: "openrouter" } } }, {}).flags,
    /--provider 'openrouter'/,
  );
});

test("allowed_tools still wins for the agent whose vocabulary it is", () => {
  /* It predates the levels and is Claude's own spelling. Nothing translates it for the others:
     a tool list written for one agent is not a permission level for another. */
  const org = { agent: "claude", defaults: { allowed_tools: ["Read", "Glob"] } };
  assert.match(resolveAgent(org, {}).flags, /--allowedTools "Read,Glob"/);
  assert.match(
    resolveAgent({ ...org, agent: "codex" }, {}).flags,
    /--sandbox danger-full-access/,
    "codex has no idea what a Glob is; it gets the level instead",
  );
});

test("a staff member can be trusted less than the org", () => {
  const org = { agent: "codex", permissions: "full" };
  assert.match(resolveAgent(org, { permissions: "read-only" }).flags, /--sandbox read-only/);
});

test("nanocoder ships the config it cannot run without", () => {
  const { config } = resolveAgent({ agent: "nanocoder" }, {}) as any;
  assert.equal(config.path, "agents.config.json");
  const providers = config.contents.nanocoder.providers;
  assert.ok(Array.isArray(providers), "an array, which is what nanocoder reads");
  assert.match(providers[0].apiKey, /\$\{NANOCODER_API_KEY\}/, "the key is expanded, not stored");
  assert.match(JSON.stringify(providers[0].models), /FILL IN/, "and the blank says it is one");
  assert.equal(resolveAgent({ agent: "codex" }, {}).config, null, "codex needs no such file");
});
