# Working on roster itself

```bash
git clone <the framework> && cd roster && npm install
npm test          # the whole suite
npx tsc --noEmit  # typecheck
```

Tests are `node:test` run through `tsx`. There is no build step for development, and the portal
has no build step at all.

## Layout

```
src/cli.ts             command table and help
src/commands/          one file per command
src/lib/               shared: workspace, memory, render, merge, gh, templates, docs
templates/ops/         what a tenant's ops repo is generated from
templates/brain/       what a staff member's repo is generated from
templates/portal/      the portal, one HTML file
docs/                  these pages
test/                  one file per area
```

## The rule that matters

**Never fix a generated file in a tenant.** `compose.mjs`, `agents.mjs`, `runner-plan.mjs` and
`session.yaml` live in `templates/ops/`. Fix them there and run `roster upgrade`.

This has gone wrong once already. A fix went into `roster-ops/.github/workflows/session.yaml`
instead of the template and nothing noticed, because the framework had not touched that file
yet. `roster upgrade` now reports an edit to a framework-owned file whether or not anything has
collided, and `roster upgrade --check` fails on it.

## Template classes

Ownership decides what `roster upgrade` does, and getting it wrong is how you either lose
somebody's work or never ship an improvement.

| Where | Class | Upgrade behaviour |
|---|---|---|
| `templates/ops/org/`, `prompts/` | `seeded` | three-way merge |
| `templates/ops/` everything else | `managed` | reported even when nothing collided |
| `templates/brain/.github/workflows/` | `generated` | regenerated wholesale |
| `templates/brain/` everything else | `scaffold` | added when new, never rewritten |

`scaffold` is the important one. A working agent rewrites `CHARTER.md` and `memory/INDEX.md`
beyond recognition, and merging a template into that would be vandalism.

## Tokens in brain templates

`templates/brain/` is rendered with `%%TOKEN%%` substitution, **including filenames**, which is
why the callers are `%%STAFF%%-daily.yaml`.

An unfilled token throws rather than being left on the page. A workflow containing a literal
`%%SCHEDULE%%` is a file GitHub accepts and never runs.

A line containing `%%TOKENS%%` is a note to whoever reads the template and is dropped on
render, along with the `#` separator above it. Every line of a multi-line note needs the
marker, or the leftover line is stranded.

## How the tests are meant to work

Three habits, each of which came from a test that was passing vacuously.

**Test the harness, not just the code.** The portal tests set a property on a dead object for
several rounds because a top-level `let` in a classic script is not reachable as a global.
State is `var` for that reason.

**Run it against reality.** The portal and doctor tests build from the live workspace rather
than a fixture, so they break when real data grows a shape the code cannot handle. That is how
the brain-comparison bug was found: every live workflow reported as absent, because filenames
are templated and the comparison did not render them.

**Mutation-test the invariants.** For anything asserting "this behaviour must not regress",
break it deliberately and check the test fails. The workflow-template tests were verified this
way, one mutation each.

## Adding a command

1. `src/commands/<name>.ts`, exporting `<name>Command` and `<name>Help`.
2. Add both to the tables in `src/cli.ts`.
3. Document it in `docs/commands.md`. **A test fails if you do not**, and another fails if the
   flags you document are not ones the parser accepts.

Prefer plan-then-apply. Every command that changes anything prints what it would do and needs
`--apply`, and that is the convention that makes them safe to run in someone else's org.

## Adding an agent preset

`templates/ops/agents.mjs`. Three fields: `install`, `run`, `token_env`. The run command reads
the prompt from `$AGENT_PROMPT_FILE`.

**Read the flags off the tool's own help or docs.** Every preset that ships was verified that
way, and the tests say which flag exists for which reason. `docs/agents.md` has to quote the
same install line, and a test checks it does.

## Before pushing anything that touches a live org

```bash
roster prompt cto --kind daily     # composed prompt, byte for byte
roster upgrade                     # what would change, and where
roster doctor                      # is it still wired up
```

A prompt change with no visible diff in the composed output is the only kind that is safe.
