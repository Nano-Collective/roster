# roster

**An agent-run org, powered by GitHub.** Each staff member is an AI whose brain is a private
repo: a charter, a memory, a decision log, and a scheduled session that does a day's work
unattended and hands off.

**Full documentation is in [`docs/`](docs/README.md).** Start with
[getting started](docs/getting-started.md), then read [manual steps](docs/manual-steps.md).

Status: **working, private, one tenant.** Every command below is built and exercised daily
against a live two-agent org. Not published; see Phase 5 of `../AGENT-ORG-PLAN.md`.

## What it does

```bash
roster init --org acme          # stand up a tenant: ops repo, org layer, merge base
roster hire cto                 # scaffold a staff member: repo, workflows, labels, peers
roster app cto                  # create their GitHub App, write its secrets
roster doctor                   # is any of this actually wired up
roster portal                   # read every brain, and the docs, locally
roster upgrade                  # take framework changes without losing your edits
```

Nothing changes anything without `--apply`. `roster help <command>` for the rest, or
[docs/commands.md](docs/commands.md).

## The shape

```
Nano-Collective/roster        this repo. The CLI, the templates, the portal, the docs.
                              ✗ never a runtime dependency of a tenant

<tenant>/roster-ops           the org layer + the machinery, generated from templates/ops/
  org/business.md               what the business is. You write this.
  org/operating.md              the autonomy contract
  org/voice.md                  house style
  org/guardrails.md             the non-negotiables
  prompts/                      composable run-kind fragments
  compose.mjs                   vendored. Builds the prompt at run time.
  agents.mjs                    vendored. Which coding agent runs, and how.
  .github/workflows/session.yaml    the reusable workflow every staff repo calls

<tenant>/<brain>              one repo per staff member. The repo is the brain.
  CHARTER.md                    the personality. Hand written. Never generated.
  staff.yaml                    the machine-readable half of the charter
  memory/INDEX.md               one line per fact, read at every boot
  memory/notes/                 the argument behind a fact, read on demand
  .github/workflows/            three callers, about forty lines each
```

**Why a tenant vendors the machinery:** a private reusable workflow can only be called from
inside its own org, and a morning run should not depend on npm, on a network call, or on an
organisation the tenant does not control. So the framework writes templates *out* and never runs
anything. `roster upgrade` carries a new version across, and it is run by a human because App
tokens cannot push changes under `.github/workflows/` anywhere.

See [architecture](docs/architecture.md).

## Any coding agent

roster composes a prompt and hands it to an agent. A runner is three shell-level facts:

```yaml
agent:
  id: codex
```

Presets for `claude-code-action` (default), `claude`, `codex` and `nanocoder`. Anything else
works by writing `install`, `run` and `token_env` into `org.yaml`.
See [choosing a coding agent](docs/agents.md).

## Composition

A runtime prompt is assembled from org policy, the staff member's charter, and the run kind:

```
prompts/<kind>.md
  {{> prompts/_paths.md}}        where the repos are in the runner
  {{> prompts/_identity.md}}     which bot you are, on which repo
  {{>? staff:prompts/work.md}}   optional per-role override
  {{> org/operating.md}}         the autonomy contract
  {{> org/guardrails.md}}
  {{> org/voice.md}}
```

`{{> x}}` is required, `{{>? x}}` renders empty when absent, and `staff:` resolves inside the
staff member's own repo. That is the extension seam: **a role extends the org without forking
it.** Change `org/voice.md` once and everyone inherits it on their next run.

See [prompts](docs/prompts.md).

## Development

```bash
npm install
npm test              # 148 tests, node:test through tsx
npm run typecheck
npm run dev -- doctor --offline
```

Run it from a workspace root: a directory holding the ops repo and every brain repo side by
side, which is the same shape the CI runner checks out.

Before touching anything that reaches a live org, read
[working on roster itself](docs/developing.md). The short version: never fix a generated file
in a tenant, and check `roster prompt` output byte for byte before shipping a prompt change.
