#!/usr/bin/env node
/**
 * Which coding agent actually runs a session, and how to invoke it.
 *
 * VENDORED into every tenant's ops repo, for the same reason compose.mjs is: a scheduled run at
 * 07:00 must not depend on npm, on a network fetch, or on an org the tenant does not control.
 *
 * roster knows nothing about any particular agent. A runner is three shell-level facts — how to
 * install it, how to run it, and which environment variable carries its credential — and the
 * presets below are conveniences, not a closed list. Anything with a command line that accepts a
 * prompt works; see `agent:` in org.yaml.
 *
 * The prompt is always handed over as a file, never as an argument. It is thousands of words,
 * it contains quotes and backticks, and argv limits and shell quoting are exactly the sort of
 * thing that fails at 07:00 on a Tuesday rather than in review.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseYaml } from "./compose.mjs";

/**
 * `action` is a GitHub Action step, which has to be written into session.yaml literally —
 * `uses:` cannot be an expression. Only the reference Claude runner is one of these.
 * `cli` is everything else: install a package, run a command. That path is open-ended.
 */
export const PRESETS = {
  // The reference runner, and the default. Uses Anthropic's own action, which handles tool
  // permissions and output for us.
  "claude-code-action": {
    kind: "action",
    token_env: "CLAUDE_CODE_OAUTH_TOKEN",
    model: "claude-opus-5",
  },

  // The same agent through its plain CLI, for anyone who would rather not depend on the action.
  claude: {
    kind: "cli",
    install: "npm install -g @anthropic-ai/claude-code",
    run: 'claude -p --model "$AGENT_MODEL" --allowedTools "$AGENT_TOOLS" < "$AGENT_PROMPT_FILE"',
    token_env: "CLAUDE_CODE_OAUTH_TOKEN",
    model: "claude-opus-5",
  },

  codex: {
    kind: "cli",
    install: "npm install -g @openai/codex",
    // `exec -` reads the prompt from stdin. The sandbox has to be opened up because the whole
    // point of a session is that it edits the checkout and pushes.
    run: 'codex exec - --model "$AGENT_MODEL" --sandbox danger-full-access < "$AGENT_PROMPT_FILE"',
    token_env: "CODEX_API_KEY",
    model: "gpt-5-codex",
  },

  nanocoder: {
    kind: "cli",
    install: "npm install -g @nanocollective/nanocoder",
    // `run` is its non-interactive mode; --trust-directory skips the first-run prompt that
    // would otherwise hang a runner, and --plain avoids the TUI. The prompt is an argument
    // here rather than stdin, so it is read out of the file.
    run: 'nanocoder --model "$AGENT_MODEL" --mode yolo --trust-directory --plain run "$(cat "$AGENT_PROMPT_FILE")"',
    token_env: "NANOCODER_API_KEY",
    model: "",
  },
};

/**
 * The runner for a staff member: the org's choice, overridden per staff member, overridden by
 * anything written out longhand. A tenant that needs an agent nobody has heard of writes
 * `install`, `run` and `token_env` and never touches this file.
 */
export function resolveAgent(org, staff = {}) {
  const asked = staff.agent ?? org.agent ?? {};
  const spec = typeof asked === "string" ? { id: asked } : asked;
  const id = spec.id ?? "claude-code-action";
  const preset = PRESETS[id];

  if (!preset && !(spec.install && spec.run)) {
    throw new Error(
      `unknown agent "${id}", and no install/run given.\n` +
      `  Known: ${Object.keys(PRESETS).join(", ")}\n` +
      `  Or describe your own in org.yaml:\n` +
      `    agent:\n      id: ${id}\n      install: <shell>\n      run: <shell>\n      token_env: <VAR>`,
    );
  }

  const merged = { kind: "cli", ...(preset ?? {}), ...strip(spec) };
  if (merged.kind === "cli" && !merged.run) throw new Error(`agent "${id}" has no run command`);
  if (!merged.token_env) throw new Error(`agent "${id}" does not say which env var carries its credential`);

  return {
    id,
    kind: merged.kind,
    install: merged.install ?? "",
    run: merged.run ?? "",
    token_env: merged.token_env,
    // The staff member's own model wins; then the agent's default. Empty means "the agent's".
    model: staff.model ?? merged.model ?? "",
  };
}

function strip(o) {
  const out = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== "") out[k] = v;
  delete out.id;
  return out;
}

/* --------------------------------- the runner --------------------------------- */

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const at = (flag) => { const i = args.indexOf(flag); return i === -1 ? undefined : args[i + 1]; };
  const opsDir = at("--ops") ?? "roster-ops";
  const brainsDir = at("--brains") ?? ".";
  const handle = at("--staff");

  const org = parseYaml(readFileSync(join(opsDir, "org.yaml"), "utf8"), "org.yaml");
  const entry = (org.staff ?? []).find((s) => s.handle === handle);
  if (!entry) {
    process.stderr.write(`agents: no staff member "${handle}" in org.yaml\n`);
    process.exit(2);
  }

  let manifest = {};
  try {
    const dir = entry.dir ?? entry.handle;
    manifest = parseYaml(readFileSync(join(brainsDir, dir, "staff.yaml"), "utf8"), "staff.yaml");
  } catch {
    /* A staff member with no manifest is doctor's problem; the org's default still resolves. */
  }

  const agent = resolveAgent(org, manifest);
  const out = [
    `kind=${agent.kind}`,
    `id=${agent.id}`,
    `token_env=${agent.token_env}`,
    `model=${agent.model}`,
    `install<<AGENT_EOF_9c1f\n${agent.install}\nAGENT_EOF_9c1f`,
    `run<<AGENT_EOF_9c1f\n${agent.run}\nAGENT_EOF_9c1f`,
  ].join("\n");
  process.stdout.write(out + "\n");
}
