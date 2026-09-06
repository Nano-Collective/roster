# Contributing to roster

Contributions are welcome from anyone, at any level of experience. A typo fix in the docs is a
real contribution; so is a bug report that saves somebody else an afternoon.

This project is part of the [Nano Collective](https://nanocollective.org). The
[Code of Conduct](https://docs.nanocollective.org/collective/organisation/community) and the
[Economics Charter](https://docs.nanocollective.org/collective/organisation/economics-charter)
apply here; we link them rather than restating them.

## Setup

```bash
git clone https://github.com/Nano-Collective/roster.git
cd roster
pnpm install
pnpm test
```

Node 22 and pnpm. There is no build step for development: `pnpm dev -- <command>` runs the CLI
through `tsx` straight from source.

roster expects a **workspace**: a directory holding an ops repo and every brain repo side by
side, the same shape the CI runner checks out. Run commands from there, or pass `--ops <dir>`.

## The gate

```bash
pnpm test:all
```

That runs format, lint, types, dead-code detection and the test suite. CI runs the same checks
plus coverage, a dependency audit and a Semgrep scan, through the collective's shared workflow.

Individually:

| | |
|---|---|
| `pnpm test` | the suite, `node:test` through `tsx` |
| `pnpm test:ava:coverage` | the suite with coverage (the name is the shared workflow's contract) |
| `pnpm test:format` | Biome |
| `pnpm test:lint` | Biome |
| `pnpm test:lint:fix` | Biome, safe fixes only |
| `pnpm test:types` | `tsc --noEmit` |
| `pnpm test:knip` | unused files, exports and dependencies |

**Do not run `biome check --write --unsafe`.** Its fix for `noNonNullAssertion` rewrites `!`
into `?.`, which changes types and behaviour. It broke three call sites the first time it ran,
which is why `test:lint:fix` here is the safe variant.

## Standards

TypeScript is strict, and `noUncheckedIndexedAccess` is on. A `!` after an index is usually
correct and deliberate; the lint rule against it is off for that reason.

**Comments say why, not what.** The code says what it does. A comment earns its place by
recording a constraint, a trap, or a decision that is not visible from the syntax.

## Testing

Three habits, each of which came from a test that was passing without testing anything.

**Test the harness, not just the code.** The portal tests once set a property on an unreachable
object for several rounds. If a test cannot fail, it is not a test.

**Run against reality where you can.** The portal and doctor suites build from a live workspace
rather than a fixture, so they break when real data grows a shape the code cannot handle.

**Mutation-test the invariants.** For anything asserting "this must not regress", break it
deliberately and check the test fails. If it does not, the assertion is decoration.

## Documentation

`docs/` is not optional. The suite fails if you add a command and do not document it, promise a
flag the parser does not accept, add a `doctor` finding missing from the codes reference, or
leave a link that does not resolve.

See [docs/developing.md](docs/developing.md) for the layout, the four template classes, and the
one rule that matters: **never fix a generated file in a tenant.**

## Commits

Following the collective convention:

```
feat: new feature
fix: bug fix
mod: change to existing behaviour
docs: documentation only
chore(deps): dependency update
```

Lowercase, imperative, no trailing full stop. Scope optional in parentheses.

## Pull requests

Open against `main`. The template asks for the testing you did, automated and manual. If the
change touches something that reaches a live org, say what you checked: `roster prompt` output
compared byte for byte, or `roster upgrade` reviewed before applying.

Small and focused beats large and complete. A PR that does one thing gets reviewed faster.

## Releases

**Contributors do not bump versions.** Maintainers cut releases. If your change should trigger
one, say so in the PR and leave `package.json` alone.

## Getting help

[Discord](https://discord.gg/ktPDV6rekE), or open an issue. A question is not an imposition; if
something was unclear enough to ask about, the docs probably need a line.
