import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import {
  type AuthConfig,
  finishSignIn,
  open,
  SESSION_COOKIE,
  seal,
  startSignIn,
} from "../src/portal/session.js";

/**
 * Signing in to a hosted portal. The parts that decide who gets in are checked here without
 * GitHub: what a cookie proves, what a callback has to bring back, and who is turned away.
 */

const KEY = randomBytes(32).toString("base64");
const OTHER = randomBytes(32).toString("base64");

const config = (allowed: string[]): AuthConfig => ({
  clientId: "client",
  clientSecret: "secret",
  sessionKey: KEY,
  allowed: async (login) => allowed.includes(login),
});

/** GitHub's three endpoints in the flow, answered from here, with every call recorded. */
function github(login: string) {
  const calls: string[] = [];
  const fake = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${url}`);
    if (url.includes("/login/oauth/access_token")) return Response.json({ access_token: "gho_x" });
    if (url.endsWith("/user")) return Response.json({ login });
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  return { calls, fake };
}

const setCookies = (res: Response) =>
  res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
const cookieValue = (res: Response, name: string) =>
  decodeURIComponent(
    setCookies(res)
      .find((c) => c.startsWith(`${name}=`))
      ?.split(";")[0]
      ?.slice(name.length + 1) ?? "",
  );

test("a sealed session opens with its key, and with no other", async () => {
  const sealed = await seal({ token: "t", login: "will", exp: Date.now() + 60_000 }, KEY);
  assert.equal((await open(sealed, KEY))?.login, "will");
  assert.equal(await open(sealed, OTHER), null, "another key opens nothing");
  assert.equal(
    await open(`${sealed.slice(0, -2)}xx`, KEY),
    null,
    "a tampered cookie opens nothing",
  );
  const old = await seal({ token: "t", login: "will", exp: Date.now() - 1 }, KEY);
  assert.equal(await open(old, KEY), null, "an expired one is ignored");
});

test("one of the org's humans signs in, and the cookie is HttpOnly and Secure", async () => {
  const url = new URL("https://roster.example/auth/login");
  const start = startSignIn(url, config(["will"]));
  const to = new URL(start.headers.get("location")!);
  assert.equal(to.origin, "https://github.com");
  assert.equal(to.searchParams.get("scope"), "repo notifications");
  const state = to.searchParams.get("state")!;

  const { fake } = github("will");
  const back = new URL(`https://roster.example/auth/callback?code=abc&state=${state}`);
  const req = new Request(back, { headers: { cookie: `roster_state=${state}` } });
  const res = await finishSignIn(req, back, config(["will"]), fake);
  assert.equal(res.status, 302);
  const sessionCookie = setCookies(res).find((c) => c.startsWith(`${SESSION_COOKIE}=`))!;
  assert.match(sessionCookie, /HttpOnly/);
  assert.match(sessionCookie, /Secure/);
  assert.match(sessionCookie, /SameSite=Lax/);
  const session = await open(cookieValue(res, SESSION_COOKIE), KEY);
  assert.equal(session?.login, "will");
  assert.equal(session?.token, "gho_x");
});

test("a callback that did not start here is refused", async () => {
  const { fake, calls } = github("will");
  const back = new URL("https://roster.example/auth/callback?code=abc&state=forged");
  const req = new Request(back, { headers: { cookie: "roster_state=real" } });
  const res = await finishSignIn(req, back, config(["will"]), fake);
  assert.equal(res.status, 400);
  assert.deepEqual(calls, [], "GitHub is not even asked");
});

test("somebody who is not one of the humans is turned away, and their token revoked", async () => {
  const { fake, calls } = github("stranger");
  const back = new URL("https://roster.example/auth/callback?code=abc&state=s");
  const req = new Request(back, { headers: { cookie: "roster_state=s" } });
  const res = await finishSignIn(req, back, config(["will"]), fake);
  assert.equal(res.status, 403);
  assert.ok(
    !setCookies(res).some((c) => c.startsWith(`${SESSION_COOKIE}=`) && !c.includes("Max-Age=0")),
  );
  assert.ok(
    calls.some((c) => c.startsWith("DELETE https://api.github.com/applications/client/token")),
  );
});
