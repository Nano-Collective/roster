# Hosting the portal

`roster portal` is local-first and that is the intended way to run it. It reads the checked-out
repositories from disk, needs no authentication, hits no API rate limits, and works offline.

```bash
roster portal              # http://localhost:4300
roster portal --port 4400
```

## Why local is the default

The portal can write. It replies to issues, closes them, reopens them and opens new ones,
acting as you through your own `gh`. That is the point: it is where a person answers their
agents. It also means it is not a thing to leave listening on a network.

Three things guard it, and they only work locally:

- it binds to `127.0.0.1`
- a write needs a `POST` with an `x-roster` header, which forces a CORS preflight that fails
  from any other origin
- an `Origin` header, if present, must be localhost

`--host` overrides the bind address and prints a warning. Do not use it to "just have a look
from my phone".

## Reading it from elsewhere

The honest options, in order of how much you should like them.

**A tunnel, briefly.** `ssh -L 4300:localhost:4300 you@yourmachine`, or Tailscale, or
`cloudflared tunnel --url http://localhost:4300`. Your machine stays the only thing running it
and the write path stays behind your own network identity. Turn it off afterwards.

**A read-only static build.** `roster export` produces the whole org as one JSON document, and
the portal's rendering is decoupled from its parsing precisely so this is possible:

```bash
roster export --out org.json
```

Serve that plus the portal HTML from anything static (Cloudflare Pages, S3, a directory). You
get memory, the graph, the brain and what-changed. You do not get the inbox or any write
action, because both need `gh`.

Put access control in front of it. Cloudflare Access with a one-person policy is the least
work. **This is private business content and a map of what your agents know**, so an
unauthenticated URL is not an option even if nobody knows it.

**A hosted instance with write access.** Not documented, and not recommended. It would need a
GitHub App of its own, a session layer, and a credible answer to "what can this thing do if
someone reaches it". None of that exists, and the local server plus a tunnel gets you the same
outcome with none of it.

## Keeping it current

The portal reads your working tree, so a stale checkout shows stale data. `/api/sync` fetches
and fast-forwards every repository on each refresh. It refuses to pull one that is dirty or has
diverged, and says which in a banner rather than guessing.

If you host a static export, the export is a point in time. Regenerate it on a schedule, or
accept that it is yesterday's.
