// @ts-expect-error: generated at build time by scripts/build-worker.mjs
import framework from "roster:framework";
import { useFrameworkRoot } from "../lib/framework.js";
import { type GitHub, githubClient } from "../lib/github.js";
import { readHumans } from "../lib/humans.js";
import { useRecordStore } from "../lib/runs.js";
import { mount, treeOf } from "../lib/vfs.js";
import { accessToken, isSession, verifyActionsToken } from "./grants.js";
import { type Actor, createPortal, handlePortal, type Portal, readOrgFor } from "./handler.js";
import { cloudflareKV, recordStore } from "./kv-cloudflare.js";
import { handleMcp } from "./mcp.js";
import { bearerOf, handleOAuth, unauthorized } from "./oauth.js";
import {
  type AuthConfig,
  cookie,
  finishSignIn,
  open,
  SESSION_COOKIE,
  type Session,
  signInPage,
  signOut,
  startSignIn,
} from "./session.js";

/**
 * The portal on Cloudflare Workers: the same handler `roster portal` runs, behind a sign-in.
 *
 * Everything that reads or acts on the org is `handler.ts`, unchanged. What is here is only what
 * a public URL needs and a laptop does not: who you are (GitHub sign-in, `session.ts`), whether
 * you are one of the org's humans, and a write guard that checks the request came from this
 * page. Setting an org up, hiring and doctor stay on your machine, and say so.
 */
interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
  /** The GitHub org this portal shows. */
  ROSTER_ORG: string;
  /** The org's name as people say it ("Pip" for playpip), for the sign-in page. */
  ROSTER_NAME?: string;
  /** Its ops repository, if it is not `roster-ops`. */
  ROSTER_OPS_REPO?: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  /** 32 random bytes, base64. Seals the session cookie. */
  SESSION_KEY: string;
  /** Optional: a KV namespace for the cache. Without one, the edge cache. */
  CACHE?: Parameters<typeof cloudflareKV>[0];
  /**
   * Optional: a KV namespace for signed-in connectors, which have to outlive any cache. Without
   * one, connectors that sign in are not offered; the ones that take a key still are.
   */
  CONNECTORS?: Parameters<typeof cloudflareKV>[0];
  /** Development only, honoured on localhost alone: act as this token without signing in. */
  DEV_TOKEN?: string;
}

const FRAMEWORK = "/@roster-framework";

let portal: Portal | null = null;
const clients = new Map<string, GitHub>();
/** When each login was last confirmed as one of the org's humans. */
const confirmed = new Map<string, number>();
const RECHECK_MS = 5 * 60_000;

function boot(env: Env, origin: string): Portal {
  if (portal) return portal;
  mount(FRAMEWORK, treeOf(framework as Record<string, string>));
  useFrameworkRoot(FRAMEWORK);
  const kv = cloudflareKV(env.CACHE);
  useRecordStore(recordStore(kv));
  portal = createPortal({
    org: env.ROSTER_ORG,
    opsName: env.ROSTER_OPS_REPO ?? "roster-ops",
    kv,
    // A Worker request that awaits a fetch another request started never finishes.
    shareInflight: false,
    grants: env.CONNECTORS
      ? { store: durableKV(env.CONNECTORS), secret: env.SESSION_KEY, base: origin }
      : undefined,
  });
  return portal;
}

function clientFor(token: string): GitHub {
  let gh = clients.get(token);
  if (!gh) {
    gh = githubClient(token);
    clients.set(token, gh);
    if (clients.size > 50) clients.delete(clients.keys().next().value!);
  }
  return gh;
}

/** One of the humans in org.yaml, read with their own token: which also proves they can read it. */
async function isHuman(p: Portal, login: string, token: string): Promise<boolean> {
  const org = await readOrgFor(p, clientFor(token));
  if (!org) return false;
  return readHumans(org).some((h) => h.github?.toLowerCase() === login.toLowerCase());
}

/** Somebody taken out of humans stops getting in within minutes, not when their sign-in ends. */
async function stillHuman(p: Portal, login: string, token: string): Promise<boolean> {
  const at = confirmed.get(login) ?? 0;
  if (Date.now() - at < RECHECK_MS) return true;
  if (!(await isHuman(p, login, token))) return false;
  confirmed.set(login, Date.now());
  return true;
}

export default {
  async fetch(
    req: Request,
    env: Env,
    ctx: { waitUntil(work: Promise<unknown>): void },
  ): Promise<Response> {
    const url = new URL(req.url);
    const p = boot(env, url.origin);
    const path = url.pathname;
    const auth: AuthConfig = {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
      sessionKey: env.SESSION_KEY,
      allowed: (login, token) => isHuman(p, login, token),
    };

    if (path === "/auth/login") return startSignIn(url, auth);
    if (path === "/auth/callback") return finishSignIn(req, url, auth);

    // Claude, or any MCP client: its own sign-in, then a bearer token rather than the cookie.
    const name = env.ROSTER_NAME || env.ROSTER_ORG;
    const oauth = await handleOAuth(req, url, auth, name);
    if (oauth) return oauth;
    if (path === "/mcp") {
      const who = await bearerOf(req, env.SESSION_KEY);
      if (!who || !(await stillHuman(p, who.login, who.token))) return unauthorized(url);
      const actor: Actor = {
        gh: clientFor(who.token),
        id: who.login,
        // A bearer token is never sent by a browser on its own, so another site cannot make
        // this request: the token is the write guard.
        canWrite: true,
        background: (work) => ctx.waitUntil(work),
      };
      return handleMcp(req, p, actor, name);
    }

    // A run collecting a signed-in connector's token. It has no session: it proves which
    // workflow it is with GitHub's own OIDC token instead.
    if (path === "/connectors/token") return connectorToken(req, url, p);

    // The page's own files carry nothing about the org, and the sign-in page needs none of them.
    if (path.startsWith("/assets/")) return env.ASSETS.fetch(req);

    let session: Session | null = null;
    const sealed = cookie(req.headers.get("cookie"), SESSION_COOKIE);
    if (sealed) session = await open(sealed, env.SESSION_KEY);
    if (!session && env.DEV_TOKEN && url.hostname === "localhost") {
      session = { token: env.DEV_TOKEN, login: "dev", exp: Number.POSITIVE_INFINITY };
    }

    if (path === "/auth/logout") {
      if (req.method !== "POST" || !sameOrigin(req, url))
        return new Response("POST only", { status: 405 });
      return signOut(session, auth);
    }

    if (!session) {
      if (path === "/") return signInPage(env.ROSTER_NAME || env.ROSTER_ORG);
      return Response.json({ error: "Sign in first.", signIn: "/auth/login" }, { status: 401 });
    }

    if (session.login !== "dev" && !(await stillHuman(p, session.login, session.token))) {
      return signOut(null, auth);
    }

    if (path === "/") return env.ASSETS.fetch(new Request(new URL("/index.html", url)));
    if (path === "/api/session") return Response.json({ login: session.login, hosted: true });

    // A screenshot in the docs. Bundled as a file beside the page rather than in the code.
    if (path === "/api/docasset") {
      const name = (url.searchParams.get("path") ?? "").replace(/^images\//, "");
      if (!/^[\w.-]+\.(png|jpe?g|gif|svg|webp)$/i.test(name))
        return new Response("not found", { status: 404 });
      return env.ASSETS.fetch(new Request(new URL(`/docs-images/${name}`, url)));
    }

    const actor: Actor = {
      gh: clientFor(session.token),
      id: session.login,
      // The same three things the local server asks, with this origin in place of localhost.
      canWrite:
        req.method === "POST" && req.headers.get("x-roster") === "1" && sameOrigin(req, url),
      background: (work) => ctx.waitUntil(work),
    };
    const answer = await handlePortal(req, p, actor);
    if (answer) return answer;

    if (path.startsWith("/api/")) {
      return Response.json(
        {
          error: "This runs on your own machine: start `roster portal` in your workspace.",
          hosted: true,
        },
        { status: 501 },
      );
    }
    return new Response("not found", { status: 404 });
  },
};

/** A request this page made, not one another site's page made on its behalf. */
function sameOrigin(req: Request, url: URL): boolean {
  const origin = req.headers.get("origin");
  return origin === url.origin;
}

/** KV that keeps what it is given: no expiry, because a sign-in is not a cache entry. */
function durableKV(ns: NonNullable<Env["CONNECTORS"]>) {
  return {
    async get(key: string) {
      return (await ns.get(key)) ?? undefined;
    },
    async put(key: string, value: string) {
      await ns.put(key, value);
    },
  };
}

/**
 * A fresh access token for one signed-in connector, for a run of this org's session workflow.
 * The run's OIDC token is asked for with this portal's origin as its audience, so a token minted
 * for anything else is turned away.
 */
async function connectorToken(req: Request, url: URL, p: Portal): Promise<Response> {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  if (!p.grants) return Response.json({ error: "this portal keeps no sign-ins" }, { status: 404 });
  const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1];
  const claims = bearer ? await verifyActionsToken(bearer, url.origin) : null;
  if (!claims || !isSession(claims, p.org, p.opsName)) {
    return Response.json({ error: "only a run of this org's session workflow" }, { status: 401 });
  }
  const { connector } = (await req.json().catch(() => ({}))) as { connector?: string };
  if (!connector || !/^[a-z][a-z0-9-]{0,30}$/.test(connector)) {
    return Response.json({ error: "which connector?" }, { status: 400 });
  }
  try {
    return Response.json({
      access_token: await accessToken(p.grants.store, p.grants.secret, connector),
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 409 });
  }
}
