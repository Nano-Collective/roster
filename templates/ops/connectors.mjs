#!/usr/bin/env node
/**
 * Connectors: the outside services a staff member may use in a run, as MCP servers.
 *
 * VENDORED into every tenant's ops repo, for the same reason agents.mjs is: a run at 07:00 must
 * not depend on npm or on an org the tenant does not control.
 *
 * org.yaml says who gets what, and nothing else:
 *
 *   connectors:
 *     sentry:
 *       staff: [cto]
 *     linear:
 *       staff: [cto, cmo]
 *
 * A name from the catalogue below brings its server, how to get a key, and how to check one.
 * Anything else is written out longhand, with a `url` or a `command`. Keys never go in
 * org.yaml: each is a GitHub secret named by `secretName`, and a run reads it from the caller's
 * secrets, which reach session.yaml through `secrets: inherit`.
 *
 * Each agent hears the same list in its own vocabulary: an MCP config file for Claude, the same
 * for nanocoder by its own environment variable, and a config.toml in a fresh CODEX_HOME for
 * Codex.
 * That translation lives here because this is the only file that knows both sides.
 */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/* ------------------------------------------------------------------------------------------ */
/* The catalogue                                                                              */
/* ------------------------------------------------------------------------------------------ */

/**
 * Well-known services, so that adding one is: pick it, paste a key, tick who gets it.
 *
 * Every entry here takes a key that can be pasted, because a run at 07:00 cannot click through
 * a sign-in. The ones that only offer a sign-in are `auth: "oauth"`, and they work through the
 * hosted portal, which holds the sign-in and hands each run a fresh access token.
 *
 *   fields      what the person fills in. `secret: true` goes to a GitHub secret, the rest to
 *               org.yaml. `pattern` catches a wrong paste before it is stored.
 *   server      the MCP server, from the filled-in fields. Secret values arrive here only in a run.
 *   readOnly    how this connector is held to reading, for a read-only staff member or one
 *               marked `read_only: true`: a server that can be told (`server` gets
 *               `readOnly: true`), or the names of its tools that only read, which only an
 *               agent that takes a tool list can enforce. Absent: it is left out for them.
 *   check       one cheap request that proves a key works, for the Check key button.
 */
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const key = (label, extra = {}) => ({ id: "token", label, secret: true, ...extra });

export const CATALOGUE = {
  sentry: {
    name: "Sentry",
    summary: "Read errors, issues and releases.",
    suggest: ["cto"],
    link: "https://sentry.io/settings/account/api/auth-tokens/",
    steps: [
      "Open Sentry, then Settings, then Personal Tokens.",
      "Create a token with read access to your organisation and projects.",
      "Copy it and paste it here.",
    ],
    fields: [key("Auth token")],
    // Sentry-Bearer, not Bearer: Sentry keeps plain Bearer for its own sign-in.
    server: (v) => ({
      transport: "http",
      url: "https://mcp.sentry.dev/mcp",
      headers: { Authorization: `Sentry-Bearer ${v.token}` },
    }),
    check: (v) => ({ url: "https://sentry.io/api/0/organizations/", headers: bearer(v.token) }),
  },

  linear: {
    name: "Linear",
    summary: "Read and update issues, projects and cycles.",
    suggest: ["cto", "cpo"],
    link: "https://linear.app/settings/account/security",
    steps: [
      "Open Linear, then Settings, then Security & access.",
      "Under Personal API keys, create a key.",
      "Copy it and paste it here.",
    ],
    fields: [key("API key", { pattern: "^lin_api_" })],
    server: (v) => ({ transport: "http", url: "https://mcp.linear.app/mcp", headers: bearer(v.token) }),
    // The GraphQL API takes the key bare, unlike the MCP server.
    check: (v) => ({
      url: "https://api.linear.app/graphql",
      method: "POST",
      headers: { Authorization: v.token, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "{ viewer { id } }" }),
    }),
  },

  github: {
    name: "GitHub",
    summary: "Read and act on repos outside this org.",
    suggest: [],
    link: "https://github.com/settings/personal-access-tokens",
    steps: [
      "Open GitHub, then Settings, then Developer settings, then Fine-grained tokens.",
      "Create a token for the repos the staff should reach.",
      "Copy it and paste it here.",
    ],
    fields: [key("Personal access token", { pattern: "^(github_pat_|ghp_)" })],
    server: (v, o) => ({
      transport: "http",
      url: "https://api.githubcopilot.com/mcp/",
      headers: { ...bearer(v.token), ...(o.readOnly ? { "X-MCP-Readonly": "true" } : {}) },
    }),
    readOnly: { server: true },
    check: (v) => ({ url: "https://api.github.com/user", headers: bearer(v.token) }),
  },

  supabase: {
    name: "Supabase",
    summary: "Query the database and read project settings.",
    suggest: ["cto"],
    link: "https://supabase.com/dashboard/account/tokens",
    steps: [
      "Open Supabase, then Account, then Access Tokens.",
      "Generate a token.",
      "Copy it and paste it here, with the project's reference ID from Project Settings.",
    ],
    fields: [
      key("Access token", { pattern: "^sbp_" }),
      { id: "project_ref", label: "Project reference ID", required: false },
    ],
    server: (v, o) => {
      const q = new URLSearchParams();
      if (v.project_ref) q.set("project_ref", v.project_ref);
      if (o.readOnly) q.set("read_only", "true");
      const qs = q.toString();
      return {
        transport: "http",
        url: `https://mcp.supabase.com/mcp${qs ? `?${qs}` : ""}`,
        headers: bearer(v.token),
      };
    },
    readOnly: { server: true },
    check: (v) => ({ url: "https://api.supabase.com/v1/projects", headers: bearer(v.token) }),
  },

  postgres: {
    name: "Postgres",
    summary: "Query a Postgres database.",
    suggest: ["cto"],
    link: "",
    steps: [
      "Use a connection string for a database user with only the access the staff should have.",
      "It looks like postgresql://user:password@host:5432/database.",
    ],
    fields: [key("Connection string", { pattern: "^postgres(ql)?://" })],
    // No official server. postgres-mcp is the maintained one, and pipx is on GitHub's runners.
    server: (v, o) => ({
      transport: "stdio",
      command: "pipx",
      args: ["run", "postgres-mcp", `--access-mode=${o.readOnly ? "restricted" : "unrestricted"}`],
      env: { DATABASE_URI: v.token },
    }),
    readOnly: { server: true },
  },

  cloudflare: {
    name: "Cloudflare",
    summary: "Read and change Workers, DNS and other account settings.",
    suggest: ["cto"],
    link: "https://dash.cloudflare.com/profile/api-tokens",
    steps: [
      "Open Cloudflare, then My Profile, then API Tokens.",
      "Create a token with the permissions the staff should have.",
      "Copy it and paste it here.",
    ],
    fields: [key("API token")],
    server: (v) => ({ transport: "http", url: "https://mcp.cloudflare.com/mcp", headers: bearer(v.token) }),
    check: (v) => ({
      url: "https://api.cloudflare.com/client/v4/user/tokens/verify",
      headers: bearer(v.token),
    }),
  },

  posthog: {
    name: "PostHog",
    summary: "Read analytics, insights and feature flags.",
    suggest: ["cpo", "cmo"],
    link: "https://app.posthog.com/settings/user-api-keys",
    steps: [
      "Open PostHog, then Settings, then Personal API keys.",
      "Create a key with the MCP Server preset.",
      "Copy it and paste it here.",
    ],
    fields: [key("Personal API key", { pattern: "^phx_" })],
    server: (v, o) => ({
      transport: "http",
      url: "https://mcp.posthog.com/mcp",
      headers: { ...bearer(v.token), ...(o.readOnly ? { "x-posthog-read-only": "true" } : {}) },
    }),
    readOnly: { server: true },
  },

  stripe: {
    name: "Stripe",
    summary: "Read payments, customers and subscriptions.",
    suggest: ["cfo"],
    link: "https://dashboard.stripe.com/apikeys",
    steps: [
      "Open Stripe, then Developers, then API keys.",
      "Create a restricted key for agent access, with read permissions only.",
      "Copy it and paste it here.",
    ],
    fields: [key("Restricted key", { pattern: "^rk_(live|test)_" })],
    server: (v) => ({ transport: "http", url: "https://mcp.stripe.com", headers: bearer(v.token) }),
    check: (v) => ({ url: "https://api.stripe.com/v1/balance", headers: bearer(v.token) }),
  },

  resend: {
    name: "Resend",
    summary: "Send email and read domains and delivery.",
    suggest: ["cmo"],
    link: "https://resend.com/api-keys",
    steps: ["Open Resend, then API Keys.", "Create a key.", "Copy it and paste it here."],
    fields: [key("API key", { pattern: "^re_" })],
    server: (v) => ({ transport: "http", url: "https://mcp.resend.com/mcp", headers: bearer(v.token) }),
    check: (v) => ({ url: "https://api.resend.com/domains", headers: bearer(v.token) }),
  },

  notion: {
    name: "Notion",
    summary: "Read and write pages and databases.",
    suggest: ["cmo", "cpo"],
    auth: "oauth",
    steps: ["Sign in to Notion and choose the pages to share."],
    fields: [],
    oauth: { resource: "https://mcp.notion.com/mcp" },
    server: (v) => ({ transport: "http", url: "https://mcp.notion.com/mcp", headers: bearer(v.access_token) }),
  },

  "notion-key": {
    name: "Notion (integration key)",
    summary: "Read and write the pages shared with an integration.",
    suggest: [],
    link: "https://www.notion.so/profile/integrations",
    steps: [
      "Open Notion, then Settings, then Integrations, and create an internal integration.",
      "Share the pages the staff should see with it.",
      "Copy its secret and paste it here.",
    ],
    fields: [key("Integration secret", { pattern: "^(ntn_|secret_)" })],
    server: (v) => ({
      transport: "stdio",
      command: "npx",
      args: ["-y", "@notionhq/notion-mcp-server"],
      env: { NOTION_TOKEN: v.token },
    }),
    check: (v) => ({
      url: "https://api.notion.com/v1/users/me",
      headers: { ...bearer(v.token), "Notion-Version": "2022-06-28" },
    }),
  },
};

/* ------------------------------------------------------------------------------------------ */
/* Names                                                                                      */
/* ------------------------------------------------------------------------------------------ */

const ID = /^[a-z][a-z0-9-]{0,30}$/;

/** The GitHub secret a connector's field is stored as. Secret names are upper case and `_`. */
export function secretName(id, field) {
  return `CONNECTOR_${id}_${field}`.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
}

/* ------------------------------------------------------------------------------------------ */
/* Reading org.yaml                                                                           */
/* ------------------------------------------------------------------------------------------ */

/**
 * Every connector org.yaml declares, merged with its catalogue entry, valid or not. A problem
 * is reported on the entry rather than thrown, so doctor and the portal can say which one is
 * wrong while the others still work.
 */
export function declared(org) {
  const raw = org?.connectors;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  return Object.entries(raw).map(([id, entry]) => describe(id, entry ?? {}));
}

function describe(id, entry) {
  const known = CATALOGUE[entry.catalogue ?? id] ?? null;
  const staff = Array.isArray(entry.staff) ? entry.staff.map(String) : entry.staff ? [String(entry.staff)] : [];
  const out = {
    id,
    name: known?.name ?? entry.name ?? id,
    known: Boolean(known),
    catalogue: known ? (entry.catalogue ?? id) : null,
    staff,
    readOnly: entry.read_only === true,
    auth: known?.auth ?? (entry.auth === "oauth" ? "oauth" : "key"),
    portal: entry.portal ? String(entry.portal) : null,
    settings: {},
    secrets: [],
    problem: null,
    entry,
  };
  if (!ID.test(id)) {
    out.problem = `"${id}" is not a usable name: lower case letters, digits and -, starting with a letter`;
    return out;
  }
  if (known) {
    for (const f of known.fields ?? []) {
      if (f.secret) out.secrets.push({ field: f.id, label: f.label, name: secretName(id, f.id) });
      else if (entry[f.id] !== undefined && entry[f.id] !== null) out.settings[f.id] = String(entry[f.id]);
      else if (f.required !== false) out.problem = `${out.name} needs ${f.id} in org.yaml`;
    }
    if (out.auth === "oauth" && !out.portal) {
      out.problem = `${out.name} signs in through the hosted portal, and org.yaml names none (portal:)`;
    }
    return out;
  }
  // Written out longhand: a url or a command, and the secrets it names.
  if (!entry.url && !entry.command) {
    out.problem = `${id} is not in the catalogue, so it needs a url or a command`;
    return out;
  }
  for (const s of list(entry.secrets)) {
    out.secrets.push({ field: String(s).toLowerCase(), label: String(s), name: secretName(id, String(s)) });
  }
  if (out.auth === "oauth" && (!entry.url || !out.portal)) {
    out.problem = `${id} signs in through the hosted portal, so it needs a url and a portal`;
  }
  return out;
}

function list(v) {
  if (Array.isArray(v)) return v;
  return v === undefined || v === null || v === "" ? [] : [v];
}

/** The connectors one staff member has, in the order org.yaml lists them. */
export function connectorsOf(org, handle) {
  return declared(org).filter((c) => c.staff.includes(handle));
}

/* ------------------------------------------------------------------------------------------ */
/* Servers                                                                                    */
/* ------------------------------------------------------------------------------------------ */

/**
 * The MCP server for one connector, neutral of any agent:
 *   { name, transport: "http", url, headers }  or  { name, transport: "stdio", command, args, env }
 * plus `tools`, the tool names it is held to when reading only is enforced by a tool list.
 *
 * `values` maps each secret field to its value; a run has them, nothing else does.
 */
export function serverFor(c, values, opts = {}) {
  const readOnly = opts.readOnly === true;
  const known = c.catalogue ? CATALOGUE[c.catalogue] : null;
  let spec;
  if (known) {
    spec = known.server({ ...c.settings, ...values }, { readOnly });
  } else {
    const fill = (s) =>
      String(s).replace(/\$\{([A-Za-z0-9_]+)\}/g, (_, k) => values[k.toLowerCase()] ?? "");
    spec = c.entry.url
      ? {
          transport: "http",
          url: String(c.entry.url),
          headers: {
            ...Object.fromEntries(Object.entries(c.entry.headers ?? {}).map(([k, v]) => [k, fill(v)])),
            ...(values.access_token ? bearer(values.access_token) : {}),
          },
        }
      : {
          transport: "stdio",
          ...splitCommand(String(c.entry.command)),
          env: Object.fromEntries(Object.entries(c.entry.env ?? {}).map(([k, v]) => [k, fill(v)])),
        };
  }
  const tools = readOnly && known?.readOnly?.tools ? known.readOnly.tools : null;
  return { name: c.id, ...spec, tools };
}

/**
 * Whether a connector can be given to someone who may only read, and how. A server that can be
 * told is told; a list of reading tools needs an agent that takes a tool list; anything else is
 * left out rather than given in full.
 */
export function readOnlyMode(c, agentTakesTools) {
  const known = c.catalogue ? CATALOGUE[c.catalogue] : null;
  const how = known?.readOnly;
  if (!how) return null;
  if (how.server) return "server";
  if (how.tools && agentTakesTools) return "tools";
  return null;
}

/** "npx -y @scope/pkg --flag" as a command and its arguments. No shell, so no quoting games. */
function splitCommand(line) {
  const parts = line.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  const clean = parts.map((p) => p.replace(/^(["'])(.*)\1$/, "$2"));
  return { command: clean[0] ?? "", args: clean.slice(1) };
}

/* ------------------------------------------------------------------------------------------ */
/* Each agent's vocabulary                                                                    */
/* ------------------------------------------------------------------------------------------ */

/** Agents that read Claude Code's MCP config and take a list of tool names. */
const CLAUDE = new Set(["claude-code-action", "claude"]);

/**
 * What one agent needs to see these servers: files to write, flags for its command line, the
 * tool names to add to its allowlist, and environment for the steps after this one.
 *
 * Secrets go in the files and never in flags or environment: a flag is printed in the log of
 * the step that runs it, and a file in the runner's temp directory is not.
 */
export function wiringFor(agentId, servers, dir) {
  if (!servers.length) return { files: {}, flags: "", tools: [], env: {} };
  if (agentId === "codex") return codexWiring(servers, dir);
  if (agentId === "nanocoder") {
    const file = join(dir, "nanocoder-mcp.json");
    const mcpServers = {};
    for (const s of servers) {
      mcpServers[s.name] =
        s.transport === "http"
          ? { transport: "http", url: s.url, headers: s.headers ?? {} }
          : { transport: "stdio", command: s.command, args: s.args ?? [], env: s.env ?? {} };
    }
    return {
      files: { [file]: JSON.stringify({ mcpServers }, null, 2) },
      flags: "",
      tools: [],
      env: { NANOCODER_MCPSERVERS_FILE: file },
    };
  }
  // Claude, and any agent written out longhand: Claude's format is the one most MCP clients read.
  const file = join(dir, "mcp.json");
  const mcpServers = {};
  for (const s of servers) {
    mcpServers[s.name] =
      s.transport === "http"
        ? { type: "http", url: s.url, headers: s.headers ?? {} }
        : { type: "stdio", command: s.command, args: s.args ?? [], env: s.env ?? {} };
  }
  const tools = servers.flatMap((s) =>
    s.tools ? s.tools.map((t) => `mcp__${s.name}__${t}`) : [`mcp__${s.name}`],
  );
  return {
    files: { [file]: JSON.stringify({ mcpServers }, null, 2) },
    flags: CLAUDE.has(agentId) ? `--mcp-config ${file}` : "",
    tools: CLAUDE.has(agentId) ? tools : [],
    env: { ROSTER_MCP_CONFIG: file },
  };
}

function codexWiring(servers, dir) {
  /* Codex reads MCP servers from config.toml in CODEX_HOME, and does no `${VAR}` expansion, so
     the keys have to be in the file. A fresh CODEX_HOME in the runner's temp directory holds
     it: a runner has no Codex config of its own to lose, and CODEX_API_KEY still signs Codex
     in from the environment, so nothing else needs to live there. */
  const home = join(dir, "codex");
  const lines = [];
  for (const s of servers) {
    lines.push(`[mcp_servers.${tomlKey(s.name)}]`);
    if (s.transport === "http") {
      lines.push(`url = ${toml(s.url)}`);
      if (Object.keys(s.headers ?? {}).length) lines.push(`http_headers = ${toml(s.headers)}`);
    } else {
      lines.push(`command = ${toml(s.command)}`, `args = ${toml(s.args ?? [])}`);
      if (Object.keys(s.env ?? {}).length) lines.push(`env = ${toml(s.env)}`);
    }
    if (s.tools) lines.push(`enabled_tools = ${toml(s.tools)}`);
    lines.push("");
  }
  return {
    files: { [join(home, "config.toml")]: lines.join("\n") },
    flags: "",
    tools: [],
    env: { CODEX_HOME: home },
  };
}

function tomlKey(k) {
  return /^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k);
}

/** TOML for a string, a list or a flat table, which is all an MCP server entry holds. */
function toml(x) {
  if (Array.isArray(x)) return `[${x.map(toml).join(", ")}]`;
  if (x && typeof x === "object") {
    return `{ ${Object.entries(x)
      .map(([k, v]) => `${tomlKey(k)} = ${toml(v)}`)
      .join(", ")} }`;
  }
  return JSON.stringify(String(x));
}

/* ------------------------------------------------------------------------------------------ */
/* A run                                                                                      */
/* ------------------------------------------------------------------------------------------ */

/**
 * Everything one staff member's run needs, given the caller's secrets.
 *
 * `fetchToken` collects a signed-in connector's access token from the hosted portal; a run
 * passes one, a test passes a stub. Returns the wiring and, for the summary, what was connected
 * and what was left out and why.
 */
export async function prepare({ org, handle, permissions, agentId, secrets, dir, fetchToken }) {
  const takesTools = CLAUDE.has(agentId);
  const connected = [];
  const skipped = [];
  const servers = [];
  for (const c of connectorsOf(org, handle)) {
    if (c.problem) {
      skipped.push({ id: c.id, why: c.problem });
      continue;
    }
    const readOnly = permissions === "read-only" || c.readOnly;
    if (readOnly && !readOnlyMode(c, takesTools)) {
      skipped.push({ id: c.id, why: `${c.name} cannot be held to reading only on ${agentId}` });
      continue;
    }
    const values = {};
    let missing = null;
    if (c.auth === "oauth") {
      try {
        values.access_token = await fetchToken(c);
      } catch (err) {
        missing = `could not collect its sign-in from ${c.portal}: ${err.message}`;
      }
    } else {
      for (const s of c.secrets) {
        const v = secrets?.[s.name];
        if (!v) {
          missing = `no ${s.name} secret`;
          break;
        }
        values[s.field] = v;
      }
    }
    if (missing) {
      skipped.push({ id: c.id, why: missing });
      continue;
    }
    servers.push(serverFor(c, values, { readOnly }));
    connected.push({ id: c.id, name: c.name, readOnly });
  }
  return { connected, skipped, wiring: wiringFor(agentId, servers, dir) };
}

/**
 * A signed-in connector's access token, from the hosted portal that holds the sign-in.
 *
 * The run proves which repository it is with GitHub's own OIDC token, so no shared secret is
 * needed and the portal can check the repo is the brain of somebody the connector is given to.
 */
async function portalToken(c, env = process.env) {
  const ask = env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const bearer = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!ask || !bearer) throw new Error("this run has no id-token permission; run roster upgrade");
  const base = c.portal.replace(/\/+$/, "");
  const audience = new URL(base).origin;
  const idRes = await fetch(`${ask}&audience=${encodeURIComponent(audience)}`, {
    headers: { authorization: `Bearer ${bearer}` },
  });
  if (!idRes.ok) throw new Error(`GitHub gave no id token (${idRes.status})`);
  const { value } = await idRes.json();
  const res = await fetch(`${base}/connectors/token`, {
    method: "POST",
    headers: { authorization: `Bearer ${value}`, "content-type": "application/json" },
    body: JSON.stringify({ connector: c.id }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(body.error ?? `the portal answered ${res.status}`);
  return body.access_token;
}

/* ------------------------------------------------------------------------------------------ */
/* Writing org.yaml                                                                           */
/* ------------------------------------------------------------------------------------------ */

/**
 * org.yaml with its `connectors:` block replaced, everything else as it was.
 *
 * Written as text rather than re-serialised, because org.yaml is a file people edit and comment,
 * and a round trip through a parser would throw their comments away. `entries` maps an id to
 * what goes under it; an empty map removes the block.
 */
export function withConnectors(text, entries) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^connectors:\s*(#.*)?$/.test(l));
  let end = start;
  if (start !== -1) {
    end = start + 1;
    while (end < lines.length && (lines[end] === "" || /^\s/.test(lines[end]) || /^#/.test(lines[end]))) {
      if (/^#/.test(lines[end])) {
        // A comment at the margin belongs to whatever follows it, unless the block goes on after.
        let next = end + 1;
        while (next < lines.length && /^#/.test(lines[next])) next++;
        if (next >= lines.length || !/^\s/.test(lines[next])) break;
      }
      end++;
    }
    while (end > start + 1 && lines[end - 1] === "") end--;
  }
  const block = renderBlock(entries);
  if (start === -1) {
    if (!block.length) return text;
    const body = text.replace(/\n+$/, "");
    return `${body}\n\n${block.join("\n")}\n`;
  }
  const out = [...lines.slice(0, start), ...block, ...lines.slice(end)];
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

function renderBlock(entries) {
  const ids = Object.keys(entries ?? {});
  if (!ids.length) return [];
  const out = ["connectors:"];
  for (const id of ids) {
    out.push(`  ${id}:`);
    for (const [k, v] of Object.entries(entries[id] ?? {})) {
      if (v === undefined || v === null || v === "") continue;
      out.push(...renderValue(k, v, 4));
    }
  }
  return out;
}

function renderValue(key, v, indent) {
  const pad = " ".repeat(indent);
  if (Array.isArray(v)) return [`${pad}${key}: [${v.map(scalar).join(", ")}]`];
  if (v && typeof v === "object") {
    const keys = Object.keys(v);
    if (!keys.length) return [];
    return [`${pad}${key}:`, ...keys.flatMap((k) => renderValue(k, v[k], indent + 2))];
  }
  return [`${pad}${key}: ${scalar(v)}`];
}

function scalar(v) {
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  const s = String(v);
  return /^[A-Za-z0-9_./@:-]+$/.test(s) && !/^(true|false|null|~|-?\d+)$/.test(s) && !s.includes(": ")
    ? s
    : JSON.stringify(s);
}

/* ------------------------------------------------------------------------------------------ */
/* The runner                                                                                 */
/* ------------------------------------------------------------------------------------------ */

async function main(argv) {
  const at = (flag) => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const opsDir = at("--ops") ?? "roster-ops";
  const brainsDir = at("--brains") ?? ".";
  const handle = at("--staff");
  const dir = resolve(at("--out") ?? join(process.env.RUNNER_TEMP ?? ".", "roster-connectors"));

  const { parseYaml } = await import("./compose.mjs");
  const { resolveAgent, permissionOf } = await import("./agents.mjs");
  const org = parseYaml(readFileSync(join(opsDir, "org.yaml"), "utf8"), "org.yaml");
  const entry = (org.staff ?? []).find((s) => s.handle === handle);
  if (!entry) throw new Error(`no staff member "${handle}" in org.yaml`);
  let manifest = {};
  try {
    manifest = parseYaml(readFileSync(join(brainsDir, entry.dir ?? entry.handle, "staff.yaml"), "utf8"), "staff.yaml");
  } catch {
    /* As in agents.mjs: the org's defaults still resolve without one. */
  }
  const agent = resolveAgent(org, manifest);
  let secrets = {};
  try {
    secrets = JSON.parse(process.env.ROSTER_SECRETS || "{}");
  } catch {
    process.stderr.write("::warning::the caller's secrets did not arrive as JSON\n");
  }

  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const { connected, skipped, wiring } = await prepare({
    org,
    handle,
    permissions: permissionOf(org, manifest),
    agentId: agent.id,
    secrets,
    dir,
    fetchToken: (c) => portalToken(c),
  });
  for (const [path, text] of Object.entries(wiring.files)) writeFileSync(path, text, { mode: 0o600 });

  /* What the next steps read: a manifest of flags and tools for agents.mjs, and environment
     (paths only) for the agent itself. */
  const manifestFile = join(dir, "wiring.json");
  writeFileSync(manifestFile, JSON.stringify({ flags: wiring.flags, tools: wiring.tools }));
  if (process.env.GITHUB_ENV) {
    for (const [k, v] of Object.entries(wiring.env)) appendFileSync(process.env.GITHUB_ENV, `${k}=${v}\n`);
  }

  const lines = [
    ...connected.map((c) => `- ${c.name}${c.readOnly ? " (read only)" : ""}`),
    ...skipped.map((s) => `- ${s.id}: left out, ${s.why}`),
  ];
  if (lines.length && process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Connectors\n\n${lines.join("\n")}\n`);
  }
  for (const s of skipped) process.stderr.write(`::warning::connector ${s.id} left out: ${s.why}\n`);
  process.stdout.write(`file=${manifestFile}\nconnected=${connected.map((c) => c.id).join(",")}\n`);
}

const self = import.meta.url ? fileURLToPath(import.meta.url) : "";
if (process.argv[1] && self.endsWith("connectors.mjs") && resolve(process.argv[1]) === resolve(self)) {
  main(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`::warning::connectors: ${err.message}\n`);
    process.exit(1);
  });
}
