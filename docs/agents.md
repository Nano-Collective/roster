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

In `org.yaml`:

```yaml
agent:
  id: codex
```

Or the short form, which is the same thing:

```yaml
agent: codex
```

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
- tool permissions come from `allowed_tools` on the caller

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
run:       nanocoder --model "$AGENT_MODEL" --mode yolo --trust-directory --plain run "$(cat "$AGENT_PROMPT_FILE")"
token_env: NANOCODER_API_KEY
```

Three flags matter for unattended use. `run` is its non-interactive mode. `--trust-directory`
skips the first-run directory trust prompt, which would otherwise hang the runner until it
times out. `--plain` avoids the TUI, which has nothing to draw to in CI.

Nanocoder resolves a provider from `agents.config.json` in the working directory, so you will
want that file in the brain repo, and the provider's own key in `token_env`.

## Writing your own

Anything not in the list, including something that does not exist yet:

```yaml
agent:
  id: my-agent
  install: cargo install my-agent
  run: my-agent --headless --model "$AGENT_MODEL" < "$AGENT_PROMPT_FILE"
  token_env: MY_AGENT_TOKEN
```

You can also override a single field of a preset, which is the common case when a flag changes:

```yaml
agent:
  id: codex
  run: codex exec - --model "$AGENT_MODEL" --sandbox workspace-write < "$AGENT_PROMPT_FILE"
```

The rest of the preset still applies.

## What the runner gets

| Variable | |
|---|---|
| `$AGENT_PROMPT_FILE` | absolute path to the composed prompt |
| `$AGENT_MODEL` | the staff member's model, or the agent's default |
| `$AGENT_TOOLS` | the `allowed_tools` string from the caller |
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
2. Put the new credential on each brain repo, named as `token_env`.
3. `roster upgrade --apply`, then commit and push the regenerated callers.
4. Trigger one run by hand and read the log before trusting the schedule.

Step 4 is not optional. Prompts are written against a model's habits as much as its
capabilities, and the first run on a new agent is where you find out which parts of your
charter were load-bearing.
