---
title: "The session workflow"
description: "Inputs, secrets, and what runs in what order."
sidebar_order: 16
---

# The session workflow

`roster-ops/.github/workflows/session.yaml` is the reusable workflow every staff repo calls.
It is the framework's file: change it in `templates/ops/` and run `roster upgrade`.

A caller is about forty lines and does nothing but pass arguments.

## Why it lives in the tenant

A reusable workflow in a **private** repo can only be called from inside its own organisation.
A tenant therefore cannot call the framework's copy. That constraint shapes the whole
design, and it is the better one anyway: the framework is never a runtime dependency, so nothing
breaks if it moves, goes private, or is deleted.

This is also why `roster-ops` needs **Settings -> Actions -> General -> accessible from
repositories in this organisation**. Without it, callers fail with "workflow not found".

## Inputs

| Input | Type | Default | Means |
|---|---|---|---|
| `staff` | string | required | Handle, as in `org.yaml`. |
| `kind` | string | `daily` | `daily` or `mention`. |
| `ops_repo` | string | required | `owner/name` of the ops repo. |
| `model` | string | `claude-opus-5-5` | Passed to the agent, unless the agent resolves its own. |
| `timeout_minutes` | number | `90` | Job ceiling. |
| `allowed_tools` | string | `Bash,Read,Write,Edit,Glob,Grep,WebFetch,WebSearch` | Tool permissions, for agents that take them. |
| `issue_number` | string | `""` | Trigger context. |
| `comment_id` | string | `""` | Trigger context. |
| `trigger` | string | `""` | What started the run: `daily`, `manual`, `follow-on`, `mention` or `peer`. Passed to the prompt. |
| `max_runs_per_day` | number | `6` | How many `peer` and `follow-on` runs may start in a UTC day. Mentions are never counted. |

## Secrets

| Secret | Required | Means |
|---|---|---|
| `APP_ID` | yes | This staff member's own App. |
| `APP_PRIVATE_KEY` | yes | |
| `PUBLIC_APP_ID` | no | The shared public identity. Absent means no product-repo lane. |
| `PUBLIC_APP_PRIVATE_KEY` | no | |
| `AGENT_TOKEN` | no | The coding agent's credential. |
| `CLAUDE_CODE_OAUTH_TOKEN` | no | The name the reference runner has always used. |

Neither credential is required on its own and exactly one must be present. A step checks this
before any checkout, so a missing credential is an obvious failure rather than an
authentication error forty lines into a log.

## What it does, in order

Before the session job, a small **budget** job. For a `peer` or `follow-on` run it counts this
brain's runs today with those names in their `run-name`, this one included and skipped ones
left out. Over `max_runs_per_day`, the session does not start and the issue that woke it gets a
comment saying so. If the runs cannot be read, the run does not start either: a run held back
costs a day, and a loop costs a bill. Every other trigger goes straight through.

Then the session:

1. **Start the clock**, for the run record.
2. **Mint the private-tracker token** from the staff member's App.
3. **Mint the public-repo token**, if a public App was passed.
4. **React to the request** with eyes, on a `mention` only. Before any checkout, so it lands in
   seconds. `continue-on-error`: a missing reaction must never cost the answer.
5. **Check out the ops repo.** It is the only thing that can be cloned without having read a
   manifest, so it goes first and then says what else to clone.
6. **Work out what to check out**, by running `runner-plan.mjs`.
7. **Check out the brain**, full history. The agent reads its own past.
8. **Check out peers and product repos**, per the plan.
9. **Gather human work in flight**: open pull requests people have on the product repos, via
   `inflight.mjs`, for the prompt. Never fatal. See [prompts](prompts.md#human-work-in-flight).
10. **Set git identity** to the App.
11. **Set up Node and pnpm**, if the plan found a `package.json`.
12. **Compose the prompt**, to a step output and to `.roster-prompt.txt`.
13. **Check the agent has a credential.**
14. **Work out which agent runs this**, by running `agents.mjs`.
15. **Run the session**, by one of two steps: the Action-based reference runner, or the generic
    CLI one. See [choosing a coding agent](agents.md).
    Then, for a mention, **check the request was answered**: a reply in the thread, or the issue
    closed. Neither fails the job, so the notice below tells the human.
    Then, for a daily run that finished and wrote `.roster-run/continue`, **start a follow-on
    run**: one more daily run with `trigger: follow-on`, which waits for this one to end.
16. **Write down the run**, whatever happened: staff, kind, outcome, duration, and turns, cost
    and tokens where the agent reports them. Into the job summary, and kept as an artifact
    called `roster-run`. Never fatal. See [cost](cost.md#what-each-run-cost).
17. **Say so if the run did not finish.** A comment on the status issue, or on the issue that
    woke a mention, linking the run.

## When the failure is the token

The failure notice cannot rely on anything that might be what failed. A renamed repo, a rotated
key or an uninstalled App breaks the App token first, and an alert that posts with that token
says nothing at exactly the moment it is needed. So the notice uses the App token when there is
one, and falls back to the job's own `github.token` when there is not or it is refused. It then
posts as `github-actions`, and says to check the App.

That needs `issues: write` on the job token. `session.yaml` asks for it, but a called workflow
can only narrow what its caller grants, so both callers grant it too:

```yaml
jobs:
  session:
    permissions:
      contents: read
      issues: write
    uses: acme/roster-ops/.github/workflows/session.yaml@main
```

Callers generated before this lack it, and their fallback cannot post. `roster upgrade --apply`
regenerates them. `roster doctor` separately reports any other workflow in the ops or brain
repos that has failed run after run, as `workflows.failing`.

## What `runner-plan.mjs` emits

Consumed by later steps as `steps.plan.outputs.*`.

| Output | Example |
|---|---|
| `brain_dir` | `technology` |
| `brain_repo` | `acme/technology` |
| `org` | `acme` |
| `peers` | `acme/marketing:marketing` |
| `products` | `acme/acme-web:acme-web:0` |
| `needs_node` | `true` |
| `product_dir` | `acme-web` |
| `product_repo` | `acme/acme-web` |
| `package_json` | `acme-web/package.json` |

## What the agent gets

| Variable | |
|---|---|
| `GH_TOKEN` | private-tracker token, already authenticated |
| `PUBLIC_TOKEN` | public product repo token |
| `AGENT_PROMPT_FILE` | absolute path to the composed prompt |
| `AGENT_RESULT_FILE` | where to write the agent's own result JSON, if it has one. Optional; it is how cost gets into the run record |
| `AGENT_MODEL` | resolved model |
| `AGENT_TOOLS` | the `allowed_tools` string |
| *the agent's own* | its credential, under whatever name it declares |

## The checkout shape

```
.
├── roster-ops/        the ops repo
├── technology/        the brain
├── marketing/         a peer's brain, if declared
└── acme-web/           a product repo, if declared
```

Flat, one level. The prompts say so explicitly, because it is one level flatter than a
developer would assume from reading the docs on their own machine.
