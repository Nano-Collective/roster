# The session workflow

`roster-ops/.github/workflows/session.yaml` is the reusable workflow every staff repo calls.
It is the framework's file: change it in `templates/ops/` and run `roster upgrade`.

A caller is about forty lines and does nothing but pass arguments.

## Why it lives in the tenant

A reusable workflow in a **private** repo can only be called from inside its own organisation.
A tenant therefore cannot call the framework's copy. That constraint is what forced the whole
design, and it turned out better: the framework is never a runtime dependency, so nothing
breaks if it moves, goes private, or is deleted.

This is also why `roster-ops` needs **Settings -> Actions -> General -> accessible from
repositories in this organisation**. Without it, callers fail with "workflow not found".

## Inputs

| Input | Type | Default | Means |
|---|---|---|---|
| `staff` | string | required | Handle, as in `org.yaml`. |
| `kind` | string | `daily` | `daily`, `mention` or `pr-mention`. |
| `ops_repo` | string | required | `owner/name` of the ops repo. |
| `model` | string | `claude-opus-5` | Passed to the agent, unless the agent resolves its own. |
| `timeout_minutes` | number | `60` | Job ceiling. |
| `allowed_tools` | string | `Bash,Read,Write,Edit,Glob,Grep,WebFetch,WebSearch` | Tool permissions, for agents that take them. |
| `issue_number` | string | `""` | Trigger context. |
| `comment_id` | string | `""` | Trigger context. |
| `pr_number` | string | `""` | Trigger context. |

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

1. **Mint the private-tracker token** from the staff member's App.
2. **Mint the public-repo token**, if a public App was passed.
3. **React to the request** with eyes, on a `mention` only. Before any checkout, so it lands in
   seconds. `continue-on-error`: a missing reaction must never cost the answer.
4. **Check out the ops repo.** It is the only thing that can be cloned without having read a
   manifest, so it goes first and then says what else to clone.
5. **Work out what to check out**, by running `runner-plan.mjs`.
6. **Check out the brain**, full history. The agent reads its own past.
7. **Check out peers and product repos**, per the plan.
8. **Set git identity** to the App.
9. **Check out the PR branch**, on a `pr-mention`.
10. **Set up Node and pnpm**, if the plan found a `package.json`.
11. **Compose the prompt**, to a step output and to `.roster-prompt.txt`.
12. **Check the agent has a credential.**
13. **Work out which agent runs this**, by running `agents.mjs`.
14. **Run the session**, by one of two steps: the Action-based reference runner, or the generic
    CLI one. See [choosing a coding agent](agents.md).
15. **Say so if the run did not finish.**

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
