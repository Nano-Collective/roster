import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

/**
 * A connector is three promises: the key reaches the run and nothing else, each agent hears the
 * server in its own words, and somebody who may only read is never handed a server that writes.
 */

const ops = join(import.meta.dirname, "..", "templates", "ops");
const c = (await import(`file://${join(ops, "connectors.mjs")}`)) as any;
const agents = (await import(`file://${join(ops, "agents.mjs")}`)) as any;
const { parseYaml } = (await import(`file://${join(ops, "compose.mjs")}`)) as any;

const ORG = {
  org: "acme",
  connectors: {
    sentry: { staff: ["cto"] },
    supabase: { staff: ["cto"], project_ref: "abc123" },
    linear: { staff: ["cto", "cmo"] },
    mine: {
      staff: ["cto"],
      url: "https://mcp.example.com/mcp",
      secrets: ["API_KEY"],
      // biome-ignore lint/suspicious/noTemplateCurlyInString: org.yaml spells a secret this way
      headers: { "X-Key": "${API_KEY}" },
    },
  },
};

const SECRETS = {
  CONNECTOR_SENTRY_TOKEN: "sntryu_x",
  CONNECTOR_SUPABASE_TOKEN: "sbp_y",
  CONNECTOR_MINE_API_KEY: "k-123",
  CTO_APP_PRIVATE_KEY: "-----BEGIN-----",
};

const run = (over: Record<string, unknown> = {}) =>
  c.prepare({
    org: ORG,
    handle: "cto",
    permissions: "full",
    agentId: "claude-code-action",
    secrets: SECRETS,
    dir: "/tmp/rc",
    fetchToken: async () => "oauth-access",
    ...over,
  });

test("every catalogue entry can be filled in and checked without a sign-in, or says it needs one", () => {
  for (const [id, e] of Object.entries(c.CATALOGUE) as Array<[string, any]>) {
    assert.ok(e.name && e.summary, `${id} has no name or summary`);
    assert.ok(e.steps?.length, `${id} does not say how to get a key`);
    if (e.auth === "oauth") {
      assert.ok(e.oauth?.resource, `${id} signs in but names no server to sign in to`);
      continue;
    }
    const secret = e.fields.filter((f: any) => f.secret);
    assert.ok(secret.length, `${id} takes no key`);
    const values = Object.fromEntries(e.fields.map((f: any) => [f.id, "v"]));
    const s = e.server(values, { readOnly: false });
    assert.ok(
      s.transport === "http" ? /^https:\/\//.test(s.url) : s.command,
      `${id} has no server`,
    );
    for (const f of secret) {
      if (f.pattern) assert.doesNotThrow(() => new RegExp(f.pattern), `${id}.${f.id}`);
    }
  }
});

test("a secret's name is the connector and the field, as GitHub allows", () => {
  assert.equal(c.secretName("sentry", "token"), "CONNECTOR_SENTRY_TOKEN");
  assert.equal(c.secretName("notion-key", "token"), "CONNECTOR_NOTION_KEY_TOKEN");
});

test("a staff member gets only the connectors org.yaml gives them", () => {
  assert.deepEqual(
    c.connectorsOf(ORG, "cmo").map((x: any) => x.id),
    ["linear"],
  );
  assert.deepEqual(
    c.connectorsOf(ORG, "cto").map((x: any) => x.id),
    ["sentry", "supabase", "linear", "mine"],
  );
});

test("a connector with no key is left out by name, and the run goes on", async () => {
  const r = await run();
  assert.deepEqual(
    r.connected.map((x: any) => x.id),
    ["sentry", "supabase", "mine"],
  );
  assert.deepEqual(r.skipped, [{ id: "linear", why: "no CONNECTOR_LINEAR_TOKEN secret" }]);
});

test("Claude gets a config file holding the keys, and the servers' tools on its allowlist", async () => {
  const r = await run();
  const [file, text] = Object.entries(r.wiring.files)[0] as [string, string];
  const config = JSON.parse(text);
  assert.equal(config.mcpServers.sentry.headers.Authorization, "Sentry-Bearer sntryu_x");
  assert.equal(config.mcpServers.supabase.url, "https://mcp.supabase.com/mcp?project_ref=abc123");
  assert.equal(config.mcpServers.mine.headers["X-Key"], "k-123");
  assert.equal(r.wiring.flags, `--mcp-config ${file}`);
  assert.deepEqual(r.wiring.tools, ["mcp__sentry", "mcp__supabase", "mcp__mine"]);
  assert.ok(!r.wiring.flags.includes("sntryu_x"), "a flag is printed in the log; a key never is");
  assert.ok(!text.includes("BEGIN"), "secrets nobody connected never reach the file");
});

test("agents.mjs adds the connectors' tools to the allowlist at every level", () => {
  const wiring = { flags: "--mcp-config /tmp/rc/mcp.json", tools: ["mcp__sentry"] };
  const full = agents.resolveAgent({}, {}, wiring).flags;
  assert.match(
    full,
    /--allowedTools "Bash,Read,Write,Edit,Glob,Grep,WebFetch,WebSearch,mcp__sentry"/,
  );
  assert.match(full, /--mcp-config \/tmp\/rc\/mcp\.json/);
  const listed = agents.resolveAgent({ defaults: { allowed_tools: ["Read", "Bash"] } }, {}, wiring);
  assert.match(listed.flags, /--allowedTools "Read,Bash,mcp__sentry"/);
  assert.equal(
    agents.resolveAgent({}, {}).flags,
    '--allowedTools "Bash,Read,Write,Edit,Glob,Grep,WebFetch,WebSearch"',
    "an org with no connectors gets exactly what it had",
  );
});

test("read only: a server that can be told is told, and one that cannot is left out", async () => {
  const r = await run({ permissions: "read-only" });
  const config = JSON.parse(Object.values(r.wiring.files)[0] as string);
  assert.match(config.mcpServers.supabase.url, /read_only=true/);
  assert.ok(!config.mcpServers.sentry, "Sentry cannot be held to reading, so it is not given");
  assert.ok(r.skipped.some((s: any) => s.id === "sentry" && /reading only/.test(s.why)));
  assert.ok(r.connected.every((x: any) => x.readOnly));
});

test("one connector can be marked read only for everybody", async () => {
  const org = { connectors: { supabase: { staff: ["cto"], read_only: true } } };
  const r = await run({ org });
  assert.match(
    JSON.parse(Object.values(r.wiring.files)[0] as string).mcpServers.supabase.url,
    /read_only=true/,
  );
});

test("Codex gets its own config.toml in a fresh CODEX_HOME, and no key on its command line", async () => {
  const r = await run({ agentId: "codex" });
  const [file, text] = Object.entries(r.wiring.files)[0] as [string, string];
  assert.equal(file, "/tmp/rc/codex/config.toml");
  assert.equal(r.wiring.env.CODEX_HOME, "/tmp/rc/codex");
  assert.match(text, /^\[mcp_servers\.sentry\]$/m);
  assert.match(text, /^url = "https:\/\/mcp\.sentry\.dev\/mcp"$/m);
  assert.match(text, /^http_headers = \{ Authorization = "Sentry-Bearer sntryu_x" \}$/m);
  assert.equal(r.wiring.flags, "");
});

test("nanocoder gets its own format, by the variable it reads", async () => {
  const r = await run({ agentId: "nanocoder" });
  const [file, text] = Object.entries(r.wiring.files)[0] as [string, string];
  assert.equal(r.wiring.env.NANOCODER_MCPSERVERS_FILE, file);
  assert.equal(JSON.parse(text).mcpServers.sentry.transport, "http");
});

test("a stdio server gets its key in its environment", async () => {
  const org = { connectors: { postgres: { staff: ["cto"] } } };
  const r = await run({ org, secrets: { CONNECTOR_POSTGRES_TOKEN: "postgresql://u:p@h/db" } });
  const s = JSON.parse(Object.values(r.wiring.files)[0] as string).mcpServers.postgres;
  assert.equal(s.type, "stdio");
  assert.equal(s.env.DATABASE_URI, "postgresql://u:p@h/db");
  assert.ok(!s.args.join(" ").includes("u:p"), "never on argv, where ps can read it");
});

test("a signed-in connector collects its token from the portal, and is left out if it cannot", async () => {
  const org = { connectors: { notion: { staff: ["cto"], portal: "https://roster.acme.com" } } };
  const ok = await run({ org });
  const s = JSON.parse(Object.values(ok.wiring.files)[0] as string).mcpServers.notion;
  assert.equal(s.headers.Authorization, "Bearer oauth-access");
  const down = await run({
    org,
    fetchToken: async () => {
      throw new Error("the portal answered 503");
    },
  });
  assert.equal(down.connected.length, 0);
  assert.match(down.skipped[0].why, /503/);
});

test("a signed-in connector without a portal says so rather than failing a run", () => {
  const [n] = c.declared({ connectors: { notion: { staff: ["cto"] } } });
  assert.match(n.problem, /portal/);
});

test("a name that cannot be a tool name is refused, not mangled", () => {
  const [x] = c.declared({ connectors: { "My Thing": { url: "https://x" } } });
  assert.match(x.problem, /not a usable name/);
});

/* ------------------------------- org.yaml ------------------------------- */

const ORG_TEXT = `# Acme's org
org: acme
name: Acme

staff:
  - { handle: cto, dir: technology }

# keep me
repos:
  - { name: roster-ops, role: ops }
`;

test("connectors are added to org.yaml without touching anything else", () => {
  const out = c.withConnectors(ORG_TEXT, {
    sentry: { staff: ["cto"] },
    supabase: { staff: ["cto", "cmo"], project_ref: "abc123", read_only: true },
  });
  assert.ok(out.startsWith(ORG_TEXT.trimEnd()), "everything before is as it was");
  const parsed = parseYaml(out);
  assert.deepEqual(parsed.connectors.supabase, {
    staff: ["cto", "cmo"],
    project_ref: "abc123",
    read_only: true,
  });
  assert.deepEqual(parsed.repos, [{ name: "roster-ops", role: "ops" }]);
});

test("the block is replaced in place, and comments around it survive", () => {
  const once = c.withConnectors(ORG_TEXT, { sentry: { staff: ["cto"] } });
  const moved = once
    .replace("connectors:", "connectors:  # services")
    .concat("\n# trailing\nhuman:\n  github: will\n");
  const twice = c.withConnectors(moved, { linear: { staff: ["cmo"] } });
  const parsed = parseYaml(twice);
  assert.deepEqual(Object.keys(parsed.connectors), ["linear"]);
  assert.match(twice, /# keep me/);
  assert.match(twice, /# trailing\nhuman:\n {2}github: will/);
  assert.deepEqual(parsed.human, { github: "will" });
});

test("removing the last connector removes the block", () => {
  const once = c.withConnectors(ORG_TEXT, { sentry: { staff: ["cto"] } });
  const gone = c.withConnectors(once, {});
  assert.ok(!/connectors:/.test(gone));
  assert.deepEqual(parseYaml(gone).repos, parseYaml(ORG_TEXT).repos);
});

test("a value that YAML would read as something else is quoted", () => {
  const out = c.withConnectors("org: acme\n", {
    x: { staff: ["cto"], url: "https://a.b/c?d=1&e=two words" },
  });
  assert.equal(parseYaml(out).connectors.x.url, "https://a.b/c?d=1&e=two words");
});

/* ------------------------------- deploy ------------------------------- */

test("a new KV namespace's id is read off wrangler's output, in JSON or TOML", async () => {
  const { namespaceId } = await import("../src/commands/deploy.js");
  const id = "0123456789abcdef0123456789abcdef";
  assert.equal(
    namespaceId(
      `{\n  "kv_namespaces": [\n    {\n      "binding": "x",\n      "id": "${id}"\n    }\n  ]\n}`,
    ),
    id,
  );
  assert.equal(namespaceId(`[[kv_namespaces]]\nbinding = "x"\nid = "${id}"`), id);
  assert.equal(
    namespaceId("✘ [ERROR] A namespace with this account ID and title already exists"),
    null,
  );
});

test("an existing namespace is found by its title, so a daily deploy never makes a second", async () => {
  const { existingNamespace } = await import("../src/commands/deploy.js");
  const list = `[\n  { "id": "aaa", "title": "other" },\n  { "id": "bbb", "title": "pip-roster-portal-connectors" }\n]`;
  assert.equal(existingNamespace(list, "pip-roster-portal-connectors"), "bbb");
  assert.equal(existingNamespace(list, "missing"), null);
  assert.equal(existingNamespace("not json", "x"), null);
});
