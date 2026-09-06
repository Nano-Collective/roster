---
title: "staff.yaml reference"
description: "Every field in a staff member's manifest."
sidebar_order: 14
---

# `staff.yaml` reference

A staff member's manifest: the machine-readable half of their charter. Lives at the root of
their brain repo.

`roster lint` fails if this and `CHARTER.md` disagree. Same strict YAML subset as
[`org.yaml`](org-yaml.md).

## A complete example

```yaml
handle: cto
name: Chief Technology Officer
mention: "@cto"
brain: acme/technology
status_issue: 15

schedule: "0 7 * * 1-5"
model: claude-opus-5
timeout_minutes: 90
mention_timeout_minutes: 30
pr_mention_timeout_minutes: 60

bot: acme-cto[bot]
public_bot: acme-robot[bot]
public_token_env: PIPWEB_TOKEN
agent_secret: CLAUDE_CODE_OAUTH_TOKEN

identities:
  - { app: acme-cto, secret_prefix: CTO, scope: private }
  - { app: acme-robot, secret_prefix: BOT, scope: public }

works_in:
  - { repo: acme/acme-web, role: contributor, checkout: true }

peers:
  - { handle: cmo, brain: acme/marketing, label: from-cto }

surfaces:
  - { path: memory/, render: memory }
  - { path: strategy/, render: doc }
  - { path: assets/, render: gallery }
  - { path: data/, render: table }

labels:
  owner: [will, cto, cmo]
  kind: [decision, setup, build, blocked]
```

## Identity

| Field | Required | Means |
|---|---|---|
| `handle` | yes | Must match `org.yaml`. The composer looks them up by the `org.yaml` one, so a mismatch composes the wrong brain. |
| `name` | yes | Role name in prose. |
| `mention` | yes | What wakes them, as in `@cto`. The caller's condition tests for this string. |
| `brain` | yes | `owner/name` of this repo. Without it nothing can check secrets, labels or runs. |
| `status_issue` | yes in practice | Number of the pinned status issue. The prompts reference it, so a run cannot compose without it. `roster hire --apply` writes it. |

## Schedule and limits

| Field | Default | Means |
|---|---|---|
| `schedule` | none | Cron for the daily run. Rendered into the caller. |
| `model` | org default | Model id. |
| `timeout_minutes` | 60 | Ceiling on the daily session. |
| `mention_timeout_minutes` | 30 | Ceiling on a mention run. |
| `pr_mention_timeout_minutes` | 60 | Ceiling on a PR-amendment run. |

The three ceilings are separate on purpose. Raising the daily one because sessions have grown
should not double the budget for a PR amendment. A job killed by a ceiling is reported by
GitHub as `cancelled`; see [troubleshooting](troubleshooting.md).

**These are the source of truth.** The caller workflow carries a rendered copy, so change the
manifest and run `roster upgrade`, not the other way round.

## Identities

| Field | Means |
|---|---|
| `bot` | Login this staff member posts as on private trackers, as in `acme-cto[bot]`. |
| `public_bot` | Login it posts as on the public product repo. |
| `public_token_env` | Environment variable holding the public token inside a run. |
| `agent_secret` | Repo secret holding the coding agent's credential. |
| `identities` | One entry per App. |

Each `identities` entry:

| Field | Means |
|---|---|
| `app` | The GitHub App slug. Carries the house naming scheme, so it is inferred from a sibling rather than built from the handle. |
| `secret_prefix` | Secrets are `<prefix>_APP_ID` and `<prefix>_APP_PRIVATE_KEY`. |
| `scope` | `private` (this staff member's own) or `public` (shared by everybody). |

The public identity is shared deliberately. A bot opening a pull request on a public repo is
unremarkable; a bot signing itself with a job title is a tell.

**The `[bot]` suffix is how a manifest spells it and not how GitHub reports it.** An issue
authored by the App has author `acme-cto`. roster normalises this; if you are matching on it
yourself, strip the suffix.

## Relationships

### `works_in`

Repos this staff member contributes to but does not own.

| Field | Means |
|---|---|
| `repo` | `owner/name`. |
| `role` | Prose. `contributor` in practice. |
| `checkout` | Whether the runner clones it. |

**The first entry becomes `{{staff.product}}` in prompts.** A staff member with an empty
`works_in` has no product, and any prompt fragment referring to one must guard with
`{{#if staff.product}}`.

### `peers`

The other staff members this one files work with.

| Field | Means |
|---|---|
| `handle` | Their handle. |
| `brain` | Their repo. |
| `label` | The label **this** staff member uses when filing on **that** tracker. |

**The label is not symmetric.** In the CTO's manifest the entry for the CMO carries
`from-cto`, and that label lives on `acme/marketing`, because that is where the CTO's asks
land. `roster hire` writes both directions and `roster doctor` checks the label exists on the
peer's repo, not this one.

## `surfaces`

What this staff member keeps, and how the portal renders it.

| `render` | Shows as |
|---|---|
| `memory` | Parsed fact cards |
| `doc` | Markdown, rendered |
| `gallery` | Image grid |
| `table` | CSV as a table |
| `code` | Monospace, syntax preserved |

A surface is a promise: `roster doctor` warns when one is declared and not on disk.

## `labels`

Labels this staff member expects to exist on its own tracker, grouped for readability. Every
value across every group is checked by `roster doctor`. An agent applying a label that does not
exist gets an API error mid-run.

## What `roster upgrade` does to this file

Nothing. It is `scaffold` class: written once by `roster hire`, and yours from that moment.
A framework change that adds a manifest field will not reach an existing staff member, which is
a deliberate trade against the risk of merging into a file a working agent has rewritten.
