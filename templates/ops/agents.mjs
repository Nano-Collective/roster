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
/* Claude says what an agent may do as a list of its own tool names. The three levels are the
   same list narrowed: everything, everything but the network, and nothing that writes. */
const CLAUDE_TOOLS = {
  full: '--allowedTools "Bash,Read,Write,Edit,Glob,Grep,WebFetch,WebSearch"',
  workspace: '--allowedTools "Bash,Read,Write,Edit,Glob,Grep"',
  "read-only": '--allowedTools "Read,Glob,Grep,WebFetch,WebSearch"',
};

/** Single quotes, because every one of these ends up inside `eval` in the session. */
function shellArg(v) {
  return `'${String(v).replace(/'/g, "'\\''")}'`;
}

export const PRESETS = {
  // The reference runner, and the default. Uses Anthropic's own action, which handles tool
  // permissions and output for us.
  "claude-code-action": {
    kind: "action",
    token_env: "CLAUDE_CODE_OAUTH_TOKEN",
    model: "claude-opus-5",
    permissions: CLAUDE_TOOLS,
    option: (k, v) => `--${k} ${shellArg(v)}`,
  },

  // The same agent through its plain CLI, for anyone who would rather not depend on the action.
  claude: {
    kind: "cli",
    install: "npm install -g @anthropic-ai/claude-code",
    run: 'claude -p --model "$AGENT_MODEL" $AGENT_FLAGS < "$AGENT_PROMPT_FILE"',
    token_env: "CLAUDE_CODE_OAUTH_TOKEN",
    model: "claude-opus-5",
    permissions: CLAUDE_TOOLS,
    option: (k, v) => `--${k} ${shellArg(v)}`,
  },

  codex: {
    kind: "cli",
    install: "npm install -g @openai/codex",
    // `exec -` reads the prompt from stdin. The sandbox has to be opened up because the whole
    // point of a session is that it edits the checkout and pushes.
    run: 'codex exec - --model "$AGENT_MODEL" $AGENT_FLAGS < "$AGENT_PROMPT_FILE"',
    token_env: "CODEX_API_KEY",
    model: "gpt-5-codex",
    /* Codex spells freedom as a sandbox plus an approval policy, and both have to be said:
       a sandbox that allows writes still stops to ask by default, and a run that stops to ask
       at 07:00 is a run that times out having done nothing. */
    permissions: {
      full: '--sandbox danger-full-access -c approval_policy="never"',
      workspace: '--sandbox workspace-write -c approval_policy="never"',
      "read-only": '--sandbox read-only -c approval_policy="never"',
    },
    // `-c key=value` is its highest-precedence override, so anything else goes through it.
    option: (k, v) => `-c ${k}=${shellArg(JSON.stringify(v))}`,
  },

  nanocoder: {
    kind: "cli",
    install: "npm install -g @nanocollective/nanocoder",
    /* `run` is its non-interactive mode; --trust-directory skips the first-run prompt that
       would otherwise hang a runner, and --plain avoids the TUI. The prompt is an argument
       here rather than stdin, so it is read out of the file.

       NANOCODER_PROVIDERS_FILE is the part that makes it work unattended. Nanocoder is a
       client, not a model: it reads its providers from `agents.config.json` found in the
       working directory. In a session that directory is the workspace root — the place the
       repos are checked out *into* — which belongs to no repo, so a committed config would
       never be found. Pointing at the ops repo's copy gives every staff member the same
       providers from a file that is version controlled. A missing file is ignored, so this is
       safe when somebody has configured it another way. */
    run:
      'NANOCODER_PROVIDERS_FILE="${NANOCODER_PROVIDERS_FILE:-roster-ops/agents.config.json}" ' +
      'nanocoder --model "$AGENT_MODEL" $AGENT_FLAGS --trust-directory --plain run "$(cat "$AGENT_PROMPT_FILE")"',
    token_env: "NANOCODER_API_KEY",
    model: "",
    /* Its development modes. `plan` is genuinely read-only: it reasons and proposes and edits
       nothing, which is the right answer for a staff member you are not ready to trust yet. */
    permissions: {
      full: "--mode yolo",
      workspace: "--mode auto-accept",
      "read-only": "--mode plan",
    },
    option: (k, v) => `--${k} ${shellArg(v)}`,
    /* A client rather than a model, so it cannot run until it has been told whose model to
       call. Written on init and reported by doctor when it is missing, because the failure
       without it is a run that installs, starts, finds no provider and exits. */
    config: {
      path: "agents.config.json",
      contents: {
        nanocoder: {
          providers: [
            {
              name: "openrouter",
              baseUrl: "https://openrouter.ai/api/v1",
              apiKey: "${NANOCODER_API_KEY}",
              models: ["FILL IN: a model this provider serves, and set it as `model` in org.yaml"],
            },
          ],
        },
      },
    },
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
    flags: flagsFor(merged, spec, org, staff),
    config: merged.config ?? null,
  };
}

/** The three levels, in the order a person would climb them. */
export const LEVELS = ["read-only", "workspace", "full"];

/**
 * What the agent is allowed to do, in its own words.
 *
 * org.yaml says `permissions: full` and every agent hears something different: Claude a list
 * of tool names, Codex a sandbox and an approval policy, nanocoder a development mode. The
 * translation lives here because it is the only place that knows which agent is running, and
 * because the alternative is a config file written in one tool's vocabulary that quietly means
 * nothing to the other two.
 *
 * `options` is the escape hatch, in that agent's own vocabulary, spelled onto its command line
 * by the preset. Anything roster does not model is still reachable without waiting for us.
 */
function flagsFor(merged, spec, org, staff) {
  const out = [];
  const asked = staff.permissions ?? spec.permissions ?? org.permissions ?? "full";
  if (!LEVELS.includes(asked)) {
    throw new Error(`unknown permissions "${asked}". One of: ${LEVELS.join(", ")}`);
  }

  /* `allowed_tools` predates the levels and is Claude's own vocabulary, so it still wins for
     an agent that takes a tool list. Nothing translates it for the others: a list written for
     one tool is not a permission level for another, and guessing would be worse than saying so. */
  const tools = staff.allowed_tools ?? org.defaults?.allowed_tools;
  const table = merged.permissions;
  if (tools && table === CLAUDE_TOOLS) {
    const list = Array.isArray(tools) ? tools.join(",") : String(tools);
    out.push(`--allowedTools "${list.replace(/\s+/g, "")}"`);
  } else if (table) {
    out.push(table[asked]);
  }

  const options = { ...(spec.options ?? {}), ...(staff.options ?? {}) };
  const speller = merged.option;
  for (const [k, v] of Object.entries(options)) {
    if (v === undefined || v === null || v === "") continue;
    if (!speller) {
      throw new Error(
        `agent "${merged.id ?? "custom"}" has options but no way to spell them.\n` +
          "  A custom agent takes its options in its own `run` command.",
      );
    }
    out.push(speller(k, v));
  }
  return out.filter(Boolean).join(" ");
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
    `flags<<AGENT_EOF_9c1f\n${agent.flags}\nAGENT_EOF_9c1f`,
  ].join("\n");
  process.stdout.write(out + "\n");
}
