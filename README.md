# roster

**An agent-run org, powered by GitHub.** Each staff member is an AI whose brain is a private repo:
a charter, a memory, a decision log, and a scheduled session that does a day's work unattended and
hands off.

Status: **pre-alpha.** Phase 0 of `../AGENT-ORG-PLAN.md`. Only `roster prompt` exists.

## The shape

```
Nano-Collective/roster        this repo. The CLI, the templates, the portal, the docs.
                              ✗ never a runtime dependency of a tenant

<tenant>/roster-ops           the org's shared brain + the machinery, generated from templates/
  org/business.md               what the business is
  org/operating.md              the autonomy contract
  org/voice.md                  how to write for the human
  org/guardrails.md             the non-negotiables
  prompts/                      composable run-kind fragments
  compose.mjs                   vendored. The single source of truth for composition.

<tenant>/<brain>              one repo per staff member
  staff.yaml                    the machine-readable half of the charter
  CHARTER.md                    the personality. Hand-written, AI-assisted. Never generated.
  memory/INDEX.md               one line per fact, read every boot
  prompts/boot.md               optional per-role override of an org fragment
```

**Why a tenant vendors `compose.mjs`:** a private reusable workflow can only be called from inside
its own org, and an agent's morning run should not depend on npm, on a network call, or on an
organisation the tenant does not control. So the framework writes templates *out*; it never runs
anything. `roster upgrade` is how a tenant takes a new version, and it is run by a human because
GitHub App tokens cannot push changes under `.github/workflows/` anywhere.

## Composition

A runtime prompt is assembled from org policy + the staff member's charter + the run kind:

```
prompts/<kind>.md
  {{> prompts/_paths.md}}        where the repos are in the runner
  {{> prompts/_identity.md}}     which bot you are, on which repo
  {{>? staff:prompts/boot.md}}   optional per-role boot steps
  {{> org/operating.md}}         the autonomy contract
  {{> org/guardrails.md}}
  {{> org/voice.md}}
```

`{{> x}}` is a required partial, `{{>? x}}` renders empty when absent, and `staff:` resolves inside
the staff member's own repo. That is the extension seam: **a role extends the org without forking
it.**

Change `org/voice.md` once and every staff member inherits it on their next run. The alternative,
which is what this replaces, was editing twelve files by hand.

## Usage

```bash
roster prompt cto                                    # print the composed prompt
roster prompt cto --kind mention                     # daily | mention | pr-mention
roster prompt cto --diff technology/.github/workflows/cto-daily.yaml
```

`--diff` compares the composed prompt against the `prompt:` block a workflow sends today. It is
migration scaffolding: **it exists so a cutover can be checked rather than hoped about**, and it
goes once every staff member is migrated.

## Development

```bash
npm install
npm run dev -- prompt cto      # tsx, no build step
npm run typecheck
```

Run it from a workspace root — a directory holding the ops repo and every brain repo side by side,
which is the same shape the CI runner checks out.
