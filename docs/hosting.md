---
title: "Hosting the portal"
description: "The portal on your own URL, behind Sign in with GitHub, redeploying itself."
sidebar_order: 11
---

# Hosting the portal

The portal runs in two places, and it is the same code in both.

```bash
roster portal                                  # on your machine, http://localhost:4300
roster portal deploy --domain roster.acme.com  # on the web, on Cloudflare Workers
```

Both read the org from GitHub, so neither needs the repos checked out to show it. Both act on
GitHub as the person using them. The hosted one adds a sign-in in front, and leaves out the
few screens that need a checkout.

## What you get, and what stays on your machine

Hosted, you get everything you use day to day: Home, the trackers, threads and replies, pull
requests (approve and merge), Runs, the brains, prompts, the org files and their editors, and
the docs.

These stay on your machine, and the hosted page says so where they would be:

- **Setup**: standing up an org, the GitHub Apps, the agent credential
- **Hiring and retiring**
- **Doctor and the Health checklist**, which read the checkout and the org's secrets

They create repositories and Apps and write secrets, which is the most privileged thing roster
does. That is not something to put behind a public URL.

## Who can get in

Only the people listed under `humans:` in `org.yaml`, signed in with their own GitHub account.

- Sign-in is GitHub's own OAuth flow, through an OAuth App your org creates for the portal.
  The token it hands back is that person's, scoped `repo` and `notifications`, the same kind
  `gh` holds on their machine.
- Everything they do is as themselves. A reply is theirs, a merge is theirs, and what they can
  read is what GitHub lets them read.
- Somebody who signs in and is not one of the humans, or cannot read the ops repo, is turned
  away and their token revoked. Somebody removed from `humans:` stops getting in within a few
  minutes.
- A sign-in lasts fourteen days. Signing out revokes the token on GitHub.

See [security](security.md#the-hosted-portal) for what is held where.

## Deploying it

You need a Cloudflare account with the domain on it, and wrangler signed in to it. If your
login can see more than one account, pass `--account <id>` with the one that has the domain, and
it is pinned in the config so a later deploy cannot land anywhere else:

```bash
npx wrangler login
roster portal deploy --domain roster.acme.com           # says what it will do
roster portal deploy --domain roster.acme.com --apply   # does it
```

The first time, it stops for the one thing only you can do: **create the OAuth App**. It prints
the link and the three fields:

| Field | Value |
|---|---|
| Application name | `<org> roster` |
| Homepage URL | `https://roster.acme.com` |
| Authorization callback URL | `https://roster.acme.com/auth/callback` |

Register it, generate a client secret, and paste the two values when asked. The secret is not
shown as you type.

Then it deploys the Worker, stores the App's secret and a fresh session key as Worker secrets,
and commits two files to the ops repo:

- `portal/wrangler.jsonc`: the Worker's name, the domain, the org. Nothing secret.
- `.github/workflows/portal.yaml`: redeploys it.

## Keeping it up to date

The workflow redeploys the portal when its config changes, every morning, and when you run it
by hand. Each deploy uses the newest roster, so updates arrive by themselves.

It needs two secrets on the ops repo:

| Secret | Where from |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → API Tokens → the **Edit Cloudflare Workers** template |
| `CLOUDFLARE_ACCOUNT_ID` | the Workers page of the dashboard |

Without them the portal still runs; it only stops updating itself.

The portal reads GitHub fresh as you use it, so there is nothing to sync. It asks whether
anything has moved every few seconds, and an answer of "no" costs nothing against GitHub's
hourly limit.

## The cache

The portal keeps what it has read from GitHub: file contents by their hash, each commit's file
dates, and finished runs' costs. All of it is immutable, so it is never stale.

On your machine it is `~/.cache/roster`. On Cloudflare it is the edge cache, which needs no
setup. To keep it everywhere rather than per data centre, bind a KV namespace as `CACHE` in
`portal/wrangler.jsonc`.

## On your machine

`roster portal` binds to `127.0.0.1` and acts as whoever `gh` is signed in as. To open an org
you have never cloned:

```bash
roster portal --org acme
```

`--host` overrides the bind address and prints a warning. The local server has no sign-in, so
use the hosted portal instead of exposing it.
