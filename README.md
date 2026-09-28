# Roster

Built by the [Nano Collective](https://nanocollective.org) — a community collective building AI tooling not for profit, but for the community.

Roster (alpha) runs an organisation on AI staff whose brain is a private GitHub repo: a charter,
a memory, a decision log, and a scheduled session that does a day's work unattended and hands off.

[![PR checks](https://github.com/Nano-Collective/roster/actions/workflows/pr-checks.yml/badge.svg)](https://github.com/Nano-Collective/roster/actions/workflows/pr-checks.yml)
[![npm](https://img.shields.io/npm/v/@nanocollective/roster)](https://www.npmjs.com/package/@nanocollective/roster)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

It runs every day against a live org: a CTO and a CMO have built and marketed
[Pip](https://playpip.io) since July, with one person reading and merging what they hand off.
[The case study](https://roster.nanocollective.org/case-study/pip/) has the numbers.

## Quick start

```bash
npx @nanocollective/roster
```

Run it in an empty directory. The page that opens is the setup screen, and it is the whole of
setup: say which GitHub organisation, read the plan, then create it. An org that already runs
Roster gets checked out instead, which is how you join one a colleague set up.

You need `gh` [authenticated](https://cli.github.com), a GitHub organisation, and a credential
for whichever [coding agent](docs/agents.md) you want to run. Then read
[getting started](docs/getting-started.md): about an hour and a half to a first staff member's
first finished run, most of it writing what the business is and the staff member's charter.

## Usage

Everything the portal does is also a command, on the same files. Nothing changes anything
without `--apply`.

```bash
roster init --org acme          # ops repo, org layer, merge base
roster hire cto                 # scaffold a staff member: repo, workflows, labels, peers
roster app cto                  # create their GitHub App, write its secrets
roster credential               # the coding agent's credential, once for the org
roster run cto                  # one run now, followed to the end
roster doctor                   # is any of this actually wired up
roster fix                      # every finding, as one brief for a coding agent
roster portal                   # read every brain, and the docs, locally
roster prompt cto               # the exact prompt a run will be sent
roster upgrade                  # take framework changes without losing your edits
roster retire cto               # let someone go, with their brain kept
```

Also `lint`, `brief` and `export`. `roster help <command>` for flags, or
[the CLI reference](docs/commands.md).

## How it is shaped

```
Nano-Collective/roster        this repo: the CLI, the templates, the portal, the docs.
                              Never a runtime dependency of an org.

<your-org>/roster-ops         the org layer and the machinery, generated from templates/ops/
  org/business.md               what the business is. You write this.
  org/priorities.md             what matters this month, ranked. You write this too.
  org/operating.md, voice.md,   the autonomy contract, house style, the non-negotiables,
    guardrails.md                 inherited by every staff member
  compose.mjs, agents.mjs       vendored: builds the prompt, runs the coding agent
  inflight.mjs, run-record.mjs  vendored: human work in flight, and what each run cost
  .github/workflows/session.yaml  the reusable workflow every staff repo calls

<your-org>/<staff>            one per staff member. The repo is the brain.
  CHARTER.md                    the personality. Hand written, never generated.
  staff.yaml                    the machine-readable half of the charter
  memory/INDEX.md               one line per fact, read at every boot
```

An org vendors the machinery because a morning run should not depend on npm, on a network
call, or on an organisation it does not control. `roster upgrade` carries a new version across.
See [architecture](docs/architecture.md).

**Any coding agent.** Presets for `claude-code-action` (the default), `claude`, `codex` and
`nanocoder`; anything else works by writing `install`, `run` and `token_env` into `org.yaml`.
See [choosing a coding agent](docs/agents.md).

## Documentation

Online at [roster.nanocollective.org/docs](https://roster.nanocollective.org/docs/), and the
same pages in [`docs/`](docs/README.md). Start with [getting started](docs/getting-started.md),
then [manual steps](docs/manual-steps.md). The [reference](docs/README.md#reference) covers
`org.yaml`, `staff.yaml`, the prompt syntax, the session workflow and every `doctor` code.

## Contributing

Contributions are welcome at any level of experience. See [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
pnpm install
pnpm test:all                   # format, lint, types, dead code, tests
pnpm dev doctor --offline       # run the CLI from source
```

Before touching anything that reaches a live org, read
[working on Roster itself](docs/developing.md). The short version: never fix a generated file
in an org, and check `roster prompt` output byte for byte before shipping a prompt change.

## Community

- [Nano Collective](https://nanocollective.org)
- [Documentation](https://docs.nanocollective.org)
- [GitHub organisation](https://github.com/Nano-Collective)
- [Discord](https://discord.gg/ktPDV6rekE)

Licensed [MIT](LICENSE), copyright Nano Collective.
