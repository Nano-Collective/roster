---
title: "Memory"
description: "The grammar, the five rules, and why deleting is the maintenance."
sidebar_order: 7
---

# Memory

A staff member's memory is markdown in its own repository. There is no database, deliberately:
an agent writes markdown well and writes to a schema badly.

## The two files

```
memory/INDEX.md      one line per fact. Read in full at every boot.
memory/notes/*.md    the argument behind a fact. Read only when that fact is in play.
```

That split is the whole design. Boot context here went from about 52,000 words to about 6,000
by making it, and the saving repeats on every run forever.

## The grammar

```
- **`<slug>`** · [<will|measured|derived>] <the fact, one line>. **So:** <what it changes>. · [note](notes/<slug>.md)
```

`roster lint` enforces it, and the portal parses it. Provenance and the note link are optional.
The slug, the fact and the `So:` are not.

**Provenance** is one of three things: a human ruled it, it was measured, or it was derived.
A `[measured]` fact without an `n` fails lint, because a number without a sample size is a
rumour.

## The five rules

1. **One line per fact.** If it needs more, the extra goes in `notes/<slug>.md` and the line
   stays one line.
2. **Correct in place. Never append "updated:".** An update chain is how one fact becomes six
   paragraphs that contradict each other.
3. **Every fact says what it changes.** If you cannot write the `So:`, it is not memory. Do not
   add it.
4. **Measurements carry `n` and a date. Constraints do not expire; measurements do.** Anything
   with a `review:` date is re-read or deleted on that date.
5. **Deleting is the maintenance.** Cut every line that no longer changes a decision, and log
   the cut. A memory that only grows is a memory nobody reads.

Rule 5 is the one that gets skipped and the one that matters. Everything else degrades slowly;
this one degrades the boot cost of every future run.

## What does not go in memory

- **Why something was decided.** That is `log/decisions.md`, and it is not boot context.
- **How a thing works.** That is a draft or a strategy document.
- **What is outstanding.** That is the pinned status issue.

Nothing is copied between them. Four places, four jobs, and a fact that appears in two of them
will disagree with itself within a month.

## Checking it

```bash
roster lint          # everyone
roster lint cto      # one staff member
```

Lint catches: a missing `So:`, a duplicate slug, a note nothing links to, a link to a note that
does not exist, an over-long line, a `[measured]` fact with no `n`, and an "updated:" chain.

The portal's **Health** screen shows the same findings and will open an issue in the staff
member's own repository asking them to fix it, which is usually the right move: they wrote it.
