---
title: "Prompt reference"
description: "The template syntax, the context, and what has to be guarded."
sidebar_order: 15
---

# Prompt reference

What a staff member is actually sent, and how to change it.

See it for yourself before changing anything:

```bash
roster prompt cto --kind daily
```

## What gets assembled

```
org/operating.md      the autonomy contract: boot ritual, hand-off, decision rights
org/guardrails.md     non-negotiables, binding on everyone
org/voice.md          house style
org/business.md       what the business is
<staff>/CHARTER.md    the personality
prompts/<kind>.md     what this kind of run is for
```

Assembled at run time by `compose.mjs`, in the tenant's own repo. It is vendored rather than
imported so a run at 07:00 depends on no network fetch, no npm, and no organisation the tenant
does not control.

## Kinds

| Kind | Woken by | Needs trigger context |
|---|---|---|
| `daily` | cron | no |
| `mention` | `@handle` in a comment, or in a new issue body | yes |
| `pr-mention` | a review comment on the product repo, forwarded in | yes |

`mention` and `pr-mention` refuse to compose without context, because they are written for the
comment that woke them. That is correct behaviour. To see one locally:

```bash
ROSTER_CONTEXT='{"issue_number":"1","comment_id":"1","pr_number":"1","repo":"o/r"}' \
  roster prompt cto --kind mention
```

## Syntax

Four forms, and nothing else.

| Form | Does |
|---|---|
| `{{ path.to.value }}` | Substitutes a value. **Unresolved is a hard error**, not a blank. |
| `{{> partial.md }}` | Includes a fragment. Required: a missing one throws. |
| `{{>? partial.md }}` | Includes a fragment if it exists, nothing if it does not. |
| `{{#if path}}...{{/if}}` | Includes a block when the value is truthy. |

**Conditionals do not nest.** The matcher is non-greedy, so an inner `{{/if}}` closes the outer
block. If you need two conditions, guard on the one that can actually be absent.

Conditionals are resolved first, so a partial inside a false block is never read. That matters
when the partial is expensive or may not exist.

Include depth is capped at 8, which turns a partial that includes itself into an error rather
than a hang.

## The context

| Path | Is |
|---|---|
| `org` | the whole of `org.yaml` |
| `org.name`, `org.org` | the business name, the GitHub org |
| `human` | the `human` block from `org.yaml` |
| `human.name`, `human.github`, `human.marker` | |
| `ops.dir` | ops repo directory in the checkout |
| `staff` | the whole of this staff member's `staff.yaml` |
| `staff.dir` | where their brain lands in the checkout |
| `staff.product` | **first entry of `works_in`, or null** |
| `staff.product.repo` | that repo's `owner/name` |
| `peers` | list of the other staff members |
| `peer` | the first peer, or null |
| `peer_list` | peers pre-rendered as a markdown list |
| `kind` | `daily`, `mention` or `pr-mention` |
| `event` | trigger context, from `ROSTER_CONTEXT` |
| `event.issue_number`, `event.comment_id`, `event.pr_number`, `event.repo`, `event.actor` | |

Anything else in a manifest is reachable under `staff.`, so `staff.status_issue` and
`staff.public_token_env` work without being listed here.

## Guarding

`{{staff.product}}` is null for a staff member with an empty `works_in`, and an unresolved
placeholder is a hard error. Anything referring to the product repo must be wrapped:

```
{{#if staff.product}}
Open the PR on `{{staff.product.repo}}` from a branch.
{{/if}}
```

The same applies to `{{peers}}`, which is empty for the only staff member in an org.

This is not hypothetical. The shipped prompts referred to `{{staff.product.repo}}` unguarded,
which nobody noticed because every existing staff member had one. The first staff member of any
new org could not compose a prompt at all.

## Overriding a fragment for one staff member

```
{{>? staff:prompts/work.md}}
```

Renders `prompts/work.md` from that staff member's own brain repo if it exists, and nothing if
it does not. This is how one role gets a different working ritual without changing anybody
else's. `daily.md` already carries this hook.

## Changing them

`prompts/` is `seeded` class: yours to edit, and `roster upgrade` gives you a real three-way
merge. Changes reach every staff member on their next run.

Before pushing a prompt change to a live org, diff the composed result:

```bash
roster prompt cto --kind daily > before.txt
# edit
roster prompt cto --kind daily > after.txt
diff before.txt after.txt
```

That is the only test there is for a prompt change. A change that composes fine and reads
differently is not caught by anything else.
