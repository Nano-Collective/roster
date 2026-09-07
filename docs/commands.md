---
title: "Commands"
description: "Every CLI command and flag."
sidebar_order: 8
---

# Commands

Every command prints a plan and changes nothing unless you pass `--apply`, except `lint`,
`prompt`, `export` and `portal`, which never change anything at all.

## `roster init --org <org>`

Stand up a new tenant: the ops repo, the org layer, and the recorded merge base.

```
--org <name>      the GitHub organisation. Required.
--name <text>     what the business is called. Defaults to the org.
--human <login>   who the agents answer to. Defaults to your gh login.
--marker <tag>    provenance tag on a fact they ruled on.
--agent <id>      coding agent. See docs/agents.md.
--dir <path>      where to create the workspace.
--ops <name>      ops repo name. Defaults to roster-ops.
--apply
```

Will not write `org/business.md`. That is yours.

## `roster hire <handle>`

Scaffold a staff member: repo, three callers, manifest, memory index, charter stub, labels,
pinned status issue, and peer wiring in both directions.

```
--name <text>          role name, e.g. "Chief Financial Officer"
--dir <name>           workspace directory and repo name
--schedule <cron>      defaults to a slot staggered after the last one
--model <id>
--timeout <n>          daily ceiling, minutes
--mention-timeout <n>
--pr-timeout <n>
--secret-prefix <X>    secrets become <X>_APP_ID and <X>_APP_PRIVATE_KEY
--app <slug>           defaults to the pattern the peers use
--public-app <slug>    the shared public identity
--apply
```

## `roster app <handle>`

Create the GitHub App and put its credentials in the brain repo's secrets.

```
--public       create the shared public identity instead
--port <n>     localhost port for the hand-off. Default 4310.
--no-open      print the URL rather than opening a browser
```

Cannot install the App. See [manual steps](manual-steps.md).

## `roster doctor [handle]`

Check the org is wired up, and that the agents have actually been running.

```
--offline   skip everything needing the network
--json      machine-readable findings
```

Exit 1 if anything failed. Warnings do not fail.

## `roster upgrade`

Carry framework changes into the tenant. See [upgrading](upgrading.md).

```
--apply
--check               exit non-zero if anything is pending
--baseline <git-ref>  one-time: reconstruct a merge base
--verbose             show files that are already up to date
```

## `roster lint [handle]`

Check memory against the grammar. See [memory](memory.md).

```
--quiet   print only problems
```

## `roster brief <kind> [handle]`

Print a self-contained brief for authoring one of the files the agents run on. Paste it into
whatever agent you use, or pipe it.

```
discover        write org/business.md, which every prompt is composed on top of
charter <who>   write a staff member's CHARTER.md
voice           revise org/voice.md, the house style every surface inherits
```

```
--ops <dir>
```

```bash
roster brief discover
roster brief charter cto | pbcopy
roster brief voice > /tmp/brief.md
```

These are the only files anybody writes by hand. `org/operating.md`, `org/voice.md` and
`org/guardrails.md` ship written; a charter and `org/business.md` cannot, because they are the
half that is about you.

Nothing in a brief is specific to any agent. Claude Code gets `/discover`, `/voice` and
`/charter` as well, generated from these same files by `roster init` and `roster hire`. To add
them to a tenant that predates this, redirect the brief into the file:

```bash
roster brief discover > roster-ops/.claude/commands/discover.md
```

## `roster prompt <handle>`

Compose and print what a staff member is actually sent.

```
--kind daily|mention|pr-mention
--diff <workflow.yaml>
```

`mention` and `pr-mention` need trigger context:

```bash
ROSTER_CONTEXT='{"issue_number":"1","comment_id":"1","pr_number":"1","repo":"o/r"}' \
  roster prompt cto --kind mention
```

## `roster portal`

Serve a local UI over the checked-out repositories.

```
--port <n>   default 4300
--host <a>   default 127.0.0.1. Anything else exposes write actions to the network.
```

Views: Inbox, and per staff member Brain, Graph, What changed, Health. It can reply, close,
reopen and open issues, acting as you through your own `gh`.

## `roster export`

The whole org as one JSON document.

```
--out <file>
```

## Common to all

```
--ops <dir>   ops repo directory. Default: found by walking up.
```
