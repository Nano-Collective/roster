---
title: "org.yaml reference"
description: "Every field in the org manifest, and what reads it."
sidebar_order: 13
---

# `org.yaml` reference

The org manifest. Lives at the root of the ops repo, and is read at the top of every composed
prompt, by `runner-plan.mjs`, by `agents.mjs`, and by every CLI command.

Parsed by `parseYaml` in `compose.mjs`, which reads a deliberately small, strict subset of
YAML: scalars, nested maps, block lists, and inline maps in a list. It does not do anchors,
multi-line scalars, or flow maps at the top level. **A manifest that needs more than that has
outgrown being a manifest**, and the parser refuses to guess rather than misparsing.

## A complete example

```yaml
org: acme
name: Acme Robotics
ops_dir: roster-ops

human:
  name: Will
  github: you
  marker: will
  role: founder

experiment_private: true

agent:
  id: claude-code-action

defaults:
  model: claude-opus-5
  timeout_minutes: 90
  mention_timeout_minutes: 90
  allowed_tools: [Bash, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch]

staff:
  - { handle: cto, dir: technology, name: Chief Technology Officer, schedule: "0 7 * * 1-5" }
  - { handle: cmo, dir: marketing, name: Chief Marketing Officer, schedule: "40 7 * * 1-5" }

repos:
  - { name: acme-web, visibility: public, role: product }
  - { name: technology, visibility: private, role: brain }
  - { name: roster-ops, visibility: private, role: ops }
```

## Fields

### Top level

| Field | Required | Means |
|---|---|---|
| `org` | yes | The GitHub organisation. Every repo name is resolved against it. |
| `name` | yes | What the business is called, in prose. Appears in prompts. |
| `ops_dir` | no | Directory name of the ops repo in the runner checkout. Defaults to `roster-ops`. |
| `experiment_private` | no | Whether the fact that this org is agent-run is itself private. Read by the guardrails fragment. |

### `human`

Who the staff answer to. There is exactly one.

| Field | Required | Means |
|---|---|---|
| `github` | yes | Login. **The mention callers gate on this**, so without it nothing can wake an agent. |
| `name` | no | What to call them in prose. Defaults to the login. |
| `marker` | no | Provenance tag on a fact they ruled on, as in `[will]`. Also used as a label. |
| `role` | no | Prose only. |

### `agent`

Which coding agent runs a session. Either a string, or a map. See
[choosing a coding agent](agents.md).

| Field | Required | Means |
|---|---|---|
| `id` | no | A preset name, or your own label. Defaults to `claude-code-action`. |
| `install` | if `id` is unknown | Shell command that installs the agent on the runner. |
| `run` | if `id` is unknown | Shell command that runs it, reading `$AGENT_PROMPT_FILE`. |
| `token_env` | if `id` is unknown | Environment variable its credential goes in. |
| `model` | no | Default model for this agent. A staff member's own `model` wins. |

Any field given overrides the preset's, so a preset that is right except for one flag needs
one line.

### `defaults`

Fallbacks for staff members who do not set their own.

| Field | Means |
|---|---|
| `model` | Model id passed to the agent. |
| `timeout_minutes` | Ceiling on a daily session. `90` if unset. |
| `mention_timeout_minutes` | Ceiling on a mention run. Falls back to `timeout_minutes`, then `90`. |
| `allowed_tools` | Which tools an agent may use. **Claude's vocabulary**, because Claude is the only preset that takes an allowlist: it becomes `--allowedTools`. It reaches every run as `$AGENT_TOOLS` whatever the agent is, so a custom runner can use it, and an agent with no such concept ignores it. Editing it re-renders the callers, so run `roster upgrade --apply` afterwards. |

### `staff`

The registry. One inline map per staff member. **This is the org's view of them**; the rest
lives in their own `staff.yaml`.

| Field | Required | Means |
|---|---|---|
| `handle` | yes | Short identifier. Must match the handle in their manifest. |
| `dir` | no | Directory and repo name. Defaults to the handle. |
| `name` | no | Role name in prose. |
| `schedule` | no | Cron. Informational here; the caller workflow is what actually schedules. |

`roster hire` appends to this list. An empty list (`staff: []`) is valid and is what a fresh
org has.

### `repos`

Every repository the org owns, and what it is for.

| Field | Means |
|---|---|
| `name` | Repo name, resolved against `org`. |
| `visibility` | `public` or `private`. `roster doctor` warns when this disagrees with reality. |
| `role` | `brain`, `product` or `ops`. |

`role: product` is load-bearing: `roster hire` uses it to fill a new staff member's
`works_in`, and the prompts refer to the product repo by name.

## What reads what

| Reader | Uses |
|---|---|
| `compose.mjs` | `org`, `name`, `human`, `ops_dir`, `staff` |
| `runner-plan.mjs` | `org`, `staff`, and each manifest's `works_in` and `peers` |
| `agents.mjs` | `agent`, `staff` |
| `roster hire` | all of it, plus every existing manifest |
| `roster doctor` | all of it |

## Editing it

It is yours. `roster upgrade` never touches it: it has no template, because a tenant's registry
is not something a framework can have an opinion about.

The exception is `roster hire --apply`, which appends a `staff` entry and a `repos` entry.
Those are inserted textually under the existing keys rather than by re-serialising the file,
so your comments and formatting survive.
