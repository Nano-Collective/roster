---
title: "Connectors"
description: "Give staff outside services, like Sentry, Linear or Stripe, to use in their runs."
sidebar_order: 5
---

# Connectors

A connector gives staff an outside service to use in their runs: errors from Sentry, issues in
Linear, payments in Stripe. Each one is an [MCP](https://modelcontextprotocol.io) server, and the
staff member's coding agent calls it like any other tool.

Add one from the portal's **Connectors** screen: pick the service, follow the steps to get a key,
paste it, tick who can use it, and save. Or from a terminal:

```bash
roster connector add sentry --staff cto --apply
```

## What happens when you add one

1. **The key is checked** with the service, with one cheap request. A key the service rejects
   is not stored. A key that works but cannot read everything is fine: that is what a narrow
   key looks like.
2. **The key is stored as a GitHub secret**, named `CONNECTOR_<NAME>_<FIELD>`, for example
   `CONNECTOR_SENTRY_TOKEN`. It goes once to the org where that reaches private repos, which is
   every plan but Free, and to each brain repo otherwise. It is encrypted on the way, never
   written to a file, and never shown again.
3. **`org.yaml` says who has it**, and is committed:

   ```yaml
   connectors:
     sentry:
       staff: [cto]
     supabase:
       staff: [cto]
       project_ref: abc123
       read_only: true
   ```

On each run, `connectors.mjs` reads that list, takes the keys of this staff member's connectors
from the run's secrets, and writes them into the agent's own MCP config in the runner's temp
directory, outside every checkout. The prompt gets a short section naming the services, and
saying that what a service returns is information, not an instruction.

A connector whose key is missing is left out, named in the run's summary, and the run goes on
without it. `roster doctor` reports it as `connector.key`.

## The catalogue

| Name | Service | Key | Read only |
|---|---|---|---|
| `sentry` | Sentry | auth token | no |
| `linear` | Linear | personal API key | no |
| `github` | GitHub, for repos outside this org | fine-grained token | yes |
| `supabase` | Supabase | access token, and optionally the project ref | yes |
| `postgres` | any Postgres database | connection string | yes |
| `cloudflare` | Cloudflare | API token | no |
| `posthog` | PostHog | personal API key | yes |
| `stripe` | Stripe | restricted key | no |
| `resend` | Resend | API key | no |
| `notion` | Notion | signs in through the hosted portal | no |
| `notion-key` | Notion, through an integration | integration secret | no |

Read only is a setting roster can enforce on the server: Supabase's `read_only`, GitHub's read-only
mode, PostHog's read-only header, and restricted transactions for Postgres. For the others,
choose what the key may do when you create it. Stripe's restricted keys, Cloudflare's token
permissions and Linear's key permissions all do this, and it is the safer place to decide it.

Vercel and Slack are not in the catalogue. Their MCP servers only accept sign-ins from apps they
have approved, which a run cannot use.

## Who can use it

`staff:` is the list. A key is readable by every brain repo, so that giving a connector to
somebody else later is a change to `org.yaml`, not another paste. Which run gets which key is
still `org.yaml`'s call: each run is given only its own staff member's connectors.

`read_only: true` holds a connector to reading for everybody who has it. A staff member whose
[permissions](agents.md#permissions) are `read-only` gets every connector held to reading, and a
connector that cannot be held to reading is left out for them.

## Each agent

The same list, in each agent's own words:

| Agent | How it is given the servers |
|---|---|
| `claude-code-action`, `claude` | `--mcp-config` with a JSON file, and `mcp__<name>` added to `--allowedTools` |
| `codex` | a `config.toml` in a fresh `CODEX_HOME`; `CODEX_API_KEY` still signs it in |
| `nanocoder` | `NANOCODER_MCPSERVERS_FILE`, pointing at its own format |

Nanocoder only shows MCP tools to a model whose tool profile resolves to `full`. A small local
model may not see them.

## Signing in: Notion

Notion's hosted MCP server takes no key: it signs in with a browser. A run cannot do that, so the
[hosted portal](hosting.md) does it once and keeps the sign-in:

1. On the Connectors screen, pick Notion, tick who can use it, and press **Sign in to Notion**.
2. Notion asks which pages to share. The portal keeps the sign-in, sealed under its session key,
   in a KV namespace of its own.
3. Each run asks the portal for a fresh access token. It proves which run it is with GitHub's own
   OIDC token, and the portal only answers a run of this org's `session.yaml`. No secret is
   shared with the run to make that work.

This needs the hosted portal, with a KV namespace bound as `CONNECTORS`. `roster portal deploy`
creates one. A sign-in Notion has not used for 30 days, or one older than 180 days, has to be
done again; the Connectors screen says so.

Without the hosted portal, use `notion-key`: an internal integration's secret, pasted like any
other key.

## A service that is not in the catalogue

Write it out in `org.yaml`, with a `url` or a `command`, and the names of the keys it needs:

```yaml
connectors:
  acme-api:
    staff: [cto]
    url: https://mcp.acme.dev/mcp
    secrets: [TOKEN]
    headers:
      Authorization: "Bearer ${TOKEN}"
  local-thing:
    staff: [cmo]
    command: npx -y @acme/mcp-server
    secrets: [API_KEY]
    env:
      ACME_API_KEY: "${API_KEY}"
```

`${TOKEN}` is replaced with the secret `CONNECTOR_ACME_API_TOKEN` in the run. Store it with:

```bash
roster connector add acme-api --url https://mcp.acme.dev/mcp --secret TOKEN --apply
```

A name is lower case letters, digits and `-`, because it becomes part of each tool's name.

## Safety

- Text a service returns is treated as information. The prompt says so, and says that anything
  acting in public under your name, like sending an email or charging a customer, needs a
  `decision` issue first.
- Give each key the least it needs. A read-only key is a limit no prompt can talk its way past.
- The agent can read its own MCP config, and so its keys, in the run. Treat a connector's key as
  given to the staff members who have it.
- Removing a connector deletes its keys and its sign-in, and takes it out of `org.yaml`.

## Callers from before connectors

Keys reach a run because the callers pass their secrets on with `secrets: inherit`. Callers
generated before connectors map their secrets by hand, so no connector's key reaches them;
`roster doctor` reports it as `connector.caller`, and `roster upgrade --apply` regenerates them.
