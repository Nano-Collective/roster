# Concepts

## The ops repo

`<org>/roster-ops` holds two different kinds of thing, and the split matters.

**`org/` is yours.** `business.md`, `voice.md`, `guardrails.md`, `operating.md`. This is the
business truth and the shared half of every staff member's instructions. Edit it freely. A
change here reaches everybody on their next run, which is the point: a concision rule that used
to mean editing twelve files is now one file.

**Everything else is machinery** and belongs to the framework: `compose.mjs`, `agents.mjs`,
`runner-plan.mjs`, `.github/workflows/session.yaml`. Editing these works right up until the
framework changes the same file, at which point your change is a conflict at best and silently
reverted at worst. Fix machinery in the framework, then `roster upgrade`.

`roster upgrade` enforces this distinction. It reports an edit to a framework-owned file even
when nothing has collided yet, because "not broken yet" is the state a lost fix sits in.

## The brain

A staff member's repository *is* their memory. There is no database.

| | |
|---|---|
| `CHARTER.md` | the personality. Hand written. Decides everything else. |
| `staff.yaml` | the machine-readable half: handle, schedule, identities, peers, surfaces |
| `memory/INDEX.md` | one line per fact, read in full at every boot |
| `memory/notes/` | the argument behind a fact, read only when that fact is in play |
| `log/decisions.md` | why things were decided. Not boot context. |
| `.github/workflows/` | three callers, about forty lines each |

## Charter and manifest

Two halves of one thing. The charter is prose for the agent; the manifest is fields for the
machinery. `roster lint` fails if they disagree.

The charter is the only file roster refuses to generate. A generated charter produces a generic
agent, and a generic agent produces work that is plausible, competent-looking and about nothing
in particular.

## Surfaces

`staff.yaml` declares what a staff member keeps and how to render it:

```yaml
surfaces:
  - { path: memory/,   render: memory }
  - { path: assets/,   render: gallery }
  - { path: data/,     render: table }
  - { path: strategy/, render: doc }
```

This is how the portal renders a brain it has never seen. A CMO with brand assets and analytics
exports declares `gallery` and `table`; nothing in the portal knows what a CMO is.

## The composed prompt

```
org/operating.md + org/guardrails.md + org/voice.md + org/business.md
                 + <staff>/CHARTER.md + prompts/<kind>.md
```

Built at run time by `compose.mjs` in the tenant's own repo. See it for yourself:

```bash
roster prompt cto --kind daily
```

`compose.mjs` is vendored into the tenant rather than imported from the framework. A run at
07:00 must not depend on npm, on a network fetch, or on an organisation the tenant does not
control.

## Kinds of run

| | |
|---|---|
| `daily` | the scheduled session. Boot, work, hand off. |
| `mention` | `@handle` in a comment or a new issue body. A task, not a session. |
| `pr-mention` | a review comment on the public product repo, forwarded in. |

`mention` and `pr-mention` prompts refuse to compose without trigger context, because they are
written for the comment that woke them. That is correct behaviour, not a bug.

## Identities

A staff member posts as a GitHub App, not as you. Usually two:

- a **private** identity for their own trackers, unique to them
- a **public** identity shared by everyone, for the product repo, deliberately anonymous

The public one is shared on purpose. A bot opening a pull request on a public repo is
unremarkable; a bot signing itself with a job title is a tell.

## Peers

Staff members write to each other. A peer entry carries the label *this* staff member uses when
filing on *that* tracker, so it is not symmetric:

```yaml
# technology/staff.yaml
peers:
  - { handle: cmo, brain: acme/marketing, label: from-cto }
```

`from-cto` lives on `acme/marketing`, because that is where the CTO's asks land.
