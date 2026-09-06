# The portal

```bash
roster portal          # http://localhost:4300
```

A local web UI over the checked-out repositories. Reads them from disk, so it needs no
authentication and no API quota, and works offline. It can write to GitHub through your own
`gh`. See [hosting](hosting.md) for why it stays local.

Keep the repos checked out beside each other, in the same shape the runner uses.

## Inbox

Everything open across the org, from one GraphQL call per repo. Bodies and comments come down
with the list, so opening a thread is a render rather than a request.

- **Filter by staff member.** An item belongs to somebody if it is in their brain repo, their
  own App wrote it, a peer addressed it to them with a `from-<handle>` label, or it is assigned
  to them. The shared public identity cannot name one staff member, so an item it wrote counts
  for anyone who works in that repo. Items authored by humans belong to nobody, which is
  correct.
- **Scope** to everything, what is assigned to you, decisions, or open PRs.
- **Reply, close, reopen, open an issue.** All as you, through your own `gh`, so they are
  indistinguishable from doing it on the site. Closing asks for confirmation.
- Issue and PR references in a body become chips you can click through.

## Brain

Memory and the file tree, merged, because they were always the same thing: both manifests
already declared `memory/` as a surface.

The navigator lists memory sections beside every other declared surface. One search box
searches facts and files together: type a slug and the matching facts are offered directly.

Renderers follow the surface's `render` field: markdown as documents, images, CSV as tables,
code with its line breaks. A relative link inside a brain document opens that file in the pane
rather than going nowhere.

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
