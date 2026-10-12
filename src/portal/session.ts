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
const STATE_COOKIE = "roster_state";
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

export async function seal(session: Session, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await keyFrom(secret),
    encoder.encode(JSON.stringify(session)),
  );
  return `${base64url(iv)}.${base64url(new Uint8Array(body))}`;
}

export async function open(
  value: string,
  secret: string,
  now = Date.now(),
): Promise<Session | null> {
  const [iv, body] = value.split(".");
  if (!iv || !body) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64Decode(iv) as Uint8Array<ArrayBuffer> },
      await keyFrom(secret),
      base64Decode(body) as Uint8Array<ArrayBuffer>,
    );
    const s = JSON.parse(new TextDecoder().decode(plain)) as Session;
    return s.exp > now && s.token && s.login ? s : null;
  } catch {
    return null;
  }
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
function setCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export interface AuthConfig {
  clientId: string;
  clientSecret: string;
  sessionKey: string;
  /** Whether a GitHub login may use this portal: the org's humans, from org.yaml. */
  allowed: (login: string, token: string) => Promise<boolean>;
}

/** Off to GitHub to sign in, with a one-time state that the callback must bring back. */
export function startSignIn(url: URL, cfg: AuthConfig): Response {
  const state = base64url(crypto.getRandomValues(new Uint8Array(16)));
  const to = new URL("https://github.com/login/oauth/authorize");
  to.searchParams.set("client_id", cfg.clientId);
  to.searchParams.set("redirect_uri", `${url.origin}/auth/callback`);
  to.searchParams.set("scope", "repo notifications");
  to.searchParams.set("state", state);
  to.searchParams.set("allow_signup", "false");
  return new Response(null, {
    status: 302,
    headers: { location: to.toString(), "set-cookie": setCookie(STATE_COOKIE, state, 600) },
  });
}

/** GitHub's redirect back: check the state, swap the code for a token, check who it is. */
export async function finishSignIn(
  req: Request,
  url: URL,
  cfg: AuthConfig,
  doFetch: typeof fetch = fetch,
): Promise<Response> {
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const expected = cookie(req.headers.get("cookie"), STATE_COOKIE);
  if (!code || !state || state !== expected) {
    return page(
      400,
      "That sign-in did not start here",
      "Go back to the portal and press Sign in again.",
    );
  }

  const exchanged = await doFetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      redirect_uri: `${url.origin}/auth/callback`,
    }),
  });
  const grant = (await exchanged.json().catch(() => ({}))) as {
    access_token?: string;
    error_description?: string;
  };
  if (!grant.access_token) {
    return page(502, "GitHub did not sign you in", grant.error_description ?? "Try again.");
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
      "This portal is for the org's people",
      `${login || "That account"} is not one of the humans in org.yaml, or cannot read the ops repository. ` +
        "Ask whoever runs it to add you under humans:.",
    );
  }

  const session: Session = {
    token: grant.access_token,
    login,
    exp: Date.now() + SESSION_DAYS * 86_400_000,
  };
  const headers = new Headers({ location: "/" });
  headers.append(
    "set-cookie",
    setCookie(SESSION_COOKIE, await seal(session, cfg.sessionKey), SESSION_DAYS * 86_400),
  );
  headers.append("set-cookie", setCookie(STATE_COOKIE, "", 0));
  return new Response(null, { status: 302, headers });
}

/** Sign out: the token is revoked on GitHub, not just forgotten here. */
export async function signOut(session: Session | null, cfg: AuthConfig): Promise<Response> {
  if (session) await revoke(session.token, cfg);
  return new Response(null, {
    status: 302,
    headers: { location: "/", "set-cookie": setCookie(SESSION_COOKIE, "", 0) },
  });
}

async function revoke(token: string, cfg: AuthConfig, doFetch: typeof fetch = fetch) {
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
export function signInPage(org: string): Response {
  return page(
    200,
    `${org} · roster`,
    `<a class="go" href="/auth/login">Sign in with GitHub</a>`,
    true,
  );
}

function page(status: number, title: string, body: string, html = false): Response {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${esc(title)}</title>` +
      `<style>body{font:15px/1.6 system-ui,sans-serif;max-width:30rem;margin:18vh auto;padding:0 1.4rem;color:#e8e8e8;background:#0b0b0b}` +
      `h1{font-size:1.3rem}.go{display:inline-block;margin-top:.6rem;padding:.6rem 1rem;border-radius:8px;background:#34c759;color:#04140a;font-weight:600;text-decoration:none}` +
      `@media (prefers-color-scheme: light){body{color:#151515;background:#fafafa}}</style>` +
      `<h1>${esc(title)}</h1><p>${html ? body : esc(body)}</p>`,
    {
      status,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
    },
  );
}

function base64url(bytes: Uint8Array): string {
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
