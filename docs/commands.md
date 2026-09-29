---
title: "Commands"
description: "Every CLI command and flag."
sidebar_order: 8
---

# Commands

**`roster` here means either of these.** With nothing installed, run commands through npx:
`npx @nanocollective/roster@latest upgrade`. Or install it once with
`npm install -g @nanocollective/roster` and type `roster upgrade`. When you run through npx,
the commands roster suggests are printed the npx way, so they can be pasted as they are.

Every command that changes anything prints a plan and changes nothing unless you pass
`--apply`. `lint`, `prompt`, `export`, `brief`, `doctor` and `fix` never change anything.
`portal` is the exception: it is interactive, and each change there is a button you press after
seeing what it will do.

## `roster fix`

Every scanner's findings, as one brief you paste into a coding agent working in this workspace.

```
--json      the findings as data, rather than as a brief
--offline   skip everything needing the network
--ops <dir> ops repo directory
```

`doctor`, the prompt audit and `lint` each already carry the sentence that fixes their own
finding; this collects them. Two piles come out: what an agent editing files here can do, and
what only a person can: an org permission, an App install, a credential. The second is listed
but marked not to attempt, because an agent handed one of those invents a workaround.

The brief states which files belong to the framework before it states any of the work. A fix
applied to a vendored file is reverted by the next `roster upgrade`, and that has happened.

The portal's Health screen has the same text behind a copy button.

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

With `--apply` it also sets the ops repo's Actions access to "accessible from repositories in
the organisation", which is what lets every brain call its workflow. If GitHub refuses (it needs
admin on the repo), it prints the reason and the settings page to click instead.

Will not write `org/business.md`. That is yours.

## `roster hire <handle>`

Scaffold a staff member: repo, two callers, manifest, memory index, charter stub, labels,
pinned status issue, and peer wiring in both directions.

```
--name <text>          role name, e.g. "Chief Financial Officer"
--dir <name>           workspace directory and repo name
--schedule <cron>      defaults to a slot staggered after the last one
--model <id>
--timeout <n>          daily ceiling, minutes
--mention-timeout <n>
--secret-prefix <X>    secrets become <X>_APP_ID and <X>_APP_PRIVATE_KEY
--app <slug>           defaults to the pattern the peers use
--public-app <slug>    the shared public identity
--no-review-gate       leave the product repos' branch rules alone
--apply
```

With `--apply` it also:

- commits and pushes, as you, what it changed in repos that already exist: each peer's
  `staff.yaml`, `org.yaml`, and the new `staff.yaml` once the status issue has a number. The
  plan lists each commit first, and a push that fails is reported and left for you.
- adds the new brain to the agent credential's org secret, if there is one, so the credential is
  never asked for again. See [`roster credential`](#roster-credential).
- adds a review-before-merge ruleset to each product repo that does not already require an
  approving review. See [security](security.md#the-review-gate).

## `roster app <handle>`

Create the GitHub App and put its credentials in the brain repo's secrets.

```
--public       create the shared public identity instead
--port <n>     localhost port for the hand-off. Default 4310.
--no-open      print the URL rather than opening a browser
--apply        actually create it; without it, prints the App name, secrets and repos
```

Cannot install the App: GitHub asks a person to confirm which repos it reaches. It prints a link
to the install page with the org and every repo the staff member needs already selected (its
brain, its peers' trackers, the product repos), so confirming is one click. The pre-selection uses
`suggested_target_id` and `repository_ids[]`, which GitHub's own links use but does not document;
when the ids cannot be read the link is the plain install page. See
[manual steps](manual-steps.md).

## `roster credential`

Store the coding agent's credential once for the org.

```
--repo-secrets   a secret on each brain repo, even where an org secret would work
--apply          read the credential and store it
```

By default it is one organisation secret, named after the agent's `token_env`, shared with every
brain repo; `roster hire` adds each new brain to it. It uses a secret on each brain instead, and
the plan says why, when an org secret would not arrive: on GitHub Free an org secret does not
reach a private repo, and only an org owner can set one. Setting an org secret also needs the
`admin:org` scope on your gh token (`gh auth refresh -h github.com -s admin:org`); if it is
refused, the credential goes on each repo and the output says so.

The value comes from standard input, or a prompt that does not echo, and goes to `gh` on its
standard input. It is never on a command line and never on disk.

```bash
claude setup-token          # Claude Code; see docs/agents.md for the others
roster credential --apply
```

## `roster run <handle>`

Start one daily run now and follow it to the end.

```
--no-wait   start it and print the link, without following it
--apply     start the run
```

Runs `gh workflow run <handle>-daily.yaml`, finds the run it started, and polls it until it
finishes. It prints the outcome, the step it failed at if it did, and the log's link. A success
is what `roster doctor` counts as proof that the App, its grant, the secrets and the callers all
work, so its "unproven" warning goes away. It is a real run and spends what a scheduled one
would, which is why it needs `--apply`. The staff card and Health have the same as
**Run once now**.

## `roster retire <handle>`

Stop a staff member without destroying anything.

```
--apply
--ops <dir>
```

Their brain repo is their entire memory and there is no undo for deleting one, so this does
not touch it. It disables their three workflows through the API, removes them from `org.yaml`,
removes them from every peer's `staff.yaml`, and deletes the `from-<handle>` labels their peers
carried for them. Everything they ever knew stays where it is, readable in the portal and on
GitHub.

Disabling rather than deleting the workflow files is what makes it reversible: the files stay,
so re-enabling is one click, and nothing has to be regenerated from templates that have moved
on since.

It deliberately does not delete or archive the repo, close their issues, or unpin their status
issue. All three are one click on GitHub, having thought about it.

Plan-then-apply, like everything else that changes something.

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

Check memory against the grammar, and warn when a fact, the index or the decision log is over
its [budget](memory.md#budgets). See [memory](memory.md).

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
amend <who>     change what a staff member is told, with the whole prompt attached
```

```
--kind <k>      for amend: daily | mention  (default: daily)
--want <text>   for amend: what you want changed
--example <e>   for charter: an example's handle, or none (default: matched to the role)
--ops <dir>
```

```bash
roster brief amend cto --want "stop opening decision issues for anything reversible"
roster brief discover
roster brief charter cto | pbcopy
roster brief voice > /tmp/brief.md
```

`charter` carries one of the [worked examples](writing-a-charter.md#worked-examples) as a
model to adapt, matched to the role by handle or name. It is a model for the shape, not content
to copy, and the brief still interviews you first. `--example` picks another; `--example none`
leaves it out. The portal's copy-a-prompt has the same choice.

`amend` is the different one. It carries the composed prompt and every file it is assembled
from, so the agent you paste it into does not have to ask for any of them. The portal's Prompt
screen builds the same thing, and offers it per audit finding.

The other three are the only files anybody writes by hand. `org/operating.md`, `org/voice.md` and
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
--kind daily|mention
--diff <workflow.yaml>
--inflight
```

A run also carries the pull requests people have open on the product repos. `--inflight` reads
them through your own `gh` and includes them; without it that section is left out, so the output
does not move with somebody else's branch.

`mention` needs trigger context:

```bash
ROSTER_CONTEXT='{"issue_number":"1","comment_id":"1","repo":"o/r"}' \
  roster prompt cto --kind mention
```

## `roster portal`

Serve a local UI over the checked-out repositories. **`roster` with no arguments does the same**,
which is the shortest way in.

```
--port <n>    default 4300
--host <a>    default 127.0.0.1. Anything else exposes write actions to the network.
--dir <path>  where a tenant would be created or checked out. Default: here.
--no-open     don't open a browser
```

It opens the page in your browser when it starts. It stays closed in CI, over SSH, when output
is not a terminal, or with `BROWSER=none`.

**With no tenant where you started it, this is the setup screen**: it stands up a new org, or
checks out one that already runs roster. Local only. See [the portal](portal.md).

Views: Inbox, Org, Staff, Docs, and per staff member Brain, Prompt, Graph, What changed, Health.

It can act as you through your own `gh`: reply, close, reopen and open issues; hire and retire;
edit and commit the org layer, prompt fragments and charters; create a staff member's GitHub App;
store the agent credential; set the ops repo's Actions access; start one run and follow it; and
copy a prompt for authoring the two files nothing can generate.

## `roster export`

The whole org as one JSON document.

```
--out <file>
```

## Common to all

```
--ops <dir>   ops repo directory. Default: found by walking up.
```
