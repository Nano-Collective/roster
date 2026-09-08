---
title: "roster export reference"
description: "The JSON shape, field by field."
sidebar_order: 18
---

# `roster export` reference

The whole org as one JSON document.

```bash
roster export --out org.json
```

Rendering is decoupled from parsing on purpose: the portal reads this shape, so anything else
that reads it gets the same view without reimplementing the memory grammar.

## Top level

| Field | |
|---|---|
| `org` | the GitHub organisation |
| `name` | the business name |
| `opsName` | the ops repo's directory, so a consumer can address `org.yaml` and `org/*.md` by path |
| `human` | the `human` block from `org.yaml` |
| `generatedAt` | ISO timestamp |
| `staff[]` | one entry per staff member |

## A staff member

| Field | |
|---|---|
| `handle`, `name`, `dir`, `brain` | identity |
| `statusIssue` | pinned issue number |
| `schedule` | cron |
| `mention` | what wakes them |
| `bots[]` | every App login, `[bot]` suffix stripped |
| `soloBots[]` | identities unique to this staff member |
| `sharedBots[]` | identities shared with others |
| `worksIn[]` | repos contributed to but not owned |
| `peers[]` | `{ handle, brain, label }` |
| `facts[]` | parsed memory |
| `sections[]` | memory section names, in file order |
| `notes[]` | filenames under `memory/notes/` |
| `links[]` | the graph |
| `problems[]` | lint findings |
| `surfaces[]` | declared surfaces and their files |
| `recentCommits[]` | last 25 |
| `factsChanged[]` | facts added and removed recently |
| `rig` | scaffolding health |

The split between `soloBots` and `sharedBots` matters: a solo identity names one staff member,
a shared one names only "one of them". Attributing work by author needs both.

## `facts[]`

| Field | |
|---|---|
| `slug` | the identifier, unique within a staff member |
| `section` | the heading it sits under |
| `statement` | the fact |
| `consequence` | the `So:` clause |
| `line` | line number in `INDEX.md` |
| `raw` | the source line |

## `links[]`

| Field | |
|---|---|
| `from`, `to` | slug, note filename, issue reference or path |
| `kind` | `note`, `wikilink`, `mention`, `issue` or `path` |
| `inferred` | false when authored explicitly, true when derived |

## `surfaces[]`

| Field | |
|---|---|
| `path` | as declared in `staff.yaml` |
| `render` | `memory`, `doc`, `gallery`, `table` or `code` |
| `files[]` | `{ path, bytes, modified, ext }` |

Only surfaces that exist on disk appear. A declared surface that is missing shows up in
`rig.missingSurfaces` instead.

## `problems[]`

| Field | |
|---|---|
| `level` | `error` or `warning` |
| `rule` | see [memory](memory.md) |
| `message` | |
| `line` | in `INDEX.md`, when there is one |
| `slug` | the fact, when there is one |

## `rig`

| Field | |
|---|---|
| `workflows[]` | filenames under `.github/workflows/` |
| `hasCharter`, `hasManifest` | |
| `missingSurfaces[]` | declared, not on disk |
| `memoryBytes` | size of `INDEX.md` |
| `notesBytes` | total size of `memory/notes/` |
| `lastCommit` | `{ sha, date, subject, author }` |
| `lastMemoryCommit` | the last commit touching `memory/` |

`lastMemoryCommit` is the one worth watching. A staff member committing daily but not touching
memory in a fortnight has stopped learning anything.

## Stability

This shape is not versioned and will change as the portal does. It is a convenience for reading
your own org, not an API to build a product on.
