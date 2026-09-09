---
title: "Choosing a coding agent"
description: "Claude, Codex, Nanocoder, or anything with a command line."
sidebar_order: 4
---

# Choosing a coding agent

roster is not a Claude harness. It composes a prompt, hands it to a coding agent, and gets out
of the way. **Any agent with a command line that accepts a prompt works.**

A runner is three facts:

| | |
|---|---|
| `install` | a shell command that puts the agent on the runner |
| `run` | a shell command that runs it, reading the prompt from `$AGENT_PROMPT_FILE` |
| `token_env` | the environment variable its credential goes in |

That is the whole interface. Everything else is a convenience.

## Picking one

In `org.yaml`. This block is the whole surface: choose an agent, say how much freedom it gets,
and pass anything else through in that agent's own words.

```yaml
agent:
  id: codex
  permissions: full        # full | workspace | read-only
  options:                 # optional, and in codex's vocabulary rather than roster's
    model_reasoning_effort: high
```

The short form is the same thing with the defaults:

```yaml
agent: codex
```

### `permissions`

One word here, because "how much may this thing do without asking" is a question about your
org rather than about a vendor. Each agent hears it in its own vocabulary:

| | `read-only` | `workspace` | `full` |
|---|---|---|---|
| **claude** | `--allowedTools Read,Glob,Grep,WebFetch,WebSearch` | the same plus `Bash,Write,Edit` | plus `WebFetch,WebSearch` |
| **codex** | `--sandbox read-only` | `--sandbox workspace-write` | `--sandbox danger-full-access` |
| **nanocoder** | `--mode plan` | `--mode auto-accept` | `--mode yolo` |

`full` is the default and is what a daily session needs: the whole point of a run is that it
edits the checkout, commits and pushes. `workspace` keeps it off the network. `read-only` is
for a staff member you are not ready to trust yet, and it is genuinely read-only in all three:
nanocoder's `plan` mode reasons and proposes and edits nothing.

Codex also gets `approval_policy="never"` at every level. A sandbox that permits writes still
stops to ask by default, and a run that stops to ask at 07:00 is a run that times out having
done nothing.

A staff member can be trusted less than the org:

```yaml
# marketing/staff.yaml
permissions: workspace
```

### `options`

Anything roster does not model, in the agent's own words, spelled onto its command line by the
preset: `-c key=value` for codex, `--key value` for the others. It is the escape hatch that
means a flag roster has never heard of is still reachable without waiting for us.

A staff member can override it in their own `staff.yaml`, which is worth doing when roles
differ in kind. A research role on a long-context model and an engineering role on a coding
model is a reasonable thing to want:

```yaml
# marketing/staff.yaml
agent: claude
model: claude-opus-5
```

## The presets

Every command below was read off the tool's own help output or its documentation, not assumed.
They will drift. When one does, override the field rather than waiting for us: see
[writing your own](#writing-your-own).

### `claude-code-action` (default)

Claude Code through Anthropic's GitHub Action. This is the reference runner and the one this
project is exercised against daily.

```yaml
agent: claude-code-action
```

- credential: `CLAUDE_CODE_OAUTH_TOKEN`
- default model: `claude-opus-5`
- tool permissions come from `allowed_tools` on the caller, which roster renders from
  `defaults.allowed_tools` in org.yaml

That allowlist is Claude's own vocabulary, and it is the one setting on this page that does not
translate. Codex takes a sandbox mode rather than a tool list; nanocoder takes a development
mode. Both presets therefore ignore `$AGENT_TOOLS` entirely, and neither is any less restricted
for it: what bounds them is the sandbox flag in their own `run` command. If you switch agents,
`allowed_tools` stops being the thing that governs what the agent may touch, and the `run`
command becomes it.

It is the only preset that is a GitHub Action rather than a CLI. `uses:` in a workflow cannot
be an expression, so an Action-based runner has to be written into `session.yaml` literally.
That is why there is exactly one of them, and why everything else goes through the generic
path.

### `claude`

The same agent through its plain CLI, if you would rather not depend on the Action.

```
install:   npm install -g @anthropic-ai/claude-code
run:       claude -p --model "$AGENT_MODEL" --allowedTools "$AGENT_TOOLS" < "$AGENT_PROMPT_FILE"
token_env: CLAUDE_CODE_OAUTH_TOKEN
```

### `codex`

OpenAI's Codex CLI.

```
install:   npm install -g @openai/codex
run:       codex exec - --model "$AGENT_MODEL" --sandbox danger-full-access < "$AGENT_PROMPT_FILE"
token_env: CODEX_API_KEY
```

`exec -` reads the prompt from standard input. The sandbox is opened up because the entire
point of a session is that it edits the checkout and pushes; a sandbox that forbids writes
produces a run that succeeds having done nothing. If you would rather keep it narrower,
`--sandbox workspace-write` is the option to try first.

### `nanocoder`

```
install:   npm install -g @nanocollective/nanocoder
run:       NANOCODER_PROVIDERS_FILE="${NANOCODER_PROVIDERS_FILE:-roster-ops/agents.config.json}" \
             nanocoder --model "$AGENT_MODEL" --mode yolo --trust-directory --plain run "$(cat "$AGENT_PROMPT_FILE")"
token_env: NANOCODER_API_KEY
```

Three flags matter for unattended use. `run` is its non-interactive mode. `--trust-directory`
skips the first-run directory trust prompt, which would otherwise hang the runner until it
times out. `--plain` avoids the TUI, which has nothing to draw to in CI.

**Nanocoder needs one thing the other two do not: a provider.** It is a client rather than a
model, so `NANOCODER_API_KEY` on its own tells it nothing about where to send anything. That is
what the config file is for, and it is the part of this that catches people out. It has its own
section: [wiring up nanocoder](#wiring-up-nanocoder).

## Setting one up, end to end

The preset only says how to invoke the agent. Three more things have to be true before a run
works, and `roster doctor` checks all three.

### 1. The credential exists, and you have it

| Agent | Where the credential comes from |
|---|---|
| `claude-code-action`, `claude` | `claude setup-token` in a terminal where Claude Code is signed in. It prints a long-lived OAuth token. A plain Anthropic API key also works if you would rather bill that way. |
| `codex` | an API key from the OpenAI platform console. `codex login` is for interactive use and does not produce something a runner can hold. |
| `nanocoder` | whatever the provider you point it at wants. Nanocoder is a client, not a model: the key belongs to the provider in `agents.config.json`. |

### 2. It is a secret on every brain repo, under the right name

Each staff member's caller workflow reads the secret **from their own repo**, so the credential
goes on each brain, not on the ops repo:

```bash
gh secret set CODEX_API_KEY --repo playpip/technology --body "$KEY"
gh secret set CODEX_API_KEY --repo playpip/marketing  --body "$KEY"
```

The name is the preset's `token_env`, and it is the same name the caller references. If you
override `token_env`, the callers have to be regenerated so they reference the new name:
`roster upgrade --apply`.

Inside the run it arrives twice: as `AGENT_TOKEN`, which is what the caller passes, and under
the agent's own `token_env`, which is what the agent reads. That indirection is why a preset
change does not require touching `session.yaml`.

### 3. The agent's own config, if it has one

`claude` and `codex` need none: they are a model and a client in one thing, and the model comes
from `$AGENT_MODEL`. `nanocoder` needs a providers file, below.

### Then prove it

```bash
roster doctor                    # secrets present, callers reachable, prompts compose
gh workflow run cto-daily.yaml --repo playpip/technology
```

Read the log of that first run rather than waiting for the schedule. What goes wrong is
specific to the agent and obvious in the log: an unknown flag, a sandbox that refuses to write,
a model id the provider does not recognise, a first-run prompt waiting for a keypress that will
never come.

## Three worked examples

An org called `acme` with two staff members, `cto` in `acme/technology` and `cmo` in
`acme/marketing`. Every file each one touches, in full.

### Claude, through the Action

```yaml
# roster-ops/org.yaml
org: acme
agent:
  id: claude-code-action      # the default; the whole block can be left out

defaults:
  model: claude-opus-5
```

```bash
claude setup-token            # prints a long-lived token
gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo acme/technology --body "$TOKEN"
gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo acme/marketing  --body "$TOKEN"
```

Nothing else. No file in the brain repos, no per-staff config.

### Codex

```yaml
# roster-ops/org.yaml
agent:
  id: codex
  permissions: full           # --sandbox danger-full-access, approval_policy never

defaults:
  model: gpt-5-codex          # what $AGENT_MODEL becomes
```

```bash
gh secret set CODEX_API_KEY --repo acme/technology --body "$OPENAI_KEY"
gh secret set CODEX_API_KEY --repo acme/marketing  --body "$OPENAI_KEY"
roster upgrade --apply        # repoints the callers at the new secret name
```

Commit and push the regenerated callers. The secret name changed from
`CLAUDE_CODE_OAUTH_TOKEN` to `CODEX_API_KEY`, and that name is written into each caller.

### Nanocoder

Two files rather than one, because a provider has to be named.

```yaml
# roster-ops/org.yaml
agent:
  id: nanocoder
  permissions: full           # --mode yolo

defaults:
  model: qwen/qwen3-coder     # must be one of the models listed below
```

`roster init --agent nanocoder` writes this file for you, with the blanks marked. Fill them in:

```json
// roster-ops/agents.config.json
{
  "nanocoder": {
    "providers": [
      {
        "name": "openrouter",
        "baseUrl": "https://openrouter.ai/api/v1",
        "apiKey": "${NANOCODER_API_KEY}",
        "models": ["qwen/qwen3-coder"]
      }
    ]
  }
}
```

```bash
gh secret set NANOCODER_API_KEY --repo acme/technology --body "$OPENROUTER_KEY"
gh secret set NANOCODER_API_KEY --repo acme/marketing  --body "$OPENROUTER_KEY"
roster upgrade --apply
```

Commit `agents.config.json` and the regenerated callers. **The key is not in the file.**
`${NANOCODER_API_KEY}` is expanded from the environment when nanocoder reads it, and the
environment is where roster puts the secret.

## Wiring up nanocoder

The other two presets are one thing. Nanocoder is a harness you point at a model, so it needs
to be told which model, from whom, at what URL, with which key. That is `agents.config.json`.

### Where it looks

In order, and the first hit wins:

1. `$NANOCODER_PROVIDERS`: the JSON itself, in an environment variable.
2. `$NANOCODER_PROVIDERS_FILE`: a path to the JSON. Ignored if the file is not there.
3. `agents.config.json` in the **working directory**.
4. `agents.config.json` in the user config directory (`~/.config/nanocoder/` on Linux,
   `~/Library/Preferences/nanocoder/` on macOS).

Options 3 and 4 are what you use at your own desk, and neither of them works in a session. The
working directory of a run is the **workspace root**: the directory the repos are checked out
*into*, one level above `technology/` and `roster-ops/`. It belongs to no repository, so there
is nothing there to commit a config into. And the user config directory on a fresh GitHub
runner is empty.

That is why roster's preset sets option 2 for you:

```
NANOCODER_PROVIDERS_FILE="${NANOCODER_PROVIDERS_FILE:-roster-ops/agents.config.json}"
```

The ops repo is checked out at a known path on every run, and it is the one repo every staff
member has. So the org's providers live in one version-controlled file, and each staff member
picks a model from it with `model:` in their own `staff.yaml`.

### The shape

Either of these; the wrapper is what nanocoder writes itself, the bare form is accepted too.

```json
{ "nanocoder": { "providers": [ … ] } }
{ "providers": [ … ] }
```

A provider is:

| Field | |
|---|---|
| `name` | what `--provider` and the model list refer to. Any string. |
| `baseUrl` | the OpenAI-compatible endpoint. Omit for a provider the SDK already knows. |
| `apiKey` | the credential. Use `${VAR}`, never a literal, in a file you are committing. |
| `models` | the models this provider offers. **If it is non-empty, `$AGENT_MODEL` must be one of them**, or the run fails with "Model not available for provider". |
| `sdkProvider` | `openai-compatible` (default), `anthropic`, `google`, `chatgpt-codex`, `github-copilot`. |

`${VAR}` and `$VAR` are both expanded, anywhere in the file, with `${VAR:-fallback}` for a
default. That is what lets a committed config carry no secrets.

### A local model

Nothing says the provider has to be remote. Ollama on a self-hosted runner needs no key at all:

```json
{
  "providers": [
    {
      "name": "ollama",
      "baseUrl": "http://localhost:11434/v1",
      "models": ["qwen2.5-coder:32b"]
    }
  ]
}
```

`token_env` still has to name a variable, because the session refuses to start an agent with no
credential at all. Point it at something harmless and set it to any non-empty string:

```yaml
agent:
  id: nanocoder
  token_env: NANOCODER_API_KEY   # set it to "unused" on the brain repos
```

### When it goes wrong

| In the log | What it means |
|---|---|
| `No agents.config.json found` | the file is not where nanocoder looked. Check it is committed to the ops repo at `agents.config.json`, and that `roster upgrade --apply` has been run so the caller carries the current preset. |
| `No providers configured` | the file is there but `providers` is empty, or spelled as an object instead of an array. |
| `Provider 'x' not found` | `--provider` names something the file does not define. |
| `Model 'y' not available for provider` | `model:` in `org.yaml` or `staff.yaml` is not in that provider's `models` list. This is the common one: the roster default is a Claude model, and nanocoder is strict about the list. |
| a run that hangs and then times out | a first-run prompt. The preset passes `--trust-directory` and `--plain` to avoid both known ones. |

## Writing your own

Anything not in the list, including something that does not exist yet:

```yaml
agent:
  id: my-agent
  install: cargo install my-agent
  run: my-agent --headless --model "$AGENT_MODEL" < "$AGENT_PROMPT_FILE"
  token_env: MY_AGENT_TOKEN
```

Five questions decide the `run` command, and they are the same five for every tool:

1. **What is its non-interactive mode?** Most have one, and it is rarely the default:
   `-p` for Claude, `exec` for Codex, `run` for nanocoder.
2. **How does it take a long prompt?** Stdin (`< "$AGENT_PROMPT_FILE"`) if it accepts it, an
   argument (`"$(cat "$AGENT_PROMPT_FILE")"`) if it does not. Never a literal.
3. **What does it do with no TTY?** Anything that draws a full-screen interface needs the flag
   that turns it off, or CI gets a run full of escape codes and no work.
4. **Does it ask anything on first run?** Trust prompts, telemetry consent, a config wizard.
   Each one hangs an unattended run until the job times out. Find the flag that skips it.
5. **Is it allowed to write?** A sandbox that forbids edits produces a run that reports success
   having done nothing, which is the worst failure this arrangement has.

You can also override a single field of a preset, which is the common case when a flag changes:

```yaml
agent:
  id: codex
  run: codex exec - --model "$AGENT_MODEL" --sandbox workspace-write < "$AGENT_PROMPT_FILE"
```

The rest of the preset still applies.

### Per staff member

Anything the org sets, a staff member can override in their own `staff.yaml`. Roles that differ
in kind are worth splitting: a research role on a long-context model, an engineering role on a
coding one.

```yaml
# marketing/staff.yaml
agent: nanocoder
model: qwen/qwen3-coder
```

```yaml
# technology/staff.yaml
model: claude-opus-5    # keeps the org's agent, changes only the model
```

Two staff members on two different agents need both credentials present, each on its own brain
repo, under each agent's own `token_env`. `roster doctor` reads the callers and tells you which
secret each repo is missing.

## What the runner gets

| Variable | |
|---|---|
| `$AGENT_PROMPT_FILE` | absolute path to the composed prompt |
| `$AGENT_MODEL` | the staff member's model, or the agent's default |
| `$AGENT_TOOLS` | the `allowed_tools` string from the caller, which comes from `defaults.allowed_tools` in org.yaml |
| `$GH_TOKEN` | a token for the private trackers, already authenticated |
| `$PUBLIC_TOKEN` | a token for the public product repo, if there is one |
| *`token_env`* | the agent's credential, under whatever name it wants |

**The prompt is always a file, never an argument.** It is thousands of words and it contains
quotes, backticks and dollar signs. Argument length limits and shell quoting are exactly the
sort of thing that works in testing and fails at 07:00 on a Tuesday.

## Requirements on the agent

An agent has to do the work *and commit it*. The prompt tells it to; the session workflow does
not commit on its behalf. Any agent that can run `git` and `gh` from a shell qualifies. One
that only edits files and cannot run commands will produce a run that changes nothing.

## Changing agent on a live org

1. Set `agent:` in `org.yaml`.
2. Put the new credential on each brain repo, named as `token_env`
   (`gh secret set CODEX_API_KEY --repo <org>/<brain> --body "$KEY"`).
3. `roster upgrade --apply`, then commit and push the regenerated callers. This is what
   repoints them at the new secret name; skipping it leaves every run reaching for the old one.
4. Trigger one run by hand and read the log before trusting the schedule.

The old secret can stay where it is until the new agent has had a clean run. Nothing reads it
once the callers have been regenerated, and it is the fastest way back if the first run is bad.

Step 4 is not optional. Prompts are written against a model's habits as much as its
capabilities, and the first run on a new agent is where you find out which parts of your
charter were load-bearing.
