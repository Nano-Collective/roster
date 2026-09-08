---
title: "The portal"
description: "Every view and every action."
sidebar_order: 17
---

# The portal

```bash
roster                 # or `roster portal`, or `npx @nanocollective/roster`
```

A local web UI over the checked-out repositories. Reads them from disk, so it needs no
authentication and no API quota, and works offline. It can write to GitHub through your own
`gh`. See [hosting](hosting.md) for why it stays local.

Keep the repos checked out beside each other, in the same shape the runner uses.

## Setup

**With no tenant where you started it, the portal is the setup screen instead.** That is not an
error state: it is the first thing anybody sees, and the page becomes the thing that fixes it.

The server starts without a workspace, borrows the framework's own `compose.mjs` until a tenant
has vendored its copy, and mounts only the setup routes. Everything else answers `409` with
`mode: setup` rather than dereferencing a workspace that was never found. The moment `org.yaml`
lands on disk it re-resolves, switches to the tenant's composer, and the rest of the portal
appears **without a restart**.

It asks GitHub which of two things this is:

- **The organisation already runs roster.** Then nothing needs creating; it needs checking out.
  The button becomes *Check it out here*, and it clones the ops repo and every brain side by
  side, which is the shape the CI runner uses. This is how a second person joins an org somebody
  else set up. *Create* is hidden, because offering both is how an org ends up with two ops repos.
- **It does not.** Then the plan is shown first, listing every file and the repo it would create, and
  nothing is written until you apply. Same `initFiles` the CLI runs, so the browser and the
  terminal cannot disagree about what a new tenant contains.

Then: the Actions setting, deep-linked to the exact page with the failure it causes if skipped;
which repos the staff work in, as a picker over what your `gh` can see minus what `org.yaml`
already has; and a prompt for writing `org/business.md`.

Nothing here stores which step you are on. Setup takes days rather than minutes: an App has to be
installed, a credential set, a first run finished. So the page derives its state from `roster
doctor` every time it is drawn. A stored step counter would disagree with the world within an hour.

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

## Org

The layer every staff member inherits, in one place: `org.yaml` and the four org documents,
each with a line saying what it is for, because five filenames tell you nothing about which to
open. All five are editable, and saving commits and pushes.

`org.yaml` is the exception to the write allowlist. It belongs to the person rather than the
agent, so it is writable. But it is the one file here that stops every prompt composing when
it is wrong, so the server parses it with the tenant's own `compose.mjs` first and refuses
anything that is not YAML it can read, or that has lost `org`, `name`, or a handle on a staff
entry.

## Staff

Everyone on the roster, and the four things you could previously only do from a terminal.

**Hiring** runs the same `buildPlan` and `applyPlan` that `roster hire` does, on the server.
Only the handle is required; everything else is copied from whoever is already here. You see
the plan first, listing every file, every label, the schedule it chose and why, and the manual
steps it cannot do for you. Nothing happens until you apply. What the terminal would have
printed is shown when it finishes.

**Writing the charter** is the copy-a-prompt loop below, aimed at `CHARTER.md`. `hire`
deliberately does not write it, because a generated charter produces exactly the generic agent
this whole arrangement exists to avoid. So this is the route that was previously `roster brief
charter <handle>` and a terminal.

**The GitHub App** is `roster app`, on this server rather than a second one. There is no API that
creates an App: the only route is the manifest flow, where you post a manifest to a settings page,
a human confirms, and GitHub hands back a one-time code. `roster app` stands up its own listener on
4310 to catch that; in the portal it runs on the port you are already on, so it is one browser and
one origin. The private key is still held in memory and written straight to a repo secret.

GitHub redirects the tab *it* opened, not the one you clicked from, so the original polls for the
result. What it cannot do is install the App: that is a grant of access to specific repositories
and GitHub asks a human to choose them, which is correct and should not be worked around. The panel
says so loudly, and says to grant every tracker the staff member writes to rather than only their
own.

**Retiring** is `roster retire`, and it is deliberately not deletion. A brain repo is that
agent's entire memory and there is no undo, so retiring disables the workflows, unwires them
from `org.yaml` and from every peer, and deletes the dead `from-<handle>` labels. The plan says
what it keeps as prominently as what it stops, because that is the thing you have to believe
before clicking it.

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
not. The box comes pre-filled with what the finding worked out, so you can add to it rather
than retype it.

### Getting help changing it

**Copy a brief for changing this** asks what you want changed, in a box big enough to say it
in, and copies the same thing: a
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

## Copy a prompt, paste the answer back

`org/business.md` and every `CHARTER.md` are the two files nothing can generate. roster holds no
model credential and is agent-agnostic on purpose, so the portal cannot write them for you and
should not pretend to.

What it does instead is both halves of a round trip.

**Copy the prompt** builds a brief that carries its own state: every file it refers to is inlined,
so a chat window with no filesystem is as useful here as an agent standing in the repo. A charter
brief carries the org layer, `business.md` and **the peers' charters**, because without those the
model writes a second copy of whoever it was shown. It runs about 19,000 characters, on purpose:
one paste into a large-context model beats six rounds of it asking for files it will never get.

**Paste the answer back** turns a chat reply into a file. The brief asks for the finished file
inside sentinels:

```
<<<ROSTER FILE roster-ops/org/business.md>>>
...the whole file...
<<<ROSTER END>>>
```

Sentinels rather than code fences, because fences cannot survive the content: a charter and a
`business.md` both legitimately contain fenced examples. Text outside the block is ignored, because
the model will chat; one wrapping fence is stripped, because it will fence things anyway.

**Nothing is saved automatically.** You get a diff, then a button. And the failures come back as
next steps rather than errors, each with a line you can copy straight back:

| | |
|---|---|
| no envelope | *"Your AI answered in prose"*, plus the re-prompt |
| a file the brief did not ask for | refused and named; never offered as a save |
| the template handed straight back | caught; some models restate a long prompt before working |
| four lines | *"a failed answer, not a short one"* |

`roster brief <kind>` prints the same brief in a terminal.

## Graph

Two levels. Memory sections are big nodes on a fixed ring; clicking one fans its facts outwards
into its own angular slice, so a fan never lands among its neighbours. Clicking a fact reads
it. Groups keep their angle for the life of the view, so the picture is something you can build
a mental map of.

## What changed

What this agent learned and forgot, from git. Facts added and removed, grouped by day, each
opening the diff that did it: one block per file, coloured, with line numbers.

## Health

Three parts.

**The org, from `roster doctor`.** Every finding that is not `ok`, with what to do about it, and
a button that turns the lot into one brief for a coding agent. That is `roster fix`: `doctor`,
the prompt audit and `lint` each already carry the sentence that fixes their own finding, and
this collects them.

Two piles come out, and the split matters. What an agent editing files here can do, and what only
a person can: an org permission on a settings page, an App a human has to install, a credential
roster cannot obtain. The second pile is listed but explicitly not asked for, because an agent
handed one of those does not fail cleanly: it invents a workaround, and every workaround is worse
than the finding. The brief also names the framework-owned files **before** any of the work, since
an agent that has started editing has stopped reading.

Paste it into whatever edits files here, then press *Check again*. The ids should be gone.

**Memory problems**, and **the rig**.

Memory problems are the same checks `roster lint` runs. Each one has a button that opens an
issue in that staff member's own repo asking them to fix it, which is usually right, because
they wrote it.

**The rig**: schedule in words, workflows present, last commit, last commit touching `memory/`,
index and notes size, charter, status issue, missing surfaces.

## Docs

The framework's own documentation, rendered where you already are. Links between pages navigate
the portal.

## After upgrading roster

**Restart the portal.** Its stylesheets and modules are read per request, so editing one and
reloading works. Its server is not: it is loaded when `roster portal` starts. A portal left
running across an upgrade serves new modules against an old API.

The page notices and says so rather than rendering half of itself against values that are not
there, naming the fields the old server is not sending.

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
--dir <path>  where a tenant would be created or checked out (default: here)
```
