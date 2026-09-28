---
title: "Concepts"
description: "The ops repo, the brain, charters, manifests, surfaces and peers."
sidebar_order: 3
---

# Concepts

## The six things you need to know

Enough to set up an org and read what it does. Everything after this section is detail you
can learn when you need it.

1. **The org layer.** One private repo, `<org>/roster-ops`, holds what every staff member
   shares: what the business is (`org/business.md`), what matters this month
   (`org/priorities.md`), the house voice and the guardrails. Change it once and every staff
   member has it on their next run. [More](#the-ops-repo).
2. **A staff member is a repo.** Each one has a private repo, its *brain*: what it knows, what
   it is working on, and what it has decided. There is no database and no server; the portal
   reads the repos. [More](#the-brain).
3. **The charter.** `CHARTER.md` in the brain says who this staff member is and what it
   decides alone. You write it, with a brief that interviews you; roster never generates one,
   because a generated charter makes a generic agent. [More](#charter-and-manifest).
4. **Memory.** `memory/INDEX.md` is one line per fact, read at the start of every run. The
   agent writes it and deletes from it; you can read and correct it in the portal. That is how
   a staff member remembers yesterday. [More](memory.md).
5. **The daily run.** A scheduled GitHub Actions workflow in each brain wakes the staff member,
   hands it a prompt built from the org layer plus its charter and memory, and it does one piece
   of work and writes down what happened. [More](#kinds-of-run).
6. **Mentions.** Write `@handle` in an issue or comment on a staff member's own tracker and it
   runs to answer that, between daily runs. Nothing on a product repo wakes anybody; you ask
   them on their tracker. [More](#kinds-of-run).

Everything below, and the rest of the docs, is detail: identities, peers, surfaces, the
prompt's layers, upgrading. None of it is needed to get a first run.

## The ops repo

`<org>/roster-ops` holds two different kinds of thing, and the split matters.

**`org/` is yours.** `business.md`, `priorities.md`, `voice.md`, `guardrails.md`,
`operating.md`. This is the business truth and the shared half of every staff member's
instructions. Edit it freely: the
[Org screen](portal.md#org) lists every one of these off disk with an Edit button, and saving
commits and pushes. A change here reaches everybody on their next run, which is the point: a
rule every staff member should follow is one edit, not one per repo.

**Everything else is machinery** and belongs to the framework: `compose.mjs`, `agents.mjs`,
`runner-plan.mjs`, `inflight.mjs`, `run-record.mjs`, `.github/workflows/session.yaml`. Editing these works right up until the
framework changes the same file, at which point your change is a conflict at best and silently
reverted at worst. Fix machinery in the framework, then `roster upgrade`.

`roster upgrade` enforces this distinction. It reports an edit to a framework-owned file even
when nothing has collided yet, because "not broken yet" is the state a lost fix sits in.

## Priorities

`org/priorities.md` is the one direction every staff member shares: what matters this month,
ranked, and what is out of scope. It is composed into every daily run, a run picks work that
serves it, and a PR names the priority it serves. Keep it to three priorities or fewer, and
rewrite it when the month turns.

Without it each staff member picks its own work from its own charter, and they drift. `roster
init` writes a stub; `roster doctor` warns while it is missing or still the stub. An org that
predates it just adds the file.

## The brain

A staff member's repository *is* their memory. There is no database.

| | |
|---|---|
| `CHARTER.md` | the personality. Hand written. Decides everything else. |
| `staff.yaml` | the machine-readable half: handle, schedule, identities, peers, surfaces |
| `memory/INDEX.md` | one line per fact, read in full at every boot |
| `memory/notes/` | the argument behind a fact, read only when that fact is in play |
| `log/decisions.md` | why things were decided. Not boot context. |
| `.github/workflows/` | two callers, about forty lines each |

## Charter and manifest

Two halves of one thing. The charter is prose for the agent; the manifest is fields for the
machinery. [Health](portal.md#health), and `roster lint`, fail if they disagree.

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
                 + org/priorities.md + <staff>/CHARTER.md + prompts/<kind>.md
```

Built at run time by `compose.mjs` in the tenant's own repo. See it for yourself on the
[Prompt screen](portal.md#prompt), which shows the composed text and every layer that went into
it, or from a terminal:

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

A `mention` prompt refuses to compose without trigger context, because it is written for the
comment that woke it. That is correct behaviour, not a bug.

**Nothing in a product repo wakes anybody.** A pull request is on the product repo, and a staff member's caller workflow is in their own brain repo and
gates on their `@handle` appearing *there*. So naming somebody in a reply where a comment will
not reach them offers, under the box, to open the request on their tracker as well. One press
posts your words on the thread and sends them the pull request, the branch, the hunk you were
looking at if you started from a file, and an instruction to answer on the pull request rather
than in the tracker it arrived in.

It is two `gh` calls as you, rather than a workflow in the product repo with its own gate and
its own credential. See [the portal](portal.md#asking-for-a-change).

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
