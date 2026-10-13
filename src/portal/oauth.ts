import {
  type AuthConfig,
  base64url,
  cookie,
  esc,
  openJson,
  page,
  revoke,
  STATE_COOKIE,
  sealJson,
  setCookie,
  signedIn,
  startSignIn,
} from "./session.js";

/**
 * The sign-in a connector does: OAuth 2.1 with PKCE, in front of GitHub, so Claude can reach the
 * portal's MCP endpoint (`mcp.ts`) as the person who connected it.
 *
 * claude.ai finds this from `/.well-known/oauth-protected-resource`, registers itself
 * (`/oauth/register`), and sends the person to `/oauth/authorize`. They sign in with GitHub
 * exactly as they do for the portal, under the same check against org.yaml's humans, and then
 * say yes on a page of ours. The connector swaps the code for a token at `/oauth/token`.
 *
 * Nothing is stored. Like the session cookie, every value handed out is sealed under
 * `SESSION_KEY`: the client's registration, the code, the access and refresh tokens. Each
 * carries a `kind`, so one cannot stand in for another or for the cookie. The GitHub token
 * inside is the person's own, from a sign-in of its own: signing out of the portal does not
 * disconnect Claude, and revoking Roster on GitHub disconnects both.
 *
 * Stateless has one cost: a code can be swapped more than once in its five minutes. PKCE is
 * what makes that harmless, since only the client holding the verifier can swap it.
 */

const PENDING_COOKIE = "roster_mcp_pending";
const GRANT_COOKIE = "roster_mcp_grant";
export const MCP_CALLBACK = "/auth/callback/mcp";

/** An hour, then the connector refreshes. The refresh token lasts as long as a session cookie. */
const ACCESS_SECONDS = 3600;
const REFRESH_DAYS = 30;
const CODE_SECONDS = 300;

interface Client {
  kind: "client";
  name: string;
  redirects: string[];
}

/** What /oauth/authorize was asked, carried through GitHub's sign-in and the yes page. */
interface Pending {
  kind: "pending";
  client: string;
  name: string;
  redirect: string;
  challenge: string;
  state: string;
  exp: number;
}

interface Grant {
  kind: "grant" | "code" | "access" | "refresh";
  token: string;
  login: string;
  exp: number;
  /** Code and refresh only: which registration it was issued to, and for a code, where to. */
  client?: string;
  redirect?: string;
  challenge?: string;
}

export interface Bearer {
  token: string;
  login: string;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version",
  "access-control-expose-headers": "www-authenticate",
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return Response.json(body, {
    status,
    headers: { ...CORS, "cache-control": "no-store", ...extra },
  });
}

function oauthError(error: string, description: string, status = 400): Response {
  return json({ error, error_description: description }, status);
}

/** The routes this file answers, or undefined. Called before the portal's own. */
export async function handleOAuth(
  req: Request,
  url: URL,
  auth: AuthConfig,
  name: string,
): Promise<Response | undefined> {
  const path = url.pathname;
  if (
    req.method === "OPTIONS" &&
    (path.startsWith("/.well-known/") || path.startsWith("/oauth/"))
  ) {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (
    path === "/.well-known/oauth-protected-resource" ||
    path === "/.well-known/oauth-protected-resource/mcp"
  ) {
    return json({
      resource: `${url.origin}/mcp`,
      authorization_servers: [url.origin],
      bearer_methods_supported: ["header"],
      resource_name: `${name} on Roster`,
    });
  }
  if (path === "/.well-known/oauth-authorization-server") {
    return json({
      issuer: url.origin,
      authorization_endpoint: `${url.origin}/oauth/authorize`,
      token_endpoint: `${url.origin}/oauth/token`,
      registration_endpoint: `${url.origin}/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["roster"],
    });
  }
  if (path === "/oauth/register") return register(req, auth);
  if (path === "/oauth/authorize") return authorize(url, auth);
  if (path === MCP_CALLBACK) return callback(req, url, auth, name);
  if (path === "/oauth/approve") return approve(req, url, auth);
  if (path === "/oauth/token") return token(req, auth);
  return undefined;
}

/** Where a client may be sent back to: https anywhere, or http on this machine for a local tool. */
export function redirectAllowed(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  } catch {
    return false;
  }
}

/** Dynamic client registration (RFC 7591). The client id is its registration, sealed. */
async function register(req: Request, auth: AuthConfig): Promise<Response> {
  if (req.method !== "POST") return oauthError("invalid_request", "POST only", 405);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const redirects = Array.isArray(body?.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (!redirects.length || !redirects.every(redirectAllowed)) {
    return oauthError("invalid_redirect_uri", "redirect_uris must be https, or http on localhost");
  }
  const name = String(body?.client_name ?? "An MCP client").slice(0, 80);
  const client: Client = { kind: "client", name, redirects };
  return json(
    {
      client_id: await sealJson(client, auth.sessionKey),
      client_name: name,
      redirect_uris: redirects,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      client_id_issued_at: Math.floor(Date.now() / 1000),
    },
    201,
  );
}

async function clientOf(id: string, auth: AuthConfig): Promise<Client | null> {
  const c = await openJson<Client>(id, auth.sessionKey);
  return c?.kind === "client" && Array.isArray(c.redirects) ? c : null;
}

/** Check what the connector asked for, then off to GitHub with it held in a cookie. */
async function authorize(url: URL, auth: AuthConfig): Promise<Response> {
  const q = url.searchParams;
  const client = await clientOf(q.get("client_id") ?? "", auth);
  const redirect = q.get("redirect_uri") ?? "";
  // Without a client and a redirect it registered, there is nowhere safe to send an error.
  if (!client?.redirects.includes(redirect)) {
    return page(400, "That connection did not start properly", "<p>Start again from Claude.</p>");
  }
  const back = (error: string, description: string) =>
    Response.redirect(
      withParams(redirect, { error, error_description: description, state: q.get("state") }),
      302,
    );
  if (q.get("response_type") !== "code") return back("unsupported_response_type", "code only");
  const challenge = q.get("code_challenge") ?? "";
  if (!challenge || q.get("code_challenge_method") !== "S256") {
    return back("invalid_request", "PKCE with S256 is required");
  }

  const pending: Pending = {
    kind: "pending",
    client: q.get("client_id") ?? "",
    name: client.name,
    redirect,
    challenge,
    state: q.get("state") ?? "",
    exp: Date.now() + 600_000,
  };
  return startSignIn(url, auth, MCP_CALLBACK, [
    setCookie(PENDING_COOKIE, await sealJson(pending, auth.sessionKey), 600),
  ]);
}

async function pendingOf(req: Request, auth: AuthConfig): Promise<Pending | null> {
  const sealed = cookie(req.headers.get("cookie"), PENDING_COOKIE);
  const p = sealed ? await openJson<Pending>(sealed, auth.sessionKey) : null;
  return p?.kind === "pending" && p.exp > Date.now() ? p : null;
}

/** Back from GitHub: who it is, then the yes page. Nothing is granted until they press Allow. */
async function callback(req: Request, url: URL, auth: AuthConfig, name: string): Promise<Response> {
  const pending = await pendingOf(req, auth);
  if (!pending) return page(400, "That connection timed out", "<p>Start again from Claude.</p>");
  const who = await signedIn(req, url, auth, MCP_CALLBACK);
  if (who instanceof Response) return who;

  const grant: Grant = { kind: "grant", ...who, exp: Date.now() + 600_000 };
  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  });
  headers.append(
    "set-cookie",
    setCookie(GRANT_COOKIE, await sealJson(grant, auth.sessionKey), 600),
  );
  headers.append("set-cookie", setCookie(STATE_COOKIE, "", 0));
  const shown = page(
    200,
    `Connect ${pending.name}`,
    `<p><b>${esc(pending.name)}</b> will act as <b>${esc(who.login)}</b> on ${esc(name)}'s Roster: ` +
      "read the staff's reports, briefs and memory, answer their asks, and ask them to do things. " +
      "It cannot merge, hire or change the org.</p>" +
      `<form method="post" action="/oauth/approve"><button class="go" name="allow" value="1">Allow</button>` +
      `<button class="no" name="allow" value="0">Cancel</button></form>`,
  );
  return new Response(shown.body, { status: 200, headers });
}

/** Allow or Cancel: a code back to the connector, or its refusal. */
async function approve(req: Request, url: URL, auth: AuthConfig): Promise<Response> {
  if (req.method !== "POST" || req.headers.get("origin") !== url.origin) {
    return new Response("POST from this page only", { status: 405 });
  }
  const pending = await pendingOf(req, auth);
  const sealed = cookie(req.headers.get("cookie"), GRANT_COOKIE);
  const grant = sealed ? await openJson<Grant>(sealed, auth.sessionKey) : null;
  if (!pending || !grant || grant.kind !== "grant" || grant.exp < Date.now()) {
    return page(400, "That connection timed out", "<p>Start again from Claude.</p>");
  }
  const form = await req.formData().catch(() => null);
  const headers = new Headers();
  headers.append("set-cookie", setCookie(PENDING_COOKIE, "", 0));
  headers.append("set-cookie", setCookie(GRANT_COOKIE, "", 0));

  if (form?.get("allow") !== "1") {
    await revoke(grant.token, auth);
    headers.set(
      "location",
      withParams(pending.redirect, { error: "access_denied", state: pending.state }),
    );
    return new Response(null, { status: 302, headers });
  }
  const code: Grant = {
    kind: "code",
    token: grant.token,
    login: grant.login,
    client: pending.client,
    redirect: pending.redirect,
    challenge: pending.challenge,
    exp: Date.now() + CODE_SECONDS * 1000,
  };
  headers.set(
    "location",
    withParams(pending.redirect, {
      code: await sealJson(code, auth.sessionKey),
      state: pending.state,
    }),
  );
  return new Response(null, { status: 302, headers });
}

async function token(req: Request, auth: AuthConfig): Promise<Response> {
  if (req.method !== "POST") return oauthError("invalid_request", "POST only", 405);
  const form = await req.formData().catch(() => null);
  const field = (k: string) => String(form?.get(k) ?? "");
  const now = Date.now();

  let who: Bearer;
  let client: string;
  if (field("grant_type") === "authorization_code") {
    const code = await openJson<Grant>(field("code"), auth.sessionKey);
    if (code?.kind !== "code" || code.exp < now) {
      return oauthError("invalid_grant", "the code is not valid, or has expired");
    }
    if (code.client !== field("client_id") || code.redirect !== field("redirect_uri")) {
      return oauthError("invalid_grant", "the code was issued to another client");
    }
    if ((await s256(field("code_verifier"))) !== code.challenge) {
      return oauthError("invalid_grant", "code_verifier does not match");
    }
    who = { token: code.token, login: code.login };
    client = code.client;
  } else if (field("grant_type") === "refresh_token") {
    const refresh = await openJson<Grant>(field("refresh_token"), auth.sessionKey);
    if (refresh?.kind !== "refresh" || refresh.exp < now) {
      return oauthError("invalid_grant", "the refresh token is not valid, or has expired");
    }
    if (field("client_id") && field("client_id") !== refresh.client) {
      return oauthError("invalid_grant", "the refresh token was issued to another client");
    }
    who = { token: refresh.token, login: refresh.login };
    client = refresh.client ?? "";
  } else {
    return oauthError("unsupported_grant_type", "authorization_code or refresh_token");
  }

  const access: Grant = { kind: "access", ...who, exp: now + ACCESS_SECONDS * 1000 };
  const refresh: Grant = { kind: "refresh", ...who, client, exp: now + REFRESH_DAYS * 86_400_000 };
  return json({
    access_token: await sealJson(access, auth.sessionKey),
    token_type: "Bearer",
    expires_in: ACCESS_SECONDS,
    refresh_token: await sealJson(refresh, auth.sessionKey),
    scope: "roster",
  });
}

/** Who a request's bearer token belongs to, or null. Only an access token opens /mcp. */
export async function bearerOf(req: Request, secret: string): Promise<Bearer | null> {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
  if (!m?.[1]) return null;
  const g = await openJson<Grant>(m[1], secret);
  return g?.kind === "access" && g.exp > Date.now() && g.token && g.login
    ? { token: g.token, login: g.login }
    : null;
}

/** The 401 that tells a connector where to sign in. */
export function unauthorized(url: URL): Response {
  return json({ error: "Sign in first." }, 401, {
    "www-authenticate": `Bearer resource_metadata="${url.origin}/.well-known/oauth-protected-resource"`,
  });
}

export async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

function withParams(uri: string, params: Record<string, string | null>): string {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v);
  return u.toString();
}
