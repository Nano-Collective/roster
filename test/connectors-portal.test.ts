import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import sodium from "libsodium-wrappers";
import type { ApiResult, GitHub, RequestOpts } from "../src/lib/github.js";
import { accessToken, isSession, verifyActionsToken, writeGrant } from "../src/portal/grants.js";
import { type Actor, createPortal, handlePortal } from "../src/portal/handler.js";
import { memoryKV } from "../src/portal/kv.js";
import { serveRepos } from "./helpers/githubrepos.js";
import { makeTenant } from "./helpers/tenant.js";

/**
 * The portal's half of connectors: what it offers, that a key lands as a secret GitHub can
 * open and nowhere else, that org.yaml says who has it, and that only this org's own runs can
 * collect a signed-in connector's token.
 */

await sodium.ready;
const repoKeys = sodium.crypto_box_keypair();

/** The tenant's repos, plus GitHub's secrets API: public keys, and what was stored. */
function withSecrets(inner: GitHub) {
  const stored = new Map<string, string>();
  const deleted: string[] = [];
  const ok = <T>(data: unknown): ApiResult<T> => ({ ok: true, status: 200, data: data as T });
  const gh: GitHub = {
    graphql: inner.graphql.bind(inner),
    async request<T>(method: string, path: string, opts: RequestOpts = {}) {
      const p = path.split("?")[0]!;
      if (method === "GET" && /^orgs\/acme$/.test(p)) return ok<T>({ plan: { name: "free" } });
      if (method === "GET" && p.endsWith("/actions/secrets/public-key")) {
        return ok<T>({
          key: sodium.to_base64(repoKeys.publicKey, sodium.base64_variants.ORIGINAL),
          key_id: "k1",
        });
      }
      if (method === "PUT" && /\/actions\/secrets\/[A-Z0-9_]+$/.test(p)) {
        const sealed = sodium.from_base64(
          (opts.body as any).encrypted_value,
          sodium.base64_variants.ORIGINAL,
        );
        stored.set(
          p,
          sodium.to_string(
            sodium.crypto_box_seal_open(sealed, repoKeys.publicKey, repoKeys.privateKey),
          ),
        );
        return ok<T>({});
      }
      if (method === "DELETE" && /\/actions\/secrets\//.test(p)) {
        deleted.push(p);
        return ok<T>({});
      }
      if (method === "GET" && /^repos\/acme\/[^/]+\/actions\/(organization-)?secrets$/.test(p)) {
        const repo = p.split("/")[2];
        const names = [...stored.keys()]
          .filter((k) => k.startsWith(`repos/acme/${repo}/`))
          .map((k) => ({ name: k.split("/").pop() }));
        return ok<T>({ secrets: p.includes("organization") ? [] : names });
      }
      return inner.request<T>(method, path, opts);
    },
  };
  return { gh, stored, deleted };
}

let n = 0;
async function setup() {
  const root = mkdtempSync(join(tmpdir(), "roster-conn-"));
  await makeTenant(root, {
    org: "acme",
    staff: [
      { handle: "cto", name: "Chief Technology Officer" },
      { handle: "cmo", name: "Chief Marketing Officer" },
    ],
  });
  const fake = serveRepos("acme", root, ["roster-ops", "cto", "cmo"]);
  const { gh, stored, deleted } = withSecrets(fake);
  const portal = createPortal({
    org: "acme",
    opsName: "roster-ops",
    kv: memoryKV(),
    root: `/@roster-conn/${++n}`,
  });
  const actor = (canWrite: boolean): Actor => ({ gh, id: "will", canWrite });
  const get = (path: string) =>
    handlePortal(new Request(`http://portal${path}`), portal, actor(false));
  const post = (path: string, body: unknown, canWrite = true) =>
    handlePortal(
      new Request(`http://portal${path}`, { method: "POST", body: JSON.stringify(body) }),
      portal,
      actor(canWrite),
    );
  return { root, fake, stored, deleted, get, post };
}

test("the screen offers the catalogue, and says nothing is connected yet", async () => {
  const { get } = await setup();
  const d = (await (await get("/api/connectors"))!.json()) as any;
  assert.ok(d.catalogue.some((e: any) => e.id === "sentry" && e.fields[0].secret));
  assert.deepEqual(d.connectors, []);
  assert.equal(d.signIn, false, "no sign-ins on a portal without a store for them");
  assert.deepEqual(
    d.staff.map((s: any) => s.handle),
    ["cto", "cmo"],
  );
});

test("saving stores the key where GitHub can open it, and org.yaml says who has it", async () => {
  const { root, fake, stored, post, get } = await setup();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("{}", { status: 200 })) as typeof fetch;
  try {
    const res = await post("/api/connectors/save", {
      id: "supabase",
      staff: ["cto", "nobody"],
      readOnly: true,
      settings: { project_ref: "abc123" },
      values: { token: "sbp_secret" },
    });
    const body = (await res!.json()) as any;
    assert.equal(res?.status, 200, JSON.stringify(body));
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(stored.get("repos/acme/cto/actions/secrets/CONNECTOR_SUPABASE_TOKEN"), "sbp_secret");
  assert.equal(stored.get("repos/acme/cmo/actions/secrets/CONNECTOR_SUPABASE_TOKEN"), "sbp_secret");
  const org = readFileSync(join(root, "roster-ops", "org.yaml"), "utf8");
  assert.match(
    org,
    /connectors:\n {2}supabase:\n {4}staff: \[cto\]\n {4}read_only: true\n {4}project_ref: abc123/,
  );
  assert.ok(!org.includes("sbp_secret"), "a key never goes in org.yaml");
  assert.equal(fake.writes.at(-1)!.message, "portal: connect Supabase");

  const d = (await (await get("/api/connectors"))!.json()) as any;
  assert.equal(d.connectors[0].keys, "stored");
  assert.ok(!JSON.stringify(d).includes("sbp_secret"));
});

test("a key the service rejects is stored nowhere", async () => {
  const { stored, fake, post } = await setup();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("{}", { status: 401 })) as typeof fetch;
  try {
    const res = await post("/api/connectors/save", {
      id: "sentry",
      staff: ["cto"],
      values: { token: "bad" },
    });
    assert.equal(res?.status, 400);
    assert.match(((await res!.json()) as any).error, /rejected/);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(stored.size, 0);
  assert.equal(fake.writes.length, 0);
});

test("a key that is plainly the wrong kind is refused before anything is asked", async () => {
  const { post } = await setup();
  const res = await post("/api/connectors/check", {
    id: "stripe",
    values: { token: "sk_live_abc" },
  });
  const r = (await res!.json()) as any;
  assert.equal(r.state, "rejected");
  assert.match(r.note, /does not look like a Stripe restricted key/);
});

test("writing needs the portal's own POST", async () => {
  const { post, stored } = await setup();
  for (const route of [
    "/api/connectors/save",
    "/api/connectors/remove",
    "/api/connectors/check",
    "/api/connectors/signin",
  ]) {
    assert.equal((await post(route, { id: "sentry", staff: ["cto"] }, false))?.status, 403, route);
  }
  assert.equal(stored.size, 0);
});

test("removing takes away the keys and the entry", async () => {
  const { root, deleted, post } = await setup();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("{}", { status: 200 })) as typeof fetch;
  try {
    await post("/api/connectors/save", {
      id: "linear",
      staff: ["cmo"],
      values: { token: "lin_api_x" },
    });
  } finally {
    globalThis.fetch = realFetch;
  }
  const res = await post("/api/connectors/remove", { id: "linear" });
  assert.equal(res?.status, 200);
  assert.ok(deleted.some((p) => p.endsWith("CONNECTOR_LINEAR_TOKEN")));
  assert.ok(!readFileSync(join(root, "roster-ops", "org.yaml"), "utf8").includes("connectors:"));
});

test("a custom server is added by its URL, its key stored and sent as the header it names", async () => {
  const { root, stored, post, get } = await setup();
  const res = await post("/api/connectors/save", {
    id: "acme-api",
    staff: ["cto"],
    custom: { url: "https://mcp.acme.dev/mcp", header: "X-Api-Key" },
    values: { token: "k_live" },
  });
  assert.equal(res?.status, 200, JSON.stringify(await res!.clone().json()));
  assert.equal(stored.get("repos/acme/cto/actions/secrets/CONNECTOR_ACME_API_TOKEN"), "k_live");
  const org = readFileSync(join(root, "roster-ops", "org.yaml"), "utf8");
  assert.match(
    org,
    /acme-api:\n {4}staff: \[cto\]\n {4}url: https:\/\/mcp\.acme\.dev\/mcp\n {4}secrets: \[TOKEN\]\n {4}headers:\n {6}X-Api-Key: "\$\{TOKEN\}"/,
  );
  assert.ok(!org.includes("k_live"));

  const d = (await (await get("/api/connectors"))!.json()) as any;
  const c = d.connectors.find((x: any) => x.id === "acme-api");
  assert.equal(c.url, "https://mcp.acme.dev/mcp");
  assert.equal(c.keys, "stored");

  // Edited from the screen: who has it changes, the server stays as written.
  const edit = await post("/api/connectors/save", { id: "acme-api", staff: ["cto", "cmo"] });
  assert.equal(edit?.status, 200);
  assert.match(
    readFileSync(join(root, "roster-ops", "org.yaml"), "utf8"),
    /acme-api:\n {4}staff: \[cto, cmo\]\n {4}url: https:\/\/mcp\.acme\.dev\/mcp/,
  );
});

test("a custom server needs a usable name, an https URL, and not to be in the catalogue", async () => {
  const { post } = await setup();
  const refused = async (body: unknown, why: RegExp) => {
    const res = await post("/api/connectors/save", body);
    assert.equal(res?.status, 400);
    assert.match(((await res!.json()) as any).error, why);
  };
  const base = { staff: ["cto"], values: {} };
  await refused({ ...base, id: "Acme API", custom: { url: "https://x.dev/mcp" } }, /usable name/);
  await refused({ ...base, id: "acme", custom: { url: "http://x.dev/mcp" } }, /https/);
  await refused({ ...base, id: "acme", custom: { url: "" } }, /needs a url/);
  await refused({ ...base, id: "sentry", custom: { url: "https://x.dev/mcp" } }, /in the list/);
});

test("signing in is refused where there is nowhere to keep a sign-in", async () => {
  const { post } = await setup();
  const res = await post("/api/connectors/signin", { id: "notion", staff: ["cto"] });
  assert.equal(res?.status, 400);
  assert.match(((await res!.json()) as any).error, /hosted portal/);
});

test("a custom server signs in through the hosted portal, and org.yaml names it", async () => {
  const root = mkdtempSync(join(tmpdir(), "roster-conn-"));
  await makeTenant(root, { org: "acme", staff: [{ handle: "cto", name: "CTO" }] });
  const fake = serveRepos("acme", root, ["roster-ops", "cto"]);
  const store = memoryKV();
  const portal = createPortal({
    org: "acme",
    opsName: "roster-ops",
    kv: memoryKV(),
    root: `/@roster-conn/${++n}`,
    grants: {
      store,
      secret: Buffer.alloc(32, 7).toString("base64"),
      base: "https://roster.acme.com",
    },
  });
  const actor: Actor = { gh: fake, id: "will", canWrite: true };
  const realFetch = globalThis.fetch;
  const asked: string[] = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    asked.push(String(url));
    const u = String(url);
    if (u.endsWith("/.well-known/oauth-protected-resource/mcp"))
      return Response.json({ authorization_servers: ["https://auth.acme.dev"] });
    if (u === "https://auth.acme.dev/.well-known/oauth-authorization-server")
      return Response.json({
        issuer: "https://auth.acme.dev",
        authorization_endpoint: "https://auth.acme.dev/authorize",
        token_endpoint: "https://auth.acme.dev/token",
        registration_endpoint: "https://auth.acme.dev/register",
      });
    if (u === "https://auth.acme.dev/register") return Response.json({ client_id: "c1" });
    if (u === "https://auth.acme.dev/token") {
      assert.match(String(init?.body), /resource=https%3A%2F%2Fmcp\.acme\.dev%2Fmcp/);
      return Response.json({ access_token: "at", refresh_token: "rt", expires_in: 3600 });
    }
    return new Response("no", { status: 404 });
  }) as typeof fetch;
  try {
    const start = await handlePortal(
      new Request("http://portal/api/connectors/signin", {
        method: "POST",
        body: JSON.stringify({
          id: "acme",
          staff: ["cto"],
          custom: { url: "https://mcp.acme.dev/mcp" },
        }),
      }),
      portal,
      actor,
    );
    const started = (await start!.json()) as { url: string; error?: string };
    assert.equal(start!.status, 200, started.error);
    const { url } = started;
    const go = new URL(url);
    assert.equal(go.origin + go.pathname, "https://auth.acme.dev/authorize");
    assert.equal(go.searchParams.get("resource"), "https://mcp.acme.dev/mcp");
    const sealed = /roster_connector=([^;]+)/.exec(start!.headers.get("set-cookie") ?? "")![1];

    const back = await handlePortal(
      new Request(
        `http://portal/connectors/callback?code=x&state=${go.searchParams.get("state")}`,
        { headers: { cookie: `roster_connector=${sealed}` } },
      ),
      portal,
      actor,
    );
    assert.equal(back!.headers.get("location"), "/#/-/connectors");
  } finally {
    globalThis.fetch = realFetch;
  }
  const org = readFileSync(join(root, "roster-ops", "org.yaml"), "utf8");
  assert.match(
    org,
    /acme:\n {4}staff: \[cto\]\n {4}url: https:\/\/mcp\.acme\.dev\/mcp\n {4}auth: oauth\n {4}portal: https:\/\/roster\.acme\.com/,
  );
  assert.equal(fake.writes.at(-1)!.message, "portal: connect acme");
});

/* ------------------------------- a run's token ------------------------------- */

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: "jwk" }) as object), kid: "k1", alg: "RS256" };
const jwksFetch = (async () =>
  new Response(JSON.stringify({ keys: [jwk] }))) as unknown as typeof fetch;

function idToken(claims: Record<string, unknown>) {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = b64({ alg: "RS256", kid: "k1", typ: "JWT" });
  const body = b64({
    iss: "https://token.actions.githubusercontent.com",
    aud: "https://roster.acme.com",
    exp: Math.floor(Date.now() / 1000) + 300,
    repository_owner: "acme",
    job_workflow_ref: "acme/roster-ops/.github/workflows/session.yaml@refs/heads/main",
    ...claims,
  });
  const sig = sign("RSA-SHA256", Buffer.from(`${head}.${body}`), privateKey).toString("base64url");
  return `${head}.${body}.${sig}`;
}

test("a run of this org's session workflow is let in", async () => {
  const claims = await verifyActionsToken(idToken({}), "https://roster.acme.com", jwksFetch);
  assert.ok(claims);
  assert.equal(isSession(claims!, "acme", "roster-ops"), true);
});

test("anything else is turned away", async () => {
  const aud = "https://roster.acme.com";
  assert.equal(
    await verifyActionsToken(idToken({ aud: "https://elsewhere" }), aud, jwksFetch),
    null,
    "another audience",
  );
  assert.equal(await verifyActionsToken(idToken({ exp: 1 }), aud, jwksFetch), null, "expired");
  const forged = idToken({}).replace(/\.[^.]+$/, ".AAAA");
  assert.equal(await verifyActionsToken(forged, aud, jwksFetch), null, "bad signature");
  const other = await verifyActionsToken(idToken({ repository_owner: "evil" }), aud, jwksFetch);
  assert.equal(isSession(other!, "acme", "roster-ops"), false, "another org");
  const wf = await verifyActionsToken(
    idToken({ job_workflow_ref: "acme/cto/.github/workflows/anything.yaml@refs/heads/main" }),
    aud,
    jwksFetch,
  );
  assert.equal(isSession(wf!, "acme", "roster-ops"), false, "another workflow in the org");
});

const SECRET = Buffer.alloc(32, 7).toString("base64");

test("a held token is handed out while it lasts, and refreshed when it does not", async () => {
  const store = memoryKV();
  const base = {
    connector: "notion",
    resource: "https://mcp.notion.com/mcp",
    tokenEndpoint: "https://mcp.notion.com/token",
    clientId: "c1",
    refreshToken: "r1",
    by: "will",
    at: "2026-10-14T00:00:00Z",
  };
  await writeGrant(store, SECRET, {
    ...base,
    accessToken: "a1",
    expiresAt: Date.now() + 3_600_000,
  });
  assert.equal(await accessToken(store, SECRET, "notion", jwksFetch), "a1");

  await writeGrant(store, SECRET, { ...base, accessToken: "a1", expiresAt: Date.now() + 60_000 });
  const seen: string[] = [];
  const refresh = (async (_url: string, init: RequestInit) => {
    seen.push(String(init.body));
    return new Response(
      JSON.stringify({ access_token: "a2", refresh_token: "r2", expires_in: 3600 }),
    );
  }) as unknown as typeof fetch;
  assert.equal(await accessToken(store, SECRET, "notion", refresh), "a2");
  assert.match(seen[0]!, /grant_type=refresh_token&refresh_token=r1/);
  assert.equal(await accessToken(store, SECRET, "notion", refresh), "a2", "the new one is kept");
});
