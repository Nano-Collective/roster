import type { KeyValue } from "./kv.js";
import { openJson, sealJson } from "./session.js";

/**
 * Signed-in connectors: the hosted portal signs in to a service once, keeps the refresh token,
 * and hands each run a fresh access token.
 *
 * A run cannot sign in to anything, and a refresh token cannot live in a GitHub secret, because
 * services like Notion replace it on every refresh and a run has no way to write the new one
 * back. So the portal holds it, sealed under its session key, in a KV namespace of its own, and
 * a run collects an access token by proving with GitHub's OIDC token that it is a run of this
 * org's session workflow. No secret is shared with the run to make that work.
 *
 * The sign-in is OAuth 2.1 as MCP servers do it: discovery from the server's own metadata,
 * dynamic client registration, PKCE, and the server named as the `resource`.
 */

export interface Grant {
  connector: string;
  resource: string;
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms. */
  expiresAt: number;
  by: string;
  at: string;
}

interface ServerMeta {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
}

const key = (connector: string) => `grant:${connector}`;

export async function readGrant(
  store: KeyValue,
  secret: string,
  connector: string,
): Promise<Grant | null> {
  const sealed = await store.get(key(connector));
  return sealed ? openJson<Grant>(sealed, secret) : null;
}

export async function writeGrant(store: KeyValue, secret: string, g: Grant): Promise<void> {
  await store.put(key(g.connector), await sealJson(g, secret));
}

/** Forgotten by writing nothing over it: the KV interface has no delete, and an empty seal opens to null. */
export async function dropGrant(store: KeyValue, connector: string): Promise<void> {
  await store.put(key(connector), "");
}

/* ------------------------------------------------------------------------------------------ */
/* Signing in                                                                                 */
/* ------------------------------------------------------------------------------------------ */

/** Where a resource's authorisation server is, by the two discovery documents MCP uses. */
export async function discover(resource: string, doFetch = fetch): Promise<ServerMeta> {
  const r = new URL(resource);
  let issuer = r.origin;
  for (const path of [
    `/.well-known/oauth-protected-resource${r.pathname}`,
    "/.well-known/oauth-protected-resource",
  ]) {
    const res = await doFetch(r.origin + path).catch(() => null);
    if (!res?.ok) continue;
    const meta = (await res.json().catch(() => ({}))) as { authorization_servers?: string[] };
    if (meta.authorization_servers?.[0]) {
      issuer = meta.authorization_servers[0].replace(/\/+$/, "");
      break;
    }
  }
  const i = new URL(issuer);
  const suffix = i.pathname === "/" ? "" : i.pathname;
  for (const path of [
    `/.well-known/oauth-authorization-server${suffix}`,
    `/.well-known/openid-configuration${suffix}`,
  ]) {
    const res = await doFetch(i.origin + path).catch(() => null);
    if (!res?.ok) continue;
    const meta = (await res.json().catch(() => null)) as ServerMeta | null;
    if (meta?.authorization_endpoint && meta.token_endpoint) return meta;
  }
  throw new Error(`could not find how to sign in to ${r.host}`);
}

/** A client of our own on that server, registered once and remembered. */
export async function clientFor(
  meta: ServerMeta,
  redirectUri: string,
  name: string,
  store: KeyValue,
  doFetch = fetch,
): Promise<{ clientId: string; clientSecret?: string }> {
  const remembered = `oauthclient:${meta.issuer}:${redirectUri}`;
  const kept = await store.get(remembered);
  if (kept) return JSON.parse(kept);
  if (!meta.registration_endpoint) {
    throw new Error(`${new URL(meta.issuer).host} does not let a new app register itself`);
  }
  const res = await doFetch(meta.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: name,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  const body = (await res.json().catch(() => ({}))) as {
    client_id?: string;
    client_secret?: string;
  };
  if (!res.ok || !body.client_id)
    throw new Error(`registering with ${meta.issuer} failed (${res.status})`);
  const client = { clientId: body.client_id, clientSecret: body.client_secret };
  await store.put(remembered, JSON.stringify(client));
  return client;
}

export function verifier(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function challenge(v: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v))));
}

interface TokenAnswer {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

async function tokenRequest(
  endpoint: string,
  form: Record<string, string | undefined>,
  doFetch = fetch,
): Promise<TokenAnswer & { status: number }> {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(form)) if (v) body.set(k, v);
  const res = await doFetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
  });
  return { status: res.status, ...((await res.json().catch(() => ({}))) as TokenAnswer) };
}

export async function exchange(
  o: {
    connector: string;
    resource: string;
    tokenEndpoint: string;
    clientId: string;
    clientSecret?: string;
    code: string;
    verifier: string;
    redirectUri: string;
    by: string;
  },
  doFetch = fetch,
): Promise<Grant> {
  const t = await tokenRequest(
    o.tokenEndpoint,
    {
      grant_type: "authorization_code",
      code: o.code,
      redirect_uri: o.redirectUri,
      client_id: o.clientId,
      client_secret: o.clientSecret,
      code_verifier: o.verifier,
      resource: o.resource,
    },
    doFetch,
  );
  if (!t.access_token)
    throw new Error(t.error_description ?? t.error ?? `sign-in failed (${t.status})`);
  return {
    connector: o.connector,
    resource: o.resource,
    tokenEndpoint: o.tokenEndpoint,
    clientId: o.clientId,
    clientSecret: o.clientSecret,
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: Date.now() + (t.expires_in ?? 3600) * 1000,
    by: o.by,
    at: new Date().toISOString(),
  };
}

/**
 * A usable access token: the one held while it has a few minutes left, a refreshed one after.
 *
 * Services that rotate refresh tokens retire the old one on use, so two runs refreshing at once
 * would leave one of them holding a dead token. The loser reads the grant again, where the
 * winner has just put a fresh access token, and uses that.
 */
export async function accessToken(
  store: KeyValue,
  secret: string,
  connector: string,
  doFetch = fetch,
  now = Date.now(),
): Promise<string> {
  const g = await readGrant(store, secret, connector);
  if (!g) throw new Error(`nobody has signed in to ${connector}. Sign in from the Connectors page`);
  if (g.expiresAt - now > 5 * 60_000) return g.accessToken;
  if (!g.refreshToken) throw new Error(`the ${connector} sign-in has expired. Sign in again`);
  const t = await tokenRequest(
    g.tokenEndpoint,
    {
      grant_type: "refresh_token",
      refresh_token: g.refreshToken,
      client_id: g.clientId,
      client_secret: g.clientSecret,
      resource: g.resource,
    },
    doFetch,
  );
  if (!t.access_token) {
    await new Promise((r) => setTimeout(r, 1500));
    const again = await readGrant(store, secret, connector);
    if (again && again.accessToken !== g.accessToken && again.expiresAt - now > 60_000) {
      return again.accessToken;
    }
    throw new Error(
      `the ${connector} sign-in could not be renewed (${t.error ?? t.status}). Sign in again`,
    );
  }
  await writeGrant(store, secret, {
    ...g,
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? g.refreshToken,
    expiresAt: now + (t.expires_in ?? 3600) * 1000,
  });
  return t.access_token;
}

/* ------------------------------------------------------------------------------------------ */
/* A run proving who it is                                                                    */
/* ------------------------------------------------------------------------------------------ */

const ISSUER = "https://token.actions.githubusercontent.com";
type Jwk = { kid?: string; kty?: string; n?: string; e?: string; alg?: string };
let jwks: { at: number; keys: Jwk[] } | null = null;

/**
 * Claims from a GitHub Actions OIDC token, once its signature, issuer, audience and expiry
 * check out, or null.
 */
export async function verifyActionsToken(
  token: string,
  audience: string,
  doFetch = fetch,
  now = Date.now(),
): Promise<Record<string, unknown> | null> {
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) return null;
  let header: { alg?: string; kid?: string };
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(fromB64url(h)));
    claims = JSON.parse(new TextDecoder().decode(fromB64url(p)));
  } catch {
    return null;
  }
  if (header.alg !== "RS256") return null;
  if (!jwks || now - jwks.at > 3_600_000 || !jwks.keys.some((k) => k.kid === header.kid)) {
    const res = await doFetch(`${ISSUER}/.well-known/jwks`);
    if (!res.ok) return null;
    jwks = { at: now, keys: ((await res.json()) as { keys: Jwk[] }).keys };
  }
  const jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const pub = await crypto.subtle.importKey(
    "jwk",
    // The shape GitHub publishes is exactly a JWK; the local type is only narrower.
    jwk as never,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    pub,
    fromB64url(s) as Uint8Array<ArrayBuffer>,
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!ok) return null;
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== ISSUER || !aud.includes(audience)) return null;
  if (typeof claims.exp !== "number" || claims.exp * 1000 < now) return null;
  return claims;
}

/**
 * Whether a verified token is one of this org's sessions: a job in the org, running the ops
 * repo's own session workflow. Anything else in the org, or the same workflow in another org, is
 * turned away.
 */
export function isSession(claims: Record<string, unknown>, org: string, opsName: string): boolean {
  const owner = String(claims.repository_owner ?? "").toLowerCase();
  const ref = String(claims.job_workflow_ref ?? "").toLowerCase();
  return (
    owner === org.toLowerCase() &&
    ref.startsWith(`${org}/${opsName}/.github/workflows/session.yaml@`.toLowerCase())
  );
}

/* ------------------------------------------------------------------------------------------ */

function b64url(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return Uint8Array.from(atob(pad), (c) => c.charCodeAt(0));
}
