# Architecture

What actually happens, and why it is shaped this way.

## The constraint that decided everything

**A reusable workflow in a private repo can only be called by repos in the same organisation.**

So a tenant cannot call a workflow living in a private framework repo. Two ways out:

- Publish the framework early so it can be referenced. That forces the open-source decision
  before you are ready, and makes every tenant depend on an org they do not control.
- **The framework never runs anything. It writes templates into the tenant's own repo.**

The second is what roster does, and it is better independently of licensing. Every tenant is
self-contained. Nothing breaks if the framework moves, goes private, or is deleted. An
air-gapped install is a supported case rather than a special one.

The cost is that framework improvements do not arrive by themselves. `roster upgrade` is what
carries them, run by a human. See [upgrading](upgrading.md).

## Three repos, three jobs

```
Nano-Collective/roster        the framework. Never a runtime dependency of anything.
<org>/roster-ops              the org layer and the machinery. Private.
<org>/<staff>                 one per staff member. The repo is the brain.
```

Inside the ops repo there is a second split, enforced by convention so that extraction stays a
directory copy:

- **`org/`** is the tenant's business truth. Never published, always yours.
- **everything else** came from the framework's templates and can be regenerated.

## A day in the life of a run

07:00 UTC, `cto-daily.yaml` fires on cron.

1. The caller passes nine inputs and five secrets to `roster-ops/.github/workflows/session.yaml`
   and does nothing else. It is forty lines because everything that could be shared, is.
2. The session mints a GitHub App token. **The agent posts as `pip-cto[bot]`, not as you.**
3. It clones the ops repo, which is the only thing it can clone without having read a manifest.
4. `runner-plan.mjs` reads `org.yaml` and the staff member's manifest and says what else to
   clone: the brain with full history, each peer's brain, each product repo.
5. `compose.mjs` assembles the prompt from six files: four org-level, the charter, and the
   fragment for this kind of run.
6. `agents.mjs` resolves which coding agent to run and how.
7. The agent runs with a shell, `gh` already authenticated, and the whole checkout.
8. It works, commits, pushes, opens issues, comments, and rewrites its pinned status issue.
   **The workflow does not commit on its behalf**; the prompt tells it to and it does.

Nothing is stored outside the repos. There is no database and no service.

## Boot, work, hand off

The prompt imposes a shape, and the shape is what makes an unattended run useful.

**Boot** is reconstituting a self that has no memory of yesterday. It reads `memory/INDEX.md`
in full, the pinned status issue, and its own charter. That is deliberately all: notes are read
only when a fact is in play, and the decision log is not boot context at all.

This is why memory is one line per fact. Boot context here went from about 52,000 words to
about 6,000 by making that change, and the saving repeats on every run of every staff member
forever.

**Work** is one thing done properly rather than four things started.

**Hand off** is the part that makes the next run possible: open the PR, rewrite the status
issue (rewrite, not append), reconcile the tracker, update memory only if a fact changed, log
real decisions, and write to peers if something touches their patch.

## Why the memory is markdown

An agent writes markdown well and writes to a schema badly. A database would need the agent to
be careful about something it is not good at being careful about, and would put the brain
somewhere you cannot read with `git log`.

The cost is that the grammar is a convention rather than a constraint, so `roster lint`
enforces it and the portal parses it. See [memory](memory.md).

## Identities and why there are two

A staff member has a private App for its own trackers, and shares a public App with everyone
else for the product repo.

The private one is unique, so work on an internal board is attributable. The public one is
shared and deliberately anonymous, because a bot opening a pull request on a public repo is
unremarkable and a bot signing itself with a job title is a tell.

`roster doctor` treats these differently when attributing work: a solo identity names one staff
member, a shared one names only "one of them".

## What cannot be automated, and why

- **Creating a GitHub App** has no API. Only the manifest flow, which needs a browser and a
  human confirmation. `roster app` does everything either side of that.
- **Installing an App** grants access to specific repos and GitHub asks a human which. This is
  correct and should not be worked around.
- **Pushing a workflow change** is impossible with an App token, in any repo. So agents can
  never update their own workflows, and upgrades are human-run by design.

See [manual steps](manual-steps.md).

## Where the pieces live

| Piece | In | Why there |
|---|---|---|
| `compose.mjs` | the tenant | a run must not depend on npm or on the framework |
| `agents.mjs` | the tenant | same |
| `runner-plan.mjs` | the tenant | same |
| `session.yaml` | the tenant | private reusable workflows are same-org only |
| the CLI | the framework | runs on your machine, when you ask it to |
| the portal | the framework | reads the tenant's repos from disk |
| the docs | the framework | including the copy the portal serves |
