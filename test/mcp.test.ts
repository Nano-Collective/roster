import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { type Actor, createPortal } from "../src/portal/handler.js";
import { memoryKV } from "../src/portal/kv.js";
import { briefText, handleMcp, TOOLS } from "../src/portal/mcp.js";
import { bearerOf, handleOAuth, redirectAllowed, s256 } from "../src/portal/oauth.js";
import { type AuthConfig, open } from "../src/portal/session.js";
import { serveRepos } from "./helpers/githubrepos.js";
import { makeTenant } from "./helpers/tenant.js";

/**
 * Talking to the staff from Claude: a connector signs in through the portal's own OAuth, in
 * front of GitHub, and then reaches the same routes Home uses with the person's own token.
 */

const ORIGIN = "https://roster.example";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const auth: AuthConfig = {
  clientId: "gh-client",
  clientSecret: "gh-secret",
  sessionKey: Buffer.alloc(32, 7).toString("base64"),
  allowed: async (login) => login === "ada",
};

const oauth = (path: string, init: RequestInit = {}) => {
  const req = new Request(`${ORIGIN}${path}`, init);
  return handleOAuth(req, new URL(req.url), auth, "Acme");
};

/** Every Set-Cookie on a response, as one Cookie header to send back. */
function cookies(res: Response, prior = ""): string {
  const jar = new Map(
    prior
      .split("; ")
      .filter(Boolean)
      .map((c) => c.split("=") as [string, string]),
  );
  for (const c of res.headers.getSetCookie()) {
    const [pair = ""] = c.split(";");
    const [k = "", ...v] = pair.split("=");
    jar.set(k, v.join("="));
  }
  return [...jar]
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

/** GitHub's half, as the callback asks it: the code for a token, then who the token is. */
function stubGitHub(login: string) {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/login/oauth/access_token"))
      return Response.json({ access_token: "gho_ada" });
    if (url.endsWith("/user")) return Response.json({ login });
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = real;
  };
}

/** A connector from discovery to a token, the way claude.ai goes about it. */
async function connect(login = "ada", allow = true) {
  const reg = await oauth("/oauth/register", {
    method: "POST",
    body: JSON.stringify({ client_name: "Claude", redirect_uris: [REDIRECT] }),
  });
  assert.equal(reg?.status, 201);
  const { client_id } = (await reg!.json()) as { client_id: string };

  const verifier = "a-verifier-of-at-least-forty-three-characters-long-xyz";
  const q = new URLSearchParams({
    response_type: "code",
    client_id,
    redirect_uri: REDIRECT,
    code_challenge: await s256(verifier),
    code_challenge_method: "S256",
    state: "st8",
  });
  const toGitHub = await oauth(`/oauth/authorize?${q}`);
  assert.equal(toGitHub?.status, 302);
  const gh = new URL(toGitHub!.headers.get("location")!);
  assert.equal(gh.host, "github.com");
  assert.equal(gh.searchParams.get("redirect_uri"), `${ORIGIN}/auth/callback/mcp`);
  let jar = cookies(toGitHub!);

  const restore = stubGitHub(login);
  let consent: Response | undefined;
  try {
    consent = await oauth(`/auth/callback/mcp?code=c&state=${gh.searchParams.get("state")}`, {
      headers: { cookie: jar },
    });
  } finally {
    restore();
  }
  if (consent?.status !== 200) return { consent, client_id, verifier };
  jar = cookies(consent, jar);

  const back = await oauth("/oauth/approve", {
    method: "POST",
    headers: { cookie: jar, origin: ORIGIN },
    body: new URLSearchParams({ allow: allow ? "1" : "0" }),
  });
  assert.equal(back?.status, 302);
  return { consent, back: new URL(back!.headers.get("location")!), client_id, verifier };
}

test("a connector finds where to sign in from the endpoint itself", async () => {
  const resource = (await (await oauth("/.well-known/oauth-protected-resource"))!.json()) as any;
  assert.equal(resource.resource, `${ORIGIN}/mcp`);
  assert.deepEqual(resource.authorization_servers, [ORIGIN]);
  const server = (await (await oauth("/.well-known/oauth-authorization-server"))!.json()) as any;
  assert.deepEqual(server.code_challenge_methods_supported, ["S256"]);
  assert.equal(server.registration_endpoint, `${ORIGIN}/oauth/register`);
});

test("signed in with GitHub and allowed, the connector gets a token that opens /mcp and nothing else", async () => {
  const { consent, back, client_id, verifier } = await connect();
  assert.match(await consent!.clone().text(), /Claude<\/b> will act as <b>ada/);
  assert.equal(back?.searchParams.get("state"), "st8");
  const code = back!.searchParams.get("code")!;

  const swap = (over: Record<string, string> = {}) =>
    oauth("/oauth/token", {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id,
        redirect_uri: REDIRECT,
        code_verifier: verifier,
        ...over,
      }),
    });
  assert.equal((await swap({ code_verifier: "wrong" }))?.status, 400, "PKCE is checked");
  assert.equal((await swap({ redirect_uri: "https://evil.example/cb" }))?.status, 400);

  const tokens = (await (await swap())!.json()) as any;
  assert.equal(tokens.token_type, "Bearer");
  const bearer = (t: string) =>
    new Request(`${ORIGIN}/mcp`, { headers: { authorization: `Bearer ${t}` } });
  assert.deepEqual(await bearerOf(bearer(tokens.access_token), auth.sessionKey), {
    token: "gho_ada",
    login: "ada",
  });
  assert.equal(
    await bearerOf(bearer(tokens.refresh_token), auth.sessionKey),
    null,
    "a refresh token is not a bearer",
  );
  assert.equal(await bearerOf(bearer(code), auth.sessionKey), null, "nor is a code");
  assert.equal(
    await open(tokens.access_token, auth.sessionKey),
    null,
    "nor is any of them a portal cookie",
  );

  const refreshed = await oauth("/oauth/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id,
    }),
  });
  assert.equal(refreshed?.status, 200);
  assert.ok(((await refreshed!.json()) as any).access_token);
});

test("Cancel sends the connector away with nothing", async () => {
  const { back } = await connect("ada", false);
  assert.equal(back?.searchParams.get("error"), "access_denied");
  assert.equal(back?.searchParams.get("code"), null);
});

test("somebody who is not one of the org's humans never reaches the yes page", async () => {
  const { consent } = await connect("mallory");
  assert.equal(consent?.status, 403);
});

test("only a redirect the client registered, and only https or this machine, is ever used", async () => {
  assert.ok(redirectAllowed(REDIRECT));
  assert.ok(redirectAllowed("http://localhost:6274/oauth/callback"));
  assert.ok(!redirectAllowed("http://claude.ai/cb"));
  assert.ok(!redirectAllowed("javascript:alert(1)"));

  const reg = await oauth("/oauth/register", {
    method: "POST",
    body: JSON.stringify({ redirect_uris: [REDIRECT] }),
  });
  const { client_id } = (await reg!.json()) as any;
  const q = new URLSearchParams({
    response_type: "code",
    client_id,
    redirect_uri: "https://evil.example/cb",
    code_challenge: "x",
    code_challenge_method: "S256",
  });
  const res = await oauth(`/oauth/authorize?${q}`);
  assert.equal(res?.status, 400, "an error page, never a redirect somewhere unregistered");
});

/* ------------------------------------------------------------------ the server itself */

async function setup() {
  const root = mkdtempSync(join(tmpdir(), "roster-mcp-"));
  await makeTenant(root, {
    org: "acme",
    staff: [{ handle: "cto", name: "Chief Technology Officer" }],
  });
  const gh = serveRepos("acme", root, ["roster-ops", "cto"]);
  const portal = createPortal({
    org: "acme",
    opsName: "roster-ops",
    kv: memoryKV(),
    root: "/@roster-mcp",
  });
  const actor: Actor = { gh, id: "ada", canWrite: true };
  const call = async (method: string, params?: unknown, id: number | null = 1) => {
    const res = await handleMcp(
      new Request(`${ORIGIN}/mcp`, {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          ...(id === null ? {} : { id }),
          method,
          params,
        }),
      }),
      portal,
      actor,
      "Acme",
    );
    return res.status === 202 ? null : ((await res.json()) as any);
  };
  return { call };
}

test("it says what it is and lists its tools, and a notification gets no answer", async () => {
  const { call } = await setup();
  const init = await call("initialize", { protocolVersion: "2025-06-18", capabilities: {} });
  assert.equal(init.result.protocolVersion, "2025-06-18");
  assert.ok(init.result.capabilities.tools);
  assert.equal(await call("notifications/initialized", undefined, null), null);

  const list = await call("tools/list");
  assert.deepEqual(
    list.result.tools.map((t: any) => t.name),
    TOOLS.map((t) => t.name),
  );
  assert.ok(
    !TOOLS.some((t) => /merge|hire|retire|upgrade/.test(t.name)),
    "no merging or changing the org",
  );
});

test("a brain file is read by handle or by role, and a stranger's name says who there is", async () => {
  const { call } = await setup();
  const charter = await call("tools/call", {
    name: "read_brain",
    arguments: { staff: "cto", file: "CHARTER.md" },
  });
  assert.ok(!charter.result.isError, charter.result.content[0].text);
  assert.match(charter.result.content[0].text, /Chief Technology Officer|cto/i);

  const byName = await call("tools/call", {
    name: "read_brain",
    arguments: { staff: "chief technology officer", file: "memory/INDEX.md" },
  });
  assert.ok(!byName.result.isError, byName.result.content[0].text);

  const nobody = await call("tools/call", { name: "read_brain", arguments: { staff: "cfo" } });
  assert.equal(nobody.result.isError, true);
  assert.match(nobody.result.content[0].text, /cto \(Chief Technology Officer\)/);

  const outside = await call("tools/call", {
    name: "read_brain",
    arguments: { staff: "cto", file: "../roster-ops/org.yaml" },
  });
  assert.equal(outside.result.isError, true, "only the files a brain has, nothing beside it");
});

test("the brief reads like Home: reports, what needs you with its default, requests, closed today", () => {
  const ada = { github: "ada" };
  const cto = { handle: "cto", name: "CTO", brain: "acme/cto", statusIssue: 1 };
  const text = briefText({
    reports: [
      {
        staff: cto,
        item: { repo: "acme/cto", number: 1 },
        at: "2026-10-13T12:06:36Z",
        body: "Updated 13 Oct 12:06 UTC.\n\nShipped it.",
      },
    ],
    needs: [
      {
        kind: "decision",
        item: {
          repo: "acme/cto",
          number: 7,
          title: "Pick a name",
          due: { date: "2026-10-15", action: "I'll pick Pip" },
        },
      },
      {
        kind: "merge",
        item: {
          repo: "acme/web",
          number: 9,
          title: "Fix",
          checks: "passing",
          reviewDecision: "REVIEW_REQUIRED",
        },
      },
    ],
    requests: [
      {
        item: { repo: "acme/cto", number: 8, title: "Do X", author: ada.github },
        status: "working",
      },
    ],
    closedToday: [{ item: { repo: "acme/cto", number: 6, title: "Old" }, reason: "done in #9" }],
  });
  assert.match(text, /CTO \(acme\/cto#1\):\n {2}Updated 13 Oct 12:06 UTC\.\n {2}Shipped it\./);
  assert.match(text, /Needs you \(2\)/);
  assert.match(
    text,
    /\[decision\] acme\/cto#7 "Pick a name" \(default on 2026-10-15: I'll pick Pip\)/,
  );
  assert.match(text, /\[merge\] acme\/web#9 "Fix" \(checks passing, needs your approval\)/);
  assert.match(text, /acme\/cto#8 "Do X": working/);
  assert.match(text, /acme\/cto#6 "Old": done in #9/);
});
