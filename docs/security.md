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

Install narrowly. `roster app` prints the list it actually needs.

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

`--host` overrides the bind address and prints a warning. It exists for people who know what
they are doing on a network they control. See [hosting the portal](hosting.md).

## Trust in a prompt

Everything composed into a prompt is content you or your agents wrote: `org/`, the charter, the
memory index. A `mention` run additionally carries the text of a comment.

**On a private tracker that is you.** On the public product repo it is not, which is exactly
why the product lane is split: a mention on a public PR is caught by a forwarder in that repo
which does no work of its own, and dispatches to the private lane. The run that prints a
charter and a chain of reasoning happens where the logs are not world-readable.

The forwarder has an author gate, and it is load-bearing: anyone can comment on a public PR,
and a run started from a comment executes with repository secrets. Do not relax it.

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
