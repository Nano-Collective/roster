---
title: "Prompt reference"
description: "The template syntax, the context, and what has to be guarded."
sidebar_order: 15
---

# Prompt reference

What a staff member is actually sent, and how to change it.

**Look at it before changing anything.** The portal's [Prompt screen](portal.md#prompt) is the
composed text and, beneath it, every file it was made of: which are inlined and in what order,
which are only named, and which repo each came from. That last column is the one that matters,
because a change to `roster-ops/org/voice.md` reaches every staff member and a change to a
brain's own `prompts/work.md` reaches one.

From a terminal, the same text:

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

A `mention` refuses to compose without context, because it is written for the comment that woke
it. That is correct behaviour rather than a bug.

The Prompt screen's kind picker handles that for you: pick **Mention** and it fills in
obviously-fake trigger context so there is something to look at. From a terminal you supply it
yourself:

```bash
ROSTER_CONTEXT='{"issue_number":"1","comment_id":"1","repo":"o/r"}' \
  roster prompt cto --kind mention
```

**There are two routes in, and the prompt is not the same on both.** A comment carries a
`comment_id`; a mention typed into the body of a *new* issue does not, and there is no comment
for the agent to fetch. So `compose.mjs` derives `event.no_comment` from the absence, and
`prompts/mention.md` branches on it: one side points at the comment, the other at the issue
body. Without that, the first instruction in the prompt was a `gh api .../issues/comments/`
call with no id on the end, which 404s.

The second route is the busier one now. It is what the portal's [Ask a staff
member](portal.md#asking-for-a-change) produces, and those issues often carry a pull request
that lives somewhere else and say to answer there instead.

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
| `human` | the primary human: the first of `humans`, or the singular `human` block |
| `human.name`, `human.github`, `human.marker` | |
| `humans` | everyone the staff answer to, in order. See [org.yaml](org-yaml.md#human-and-humans) |
| `human_list` | all of them as a sentence: "Will (@will-lamerton) and Sam (@sam-x)" |
| `humans_extra` | the same, minus the primary. **Empty when there is only one**, which is what makes `{{#if humans_extra}}` the way to mention the others |
| `ops.dir` | ops repo directory in the checkout |
| `staff` | the whole of this staff member's `staff.yaml` |
| `staff.dir` | where their brain lands in the checkout |
| `staff.product` | **first entry of `works_in`, or null** |
| `staff.product.repo` | that repo's `owner/name` |
| `peers` | list of the other staff members |
| `peer` | the first peer, or null |
| `peer_list` | peers pre-rendered as a markdown list |
| `kind` | `daily` or `mention` |
| `event` | trigger context, from `ROSTER_CONTEXT` |
| `event.issue_number`, `event.comment_id`, `event.repo`, `event.actor` | |
| `event.no_comment` | true when the ask is the issue body rather than a comment. There is no `{{#unless}}`, so the absence is a value |

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

[Health](portal.md#health) checks for exactly this ("a placeholder never resolved"), per staff
member, which is the only way to catch it before 07:00 rather than in a run nobody watched.

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

**Edit them where you read them.** Every layer on the Prompt screen has an Edit button; saving
writes that one file, commits it and pushes, and the confirmation names the repository and who
picks it up. The org's own layers (`org/*.md`, `<ops>/prompts/*.md`) are the same edit on the
[Org screen](portal.md#org). Not everything is writable: `compose.mjs`, `staff.yaml`, the
workflows and `memory/INDEX.md` are readable and not editable, because a wrong one of those
stops every prompt composing or overwrites what the next run is about to write.

**The thing to check is what the edit did to the composed prompt, not to the file.** Those are
different questions: a line added to one fragment can land three times or not at all. Saving
from the Prompt screen shows you the first. From a terminal, the same check is two composes and
a diff:

```bash
roster prompt cto --kind daily > before.txt
# edit
roster prompt cto --kind daily > after.txt
diff before.txt after.txt
```

Either way, that is the only test there is for a prompt change. One that composes fine and
reads differently is not caught by anything else. [Health](portal.md#health) runs a prompt audit
over all the kinds at once, but everything it checks is something a machine can be sure about,
which never includes whether the prose is any good.
