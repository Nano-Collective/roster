---
title: "Overview"
description: "What roster is, the shape of an agent-run org, and what it will not do for you."
sidebar_order: 0
---

# roster

An agent-run organisation, powered by GitHub.

A staff member is a private repository. The repo *is* the brain: what it knows, what it is
working on, what it has decided. A scheduled workflow wakes it each morning, hands it a prompt
composed from the org's shared rules plus its own charter, and it does a day's work and hands
off. You read the result on GitHub, or in a local portal.

roster is the thing that sets that up and keeps it consistent.

## Guide

Read in this order.

| | |
|---|---|
| [Getting started](getting-started.md) | One command, in a browser: stand up an org, or join one that exists. |
| [Manual steps](manual-steps.md) | Every human action, why it cannot be automated, and what breaks if you skip it. **Read this one.** |
| [Concepts](concepts.md) | What a charter, a manifest, a surface and the ops repo are. |
| [Choosing a coding agent](agents.md) | Claude, Codex, Nanocoder, or anything with a command line. |
| [Writing a charter](writing-a-charter.md) | The one file nothing can generate for you. |
| [Extending it](extending.md) | The four seams, and which one to reach for. |
| [Memory](memory.md) | The grammar, and why deleting is the maintenance. |
| [Commands](commands.md) | Every CLI command and flag. |
| [The portal](portal.md) | Setup, every view, and every action. |
| [Upgrading](upgrading.md) | How framework changes reach a tenant without eating your edits. |
| [Troubleshooting](troubleshooting.md) | Every trap we have actually hit, and what it looks like. |
| [Hosting the portal](hosting.md) | Local is the default, and why. |
| [Cost](cost.md) | What this spends, and on what. |

## Reference

Look things up.

| | |
|---|---|
| [`org.yaml`](org-yaml.md) | Every field in the org manifest. |
| [`staff.yaml`](staff-yaml.md) | Every field in a staff member's manifest. |
| [Prompts](prompts.md) | The template syntax, the context, and what to guard. |
| [The session workflow](session-workflow.md) | Inputs, secrets, and what runs in what order. |
| [The portal](portal.md) | Every view and every action. |
| [`roster export`](export.md) | The JSON shape. |
| [doctor codes](doctor-codes.md) | Every finding, what it means, what to do. |

## Understanding it

| | |
|---|---|
| [Architecture](architecture.md) | What happens during a run, and why it is shaped this way. |
| [Security model](security.md) | What can reach what, and what stops it. |
| [Working on roster itself](developing.md) | Layout, template classes, and the rules that matter. |

## The shape of it

```
Nano-Collective/roster          the framework. Never a runtime dependency of anything.
  ├── src/                      the CLI
  ├── templates/ops/            what a tenant's ops repo is generated from
  ├── templates/brain/          what a staff member's repo is generated from
  └── portal/                   the local web UI

<your-org>/roster-ops           the org layer and the machinery. Private.
  ├── org/business.md           what the business is. You write this.
  ├── org/voice.md              house style, inherited by everyone
  ├── org/guardrails.md         non-negotiables, inherited by everyone
  ├── org/operating.md          the autonomy contract
  ├── prompts/                  composable prompt fragments
  ├── compose.mjs               builds the prompt at run time
  ├── agents.mjs                which coding agent runs, and how
  └── .github/workflows/session.yaml    the reusable workflow every staff repo calls

<your-org>/<staff>              one per staff member. The repo is the brain.
  ├── CHARTER.md                the personality. Hand written.
  ├── staff.yaml                the machine-readable half of the charter
  ├── memory/INDEX.md           one line per fact, read at every boot
  ├── memory/notes/             the argument behind a fact, read on demand
  └── .github/workflows/        three callers, about forty lines each
```

**The framework never runs anything.** It writes templates out; a tenant runs its own copies.
That is not tidiness, it is forced: a reusable workflow in a private repo can only be called
from inside its own organisation, so a tenant cannot call the framework's. It turns out to be
the better design anyway. Nothing breaks if the framework repo moves, goes private, or is
deleted, and an air-gapped install is a supported case rather than a special one.

## What it will not do for you

- **Write the charter.** It is the personality and it decides everything else. A generated one
  produces a generic agent, which is the failure this whole arrangement exists to avoid.
- **Write `org/business.md`.** Everything the staff say is downstream of it.
- **Install a GitHub App.** Installing grants access to specific repositories and GitHub asks a
  human which. See [manual steps](manual-steps.md).
