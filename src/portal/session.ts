/**
 * Who is signed in to a hosted portal, held in a cookie only the Worker can read.
 *
 * Sign-in is GitHub's own OAuth flow, through an OAuth App the org creates for its portal. The
 * token GitHub hands back is the person's, scoped `repo` and `notifications` — the same kind
 * `gh` holds on their machine, which is why unread stays in step with GitHub and their phone.
 *
 * Nothing is stored server-side. The token, the login and an expiry are sealed with AES-GCM
 * under the Worker's `SESSION_KEY` and set as an HttpOnly cookie, so the browser carries it
 * and cannot read it, and a cookie that was tampered with or sealed under another key simply
 * fails to open. Signing out revokes the token on GitHub as well as dropping the cookie.
 */

export interface Session {
  token: string;
  login: string;
  /** Milliseconds since the epoch. Past this the cookie is ignored and they sign in again. */
  exp: number;
}

export const SESSION_COOKIE = "roster_session";
export const STATE_COOKIE = "roster_state";
/** How long a sign-in lasts. The token itself does not expire, so this is the only bound. */
export const SESSION_DAYS = 14;

const encoder = new TextEncoder();

async function keyFrom(secret: string) {
  const raw = base64Decode(secret);
  if (raw.length !== 32) throw new Error("SESSION_KEY must be 32 bytes, base64-encoded");
  return crypto.subtle.importKey("raw", raw as Uint8Array<ArrayBuffer>, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

/** Anything as a string only this Worker can read back: the cookie, and the MCP grants. */
export async function sealJson(value: object, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await keyFrom(secret),
    encoder.encode(JSON.stringify(value)),
  );
  return `${base64url(iv)}.${base64url(new Uint8Array(body))}`;
}

/** What `sealJson` sealed, or null when it was tampered with or sealed under another key. */
export async function openJson<T>(value: string, secret: string): Promise<T | null> {
  const [iv, body] = value.split(".");
  if (!iv || !body) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64Decode(iv) as Uint8Array<ArrayBuffer> },
      await keyFrom(secret),
      base64Decode(body) as Uint8Array<ArrayBuffer>,
    );
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    return null;
  }
}

export async function seal(session: Session, secret: string): Promise<string> {
  return sealJson(session, secret);
}

/**
 * The session in a cookie. Anything sealed with a `kind` is one of the MCP grants (oauth.ts),
 * sealed under the same key, and is never a cookie: a token handed to a connector must not
 * open the portal if somebody pastes it into one.
 */
export async function open(
  value: string,
  secret: string,
  now = Date.now(),
): Promise<Session | null> {
  const s = await openJson<Session & { kind?: string }>(value, secret);
  return s && !s.kind && s.exp > now && s.token && s.login ? s : null;
}

export function cookie(header: string | null, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

/**
 * Lax rather than Strict, because the cookie is set on GitHub's redirect back, and a Strict one
 * would not be sent on the page that redirect lands on. Lax is still never sent on a cross-site
 * POST, and every write also needs the portal's own header and origin, so it buys nothing an
 * attacker could use.
 */
export function setCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export interface AuthConfig {
  clientId: string;
  clientSecret: string;
  sessionKey: string;
  /** Whether a GitHub login may use this portal: the org's humans, from org.yaml. */
  allowed: (login: string, token: string) => Promise<boolean>;
}

/**
 * Off to GitHub to sign in, with a one-time state that the callback must bring back.
 *
 * `callback` is where GitHub sends them back to. GitHub accepts any path under the OAuth App's
 * callback URL, which is how connecting Claude (`/auth/callback/mcp`) gets a sign-in of its
 * own without a second App. `extra` are cookies the callback needs, set alongside the state.
 */
export function startSignIn(
  url: URL,
  cfg: AuthConfig,
  callback = "/auth/callback",
  extra: string[] = [],
): Response {
  const state = base64url(crypto.getRandomValues(new Uint8Array(16)));
  const to = new URL("https://github.com/login/oauth/authorize");
  to.searchParams.set("client_id", cfg.clientId);
  to.searchParams.set("redirect_uri", `${url.origin}${callback}`);
  to.searchParams.set("scope", "repo notifications");
  to.searchParams.set("state", state);
  to.searchParams.set("allow_signup", "false");
  const headers = new Headers({ location: to.toString() });
  headers.append("set-cookie", setCookie(STATE_COOKIE, state, 600));
  for (const c of extra) headers.append("set-cookie", c);
  return new Response(null, { status: 302, headers });
}

/** GitHub's redirect back: check the state, swap the code for a token, check who it is. */
export async function finishSignIn(
  req: Request,
  url: URL,
  cfg: AuthConfig,
  doFetch: typeof fetch = fetch,
): Promise<Response> {
  const who = await signedIn(req, url, cfg, "/auth/callback", doFetch);
  if (who instanceof Response) return who;

  const session: Session = { ...who, exp: Date.now() + SESSION_DAYS * 86_400_000 };
  const headers = new Headers({ location: "/" });
  headers.append(
    "set-cookie",
    setCookie(SESSION_COOKIE, await seal(session, cfg.sessionKey), SESSION_DAYS * 86_400),
  );
  headers.append("set-cookie", setCookie(STATE_COOKIE, "", 0));
  return new Response(null, { status: 302, headers });
}

/**
 * The shared half of a callback: the state checked, GitHub's code swapped for a token, and the
 * account checked against org.yaml's humans. An error page when any of that fails, with the
 * token revoked if one was issued.
 */
export async function signedIn(
  req: Request,
  url: URL,
  cfg: AuthConfig,
  callback: string,
  doFetch: typeof fetch = fetch,
): Promise<{ token: string; login: string } | Response> {
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const expected = cookie(req.headers.get("cookie"), STATE_COOKIE);
  if (!code || !state || state !== expected) {
    return page(
      400,
      "That sign-in did not start here",
      `<p>Start again from the portal.</p><a class="back" href="/">Back to sign in</a>`,
    );
  }

  const exchanged = await doFetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      redirect_uri: `${url.origin}${callback}`,
    }),
  });
  const grant = (await exchanged.json().catch(() => ({}))) as {
    access_token?: string;
    error_description?: string;
  };
  if (!grant.access_token) {
    return page(
      502,
      "GitHub did not sign you in",
      `<p>${esc(grant.error_description ?? "Try again.")}</p><a class="back" href="/">Back to sign in</a>`,
    );
  }

  const me = await doFetch("https://api.github.com/user", {
    headers: {
      authorization: `Bearer ${grant.access_token}`,
      accept: "application/vnd.github+json",
      "user-agent": "roster-portal",
    },
  });
  const login = ((await me.json().catch(() => ({}))) as { login?: string }).login ?? "";
  if (!login || !(await cfg.allowed(login, grant.access_token))) {
    await revoke(grant.access_token, cfg, doFetch);
    return page(
      403,
      "Not on the list",
      `<p>${esc(login || "That account")} is not one of the humans in org.yaml, or cannot read the ` +
        "ops repository. Ask whoever runs it to add you under humans:.</p>" +
        `<a class="back" href="/">Back to sign in</a>`,
    );
  }
  return { token: grant.access_token, login };
}

/** Sign out: the token is revoked on GitHub, not just forgotten here. */
export async function signOut(session: Session | null, cfg: AuthConfig): Promise<Response> {
  if (session) await revoke(session.token, cfg);
  return new Response(null, {
    status: 302,
    headers: { location: "/", "set-cookie": setCookie(SESSION_COOKIE, "", 0) },
  });
}

export async function revoke(token: string, cfg: AuthConfig, doFetch: typeof fetch = fetch) {
  await doFetch(`https://api.github.com/applications/${cfg.clientId}/token`, {
    method: "DELETE",
    headers: {
      authorization: `Basic ${btoa(`${cfg.clientId}:${cfg.clientSecret}`)}`,
      accept: "application/vnd.github+json",
      "content-type": "application/json",
      "user-agent": "roster-portal",
    },
    body: JSON.stringify({ access_token: token }),
  }).catch(() => {});
}

/** The page somebody sees before they have signed in. */
export function signInPage(name: string): Response {
  return page(200, name, `<a class="go" href="/auth/login">${GITHUB_MARK}Sign in with GitHub</a>`);
}

const GITHUB_MARK =
  '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';

export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * A page of its own, in the portal's own stylesheet, so signing in looks like the thing you are
 * signing in to. `body` is markup: callers escape what they put in it.
 */
export function page(status: number, title: string, body: string): Response {
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${esc(title)} · roster</title>` +
      `<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%2334c759'/%3E%3C/svg%3E">` +
      `<link rel="stylesheet" href="/assets/css/base.css">` +
      `<style>${PAGE_CSS}</style>` +
      `<main class="gate"><div class="card">` +
      `<div class="who"><span class="mark"></span><div><b>${esc(title)}</b><small>roster</small></div></div>` +
      `${body}</div></main></html>`,
    {
      status,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    },
  );
}

const PAGE_CSS = `
html,body{height:100%;margin:0}
body{background:var(--bg);color:var(--ink);font:15px/1.5 var(--sans);-webkit-font-smoothing:antialiased}
.gate{min-height:100%;display:grid;place-items:center;padding:24px 16px;box-sizing:border-box}
.card{width:100%;max-width:360px;box-sizing:border-box;padding:28px;border-radius:var(--r-lg);
  background:var(--surface);border:1px solid var(--line);box-shadow:var(--shadow-lg)}
.who{display:flex;align-items:center;gap:12px;margin-bottom:22px}
.who .mark{width:36px;height:36px;border-radius:10px;background:var(--accent-fill);flex:none}
.who b{display:block;font-size:17px;font-weight:600;letter-spacing:-.02em}
.who small{display:block;color:var(--ink-faint);font-size:12.5px}
.card p{margin:0 0 18px;color:var(--ink-dim)}
.go{display:flex;align-items:center;justify-content:center;gap:9px;width:100%;box-sizing:border-box;
  padding:11px 16px;border-radius:var(--r);background:var(--ink);color:var(--bg);
  font-weight:600;text-decoration:none;transition:opacity .15s var(--ease)}
.go:hover{opacity:.88}
.go:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
button.go{border:0;cursor:pointer;font:inherit;font-weight:600;margin-bottom:8px}
.no{display:block;width:100%;padding:10px 16px;border:0;border-radius:var(--r);background:none;
  color:var(--ink-dim);font:inherit;cursor:pointer}
.no:hover{color:var(--ink)}
.back{display:inline-block;margin-top:4px;color:var(--accent);text-decoration:none;font-weight:500}
`;

export function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64Decode(s: string): Uint8Array {
  const std = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(std + "=".repeat((4 - (std.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
