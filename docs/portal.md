---
title: "The portal"
description: "Every view and every action."
sidebar_order: 17
---

# The portal

```bash
roster portal          # http://localhost:4300
```

A local web UI over the checked-out repositories. Reads them from disk, so it needs no
authentication and no API quota, and works offline. It can write to GitHub through your own
`gh`. See [hosting](hosting.md) for why it stays local.

Keep the repos checked out beside each other, in the same shape the runner uses.

## Inbox

Everything open across the org, from one GraphQL call per repo. Bodies and full timelines come
down with the list, so opening a thread is a render rather than a request.

- **Filter by staff member.** An item belongs to somebody if it is in their brain repo, their
  own App wrote it, a peer addressed it to them with a `from-<handle>` label, or it is assigned
  to them. The shared public identity cannot name one staff member, so an item it wrote counts
  for anyone who works in that repo. Items authored by humans belong to nobody, which is
  correct.
- **Scope** to everything, what is assigned to you, decisions, or open PRs.
- **Open, recently closed, or both.** Open by default: an inbox is what is waiting on
  somebody, and months of finished work mixed into that answers a different question. Closed
  work reaches back 45 days, up to 30 issues and 30 pull requests per repository, and carries
  a shorter timeline than open work because it is there to be read rather than triaged. A
  closed row is dimmed and marked; the sidebar badge keeps counting only what is open.
- **Reply, close, reopen, open an issue.** All as you, through your own `gh`, so they are
  indistinguishable from doing it on the site. Closing asks for confirmation.
- Issue and PR references in a body become chips you can click through, and `@handle`
  mentions become chips too. A mention of somebody on this roster goes to their repository
  rather than to a GitHub profile of that name, which for `@cto` is a stranger.
- **Not every comment is markdown.** Deploy bots post raw HTML. A `<table>` renders as a
  table, and inline `<a>`, `<img>`, `<strong>`, `<em>`, `<code>` and `<br>` are reduced to
  what they stand for. Nothing relaxes the escaping: the HTML is taken apart and its pieces go
  back through the same escape-first renderer as everything else, so no markup from a comment
  ever reaches the page. Code spans and fences are left alone, so a comment discussing
  `<meta name="robots">` still says so, and a tag outside the handful above stays visible as
  text rather than being silently deleted.
- **The whole thread, not just the comments.** Cross-references ("mentioned this in #55"),
  commits that reference the issue, and close, reopen and merge events sit inline in GitHub's
  own order. Labels, assignees and renames are bookkeeping, so a run of them folds behind one
  disclosure. An item a cross-reference points at opens in the portal when the inbox already
  holds it, and on GitHub when it does not.

## Brain

Memory and the file tree, merged, because they were always the same thing: both manifests
already declared `memory/` as a surface.

The navigator has three boxes, because a parsed memory section and a file on disk are
different kinds of thing.

**Memory** is the fact sections, the notes behind them, and `INDEX.md` itself. A note is the
argument behind one fact, read only when that fact is in play, which is what keeps the index
cheap enough to read at every boot. Both live here rather than among the files: `INDEX.md` is
literally what "All facts" renders.

**Identity** is `CHARTER.md` and `staff.yaml`. Neither is in a declared surface, and they are
the two files that decide what this staff member is.

**Files** is every other declared surface, folded, with anything over a dozen files closed.

One search box searches facts and files together: type a slug and the matching facts are
offered directly. Clicking a fact's name narrows the pane to its section with that fact lit;
a crumb says so, and Escape or either crumb widens it again.

Renderers follow the surface's `render` field: markdown as documents, images, CSV as tables,
code with its line breaks. A relative link inside a brain document opens that file in the pane
rather than going nowhere.

## Prompt

**What this staff member is actually sent**, which was previously only reachable through
`roster prompt <handle> --kind daily` in a terminal. Composed on the server by the tenant's own
`compose.mjs`, so there is no second implementation to drift.

Pick the kind: `daily`, `mention` or `pr-mention`. A mention prompt is written for the comment
that woke it, so a preview fills in obviously-fake context.

Beneath the composed text, the files it was made of, in two groups.

**Inlined, in order** is walked out of the `{{> …}}` includes rather than written down, so it
stays true when somebody adds a fragment. Each row says which repo it came from, because a
change to `roster-ops/org/voice.md` reaches every staff member and a change to a brain's own
`prompts/work.md` reaches one. An optional fragment (`{{>? …}}`) that a role does not have is
shown as absent rather than hidden.

**Named, not inlined** is `CHARTER.md`, `memory/INDEX.md` and `org/business.md`. The prompt
tells the agent to open these; it does not contain them. Editing a charter changes what an
agent does without changing a byte of the composed prompt, and that distinction is easy to
miss.

### Problems

The audit, beside the layers. Nothing here judges prose: every check is something a machine
can be sure about, because a linter you stop believing is worse than no linter.

| Check | Why it matters |
|---|---|
| a file is still the scaffold | `org/business.md` is composed into every run. Leaving it as questions is invisible: the run works and the output is just generic |
| a placeholder never resolved | `{{staff.product.repo}}` is null for a staff member who contributes to no other repo, and the agent reads the braces literally |
| the same line in two layers | the layers are inherited, so a rule a charter repeats from `org/` is duplication nobody reading either file can see |
| the prompt is long | it is read in full on every run, forever |
| it names a file that is not there | an instruction to read something absent is a quiet no-op inside a run nobody watches |
| an included layer is empty | it contributes nothing and costs a line of includes |

**Every finding carries the fix.** "Copy a prompt to fix this" builds a brief containing the
finding, the composed prompt, and every layer, and puts it on your clipboard. Paste it into
whatever agent you use. Knowing there is a problem is the hard part; writing the paragraph is
not.

### Getting help changing it

**Copy a brief for changing this** asks what you want changed and copies the same thing: a
self-contained prompt carrying the composed text, every layer with its path and blast radius,
and what may and may not be edited. `roster brief amend <handle> --want "…"` prints the same
from the terminal.

It carries the state rather than asking for it, because working out which of eight files to
open is the difficulty being solved. A brief that says "read your layers first" has handed
that straight back.

### Editing

Layers are editable in place. Saving writes the file, commits **only that file**, and pushes,
as you, through your own git. The confirmation names the repository and says who picks it up:
every staff member for anything under `org/` or `prompts/`, one staff member for a brain file.

The writable set is an allowlist, because this commits to repositories the agents run from:

| Writable | Not |
|---|---|
| `<ops>/org/*.md` | `org.yaml`, `compose.mjs`, `agents.mjs` |
| `<ops>/prompts/*.md` | any `.github/workflows/` |
| `<brain>/CHARTER.md` | `staff.yaml` |
| `<brain>/prompts/*.md` | `memory/INDEX.md` |

`staff.yaml` and the workflows break composition when they are wrong, and `memory/INDEX.md` is
the agent's own working memory: a hand edit there is writing over what the next run is about
to rewrite. All four are readable, none is writable.

An unrelated edit sitting in the working tree is left alone. A push that fails is reported with
the commit it did make, rather than as a failure, because the edit is committed and that is the
part that is awkward to redo.

**Saving shows what the edit did to the composed prompt**, not to the file. Those are not the
same thing: a line added to one fragment can land three times or not at all, and the file diff
answers a question you did not ask.

## Graph

Two levels. Memory sections are big nodes on a fixed ring; clicking one fans its facts outwards
into its own angular slice, so a fan never lands among its neighbours. Clicking a fact reads
it. Groups keep their angle for the life of the view, so the picture is something you can build
a mental map of.

## What changed

What this agent learned and forgot, from git. Facts added and removed, grouped by day, each
opening the diff that did it: one block per file, coloured, with line numbers.

## Health

Two halves.

**Memory problems**, the same checks `roster lint` runs. Each one has a button that opens an
issue in that staff member's own repo asking them to fix it, which is usually right, because
they wrote it.

**The rig**: schedule in words, workflows present, last commit, last commit touching `memory/`,
index and notes size, charter, status issue, missing surfaces.

## Docs

The framework's own documentation, rendered where you already are. Links between pages navigate
the portal.

## Keeping it current

`/api/sync` fetches and fast-forwards every repository on each refresh. It refuses to pull one
that is dirty or has diverged, and says which in a banner rather than guessing. If a run landed
thirty seconds ago and your checkout is behind, that is what you are looking at.

Press `r` to refresh. The URL carries the state, so a refresh lands where you were and a link
is shareable.

## Flags

```
--port <n>    default 4300
--host <a>    default 127.0.0.1. Anything else exposes write actions to the network.
--ops <dir>   ops repo directory
```
