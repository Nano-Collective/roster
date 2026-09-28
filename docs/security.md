---
title: "Security model"
description: "What can reach what, what stops it, and what is not defended against."
sidebar_order: 21
---

# Security model

What can reach what, and what stops it.

## Credentials

| Credential | Lives | Can |
|---|---|---|
| Staff App private key | a repo secret | mint a token for the trackers it is installed on |
| Public App private key | a repo secret | mint a token for the public product repo |
| Agent credential | a repo secret | spend money with your model provider |
| Your `gh` token | your machine | whatever you can |

**No credential is held by roster.** The CLI and the portal shell out to your own `gh`. The
framework has no service, no server it talks to, and nothing to store.

## The App private key

Created by GitHub during the manifest flow and returned exactly once. `roster app` holds it in
memory and passes it to `gh secret set` on standard input.

It is never written to a file, never passed as a command-line argument, and never appears in
the process table. If the secret write fails after the App is created, the key is unrecoverable
and roster says so: generate a new one from the App's settings page.

## What a run can reach

A session runs with two tokens and a shell. It can do anything those tokens can do, which is
the point and also the boundary worth understanding.

**It cannot push a change under `.github/workflows/` in any repository.** That is a GitHub
restriction on App tokens, not a roster policy, and it is why agents cannot modify the
workflows that constrain them.

**It can only reach repos the App was installed on.** Under-granting is the common
misconfiguration and it fails at run time. Over-granting is the risk: an App installed on the
whole organisation can reach anything in it.

Install narrowly. The Staff card's **GitHub App** panel prints the list it actually needs, and
so does `roster app`.

## The review gate

"Nothing goes out unread" is enforced by GitHub, not by the prompt. An App with
`contents: write` on a product repo can push to its default branch, and with
`pull_requests: write` it can merge its own PR, unless a rule on the branch says otherwise.

The rule: **the default branch of every product repo requires a pull request with at least one
approving review, and no staff App is on the list of who may bypass it.** A ruleset or classic
branch protection both count.

**It is off unless you turn it on**, with `review_gate: true` in `org.yaml`. Without it, staff
are told to leave merging to you, and on Pip they always have, but GitHub does not stop them.
Most orgs keep product repos private on the Free plan, where GitHub cannot enforce the rule.

With it on, `roster doctor` reads it for every `role: product` repo in `org.yaml` and every repo a staff
member `works_in`, as `review-gate`. It fails when nothing requires a PR or a staff App can
bypass the rule, and warns when a PR is required with no approval, since then whoever opened
it can merge it.

With it on, `roster hire --apply` adds a ruleset named `roster: review before merge` to each product repo
that does not already require an approving review, and leaves anything stricter alone. Pass
`--no-review-gate` to skip it. The ruleset lets repository admins bypass it only by merging a
pull request, so your own merge is still the approval (GitHub will not let you approve your
own PR) and an App, which is never an admin, cannot merge at all.

**On GitHub Free, private repos can't have this rule.** GitHub only enforces rulesets and
branch protection on private repos for paid plans. To use the gate there, make the product repo
public or move the org to GitHub Team.

To set it by hand: repo **Settings -> Rules -> Rulesets -> New branch ruleset**, target the
default branch, tick **Require a pull request before merging** with one required approval, and
keep the staff Apps off the bypass list.

## Permissions a new App asks for

```
contents: write     commit and push
issues: write       open, comment, close, label, pin
pull_requests: write
metadata: read      always required
```

Deliberately **not** `workflows: write`. One of the pre-existing Apps here declares it, which is
a good illustration of the trap: **a declaration is not a grant**. `GET /apps/<slug>` reports
what an App asked for, which says nothing about what any installation gave it.

Never verify an installation by reading the API. The only proof is a run that finished.

## Setting up from the portal

The setup screen creates repositories, creates GitHub Apps and writes repository secrets. It is
the most privileged surface roster has, and it is **local only**: bound to `127.0.0.1`, behind the
same write guard as everything else, and never something to put behind a tunnel. There is no
hosted setup and there should not be.

The App manifest hand-off runs on the portal's own port rather than a second one, which changes
where the callback lands and nothing else: the one-time code is still exchanged server-side, and
the private key is still held in memory and written straight to a repo secret without touching
disk. A hand-off is keyed by a random state that GitHub echoes back, held in memory only, and a
callback whose state is unknown is refused.

## The portal

It can write to GitHub, so it is worth being precise.

It binds to `127.0.0.1`. A write needs a `POST`, an `x-roster` header (which forces a CORS
preflight that fails from any other origin), and an `Origin` that is either absent or
localhost. Reads are served to anything that can reach the port.

Two paths take attacker-controlled input to the disk or a command line, and both are
constrained rather than sanitised:

- `/api/file` resolves the path and refuses anything outside the workspace root.
- `/api/diff` requires the directory to be a known staff repo and the sha to look like a sha.
- `/api/doc` requires the page to be one the listing offered.
- `/api/docasset` requires the screenshot to be one sitting in `docs/images/`, matched by name
  against that listing. `..` is not a case to get wrong; it is simply a name not on it.

`--host` overrides the bind address and prints a warning. It exists for people who know what
they are doing on a network they control. See [hosting the portal](hosting.md).

## Trust in a prompt

Everything composed into a prompt is content you or your agents wrote: `org/`, the charter, the
memory index. A `mention` run additionally carries the text of a comment.

**On a private tracker that is you.** On the public product repo it is not, which is exactly
why **nothing in a product repo wakes an agent at all**. There is no caller workflow there, by
design: anyone can comment on a public pull request, a run started from a comment executes with
repository secrets, and a run that prints a charter and a chain of reasoning would print it
into a world-readable log.

So a mention on a public pull request is decoration. It posts, it renders as a chip, and
nothing happens, which is safe and also invisible. The portal is what makes it visible and what
gets you out of it: replying with an `@handle` where nothing listens says so, and offers to
open the request on that person's own private tracker as well, carrying the pull request and
the hunk. It writes through your own `gh`, as you, so no credential lives on the
public repo and nothing is dispatched across a boundary.

If you add a workflow to a product repo that bridges this automatically, its author gate is
load-bearing. Do not relax it.

## The loop guard

The mention callers gate on `github.event.sender.login`, the account that **performed** the
action, not the author of the thing acted on.

That distinction is load-bearing. The pinned status issue is opened by the human and rewritten
by the agent on every run. An author check would let the agent's own edit wake another run,
which would edit it again.

## What is not defended against

- **A compromised model provider account.** The agent credential can spend money and the agent
  can write to your repos.
- **A malicious prompt injection from a public comment**, beyond the split above. A staff
  member reading a public PR comment is reading untrusted text.
- **Someone with write access to the ops repo.** They can change what every staff member is
  told to do, on the next run. Treat `roster-ops` as production.
