---
title: "Extending it"
description: "The four seams, and which one to reach for."
sidebar_order: 6
---

# Extending it for your business

Four seams, in the order you are likely to reach for them.

## 1. Change how everyone works

Edit `org/*.md` in the ops repo. It reaches every staff member on their next run.

| File | For |
|---|---|
| `business.md` | what the business is. The one everything else is downstream of. |
| `voice.md` | house style. How anything anyone writes should read. |
| `guardrails.md` | non-negotiables. What nobody may do, regardless of charter. |
| `operating.md` | the autonomy contract: the boot ritual, the hand-off, decision rights. |

This is the seam that pays. A concision rule here used to mean editing twelve files across two
repositories; now it is one file, and the next morning everybody has it.

Keep the split honest. If a rule would be true of every staff member you will ever hire, it
belongs here. If it is about one role, it belongs in that role's charter.

## 2. Change what a staff member is sent

`prompts/` holds the fragments `compose.mjs` assembles.

```
_identity.md    who you are posting as, and where
_paths.md       where things are in the runner checkout
daily.md        the scheduled session
mention.md      a focused task from a comment
pr-mention.md   a review comment forwarded from the product repo
```

The syntax is small on purpose: `{{ path.to.value }}`, `{{> partial.md }}`,
`{{>? optional.md }}` and `{{#if path}}...{{/if}}`. Conditionals do not nest.

**Guard anything that assumes a manifest field.** `{{staff.product.repo}}` is empty for a staff
member whose `works_in` is empty, and an unresolved placeholder is a hard error rather than a
blank. Wrap it:

```
{{#if staff.product}}
... anything that mentions the product repo ...
{{/if}}
```

A staff member can override a fragment for themselves. `{{>? staff:prompts/work.md}}` in
`daily.md` renders `prompts/work.md` from their own brain repo if it exists, and nothing if it
does not. That is how one role gets a different working ritual without changing anybody else's.

See what you actually built:

```bash
roster prompt cto --kind daily
```

## 3. Give a role something new to keep

Declare a surface in `staff.yaml`:

```yaml
surfaces:
  - { path: assets/, render: gallery }
  - { path: data/,   render: table }
```

The portal renders it without knowing what the role is. `render` is one of `memory`, `doc`,
`gallery`, `table` or `code`.

A surface is also a promise: `roster doctor` warns when one is declared and not on disk.

## 4. Change what a new hire starts with

`templates/brain/` in the framework is what `roster hire` renders. Editing it changes every
future hire and nothing that already exists.

Filenames are rendered too, which is why the callers are `%%STAFF%%-daily.yaml`.

Two classes of file, and the difference decides what `roster upgrade` does later:

- **The caller workflows** are generated. They track the template forever and are regenerated
  wholesale.
- **Everything else** is scaffold. It belongs to the staff member from the moment it is
  created, and upgrade only ever adds a new one, never rewrites an existing one. That is why a
  working agent's `CHARTER.md` and `memory/INDEX.md` are safe from you.

## What not to extend

`compose.mjs`, `agents.mjs`, `runner-plan.mjs` and `session.yaml` are the framework's. Change
them in the framework and run `roster upgrade`. Editing them in the tenant works until the
framework touches the same file, and `roster upgrade --check` fails on it for that reason.
