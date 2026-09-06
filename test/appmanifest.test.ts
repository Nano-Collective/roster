import { test } from "node:test";
import assert from "node:assert/strict";
import { buildManifest, handoffPage, createApp, PERMISSIONS, type AppSpec } from "../src/lib/appmanifest.js";

/**
 * The browser leg of this cannot be exercised here: creating a GitHub App needs a human to
 * confirm a form, and doing it for real would leave a live App behind. So what is tested is
 * everything either side of that — the manifest, the hand-off page, and the local server's
 * behaviour when GitHub comes back, including when what comes back is not GitHub.
 *
 * The part that stays unverified by me is the round trip itself, and the help text says so.
 */

const SPEC: AppSpec = {
  name: "acme-cfo",
  org: "acme",
  scope: "private",
  description: "Chief Financial Officer at Pip.",
};

test("the manifest asks for what an agent does and nothing more", () => {
  const m = buildManifest(SPEC, "http://localhost:4310/callback") as any;
  assert.equal(m.name, "acme-cfo");
  assert.equal(m.public, false, "a staff member's App is not for anyone else to install");
  assert.equal(m.redirect_url, "http://localhost:4310/callback");
  assert.deepEqual(m.default_events, [], "nothing here listens for webhooks");
  assert.equal(m.hook_attributes.active, false);

  assert.deepEqual(m.default_permissions, {
    contents: "write", issues: "write", pull_requests: "write", metadata: "read",
  });
});

test("a new App is not given permission to rewrite its own workflows", () => {
  /* Deliberate: upgrades are human-run, and `roster upgrade` is what carries a template change
     into a brain repo. One of the live apps declares workflows:write anyway, which is a neat
     illustration of the trap — a declaration is not an installation's grant. */
  for (const scope of ["private", "public"] as const) {
    assert.equal(PERMISSIONS[scope].workflows, undefined, `${scope} should not request workflows`);
  }
});

test("the hand-off posts to the org's own settings page, carrying the state", () => {
  const page = handoffPage(SPEC, buildManifest(SPEC, "http://localhost:4310/callback"), "abc123");
  assert.match(page, /action="https:\/\/github\.com\/organizations\/acme\/settings\/apps\/new\?state=abc123"/);
  assert.match(page, /name="manifest"/);
  assert.match(page, /method="post"/);
  assert.match(page, /\.submit\(\)/, "it submits itself; there is nothing on it to read");
});

test("the manifest survives being embedded in an attribute", () => {
  /* It is JSON inside an HTML value attribute. The property that matters is not how it is
     escaped but that it comes back out intact — an unescaped quote would end the attribute and
     the form would silently post a truncated manifest. So it is parsed back. */
  const evil: AppSpec = { ...SPEC, description: 'a "quoted" <thing> & more' };
  const manifest = buildManifest(evil, "http://x/cb");
  const page = handoffPage(evil, manifest, "s");

  const value = /name="manifest" value="([^"]*)"/.exec(page)?.[1];
  assert.ok(value, "the manifest must be in a value attribute the browser can read");
  const unescaped = value
    .replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  assert.deepEqual(JSON.parse(unescaped), manifest, "what GitHub receives must be what was built");
  assert.ok(!page.includes("<thing>"), "and the markup must not survive as markup");
});

/* ------------------------------- the local leg ------------------------------- */

/**
 * Drive the flow and hand back however it settled.
 *
 * The error is captured the moment the flow starts, not after driving it: the rejection
 * happens during `drive`, and an `await` attached afterwards is too late — node calls it an
 * unhandled rejection and fails the run.
 */
async function withFlow(port: number, drive: (base: string, state: string) => Promise<void>): Promise<Error | null> {
  const outcome = createApp({ ...SPEC }, { port, noOpen: true, log: () => {} })
    .then(() => null, (err: Error) => err);
  const base = `http://localhost:${port}`;

  let page = "";
  for (let i = 0; i < 40 && !page; i++) {
    try { page = await (await fetch(base + "/")).text(); } catch { await new Promise((r) => setTimeout(r, 25)); }
  }
  const state = /state=([a-f0-9]+)"/.exec(page)?.[1] ?? "";
  assert.ok(state, "the hand-off page must carry a state");

  await drive(base, state);
  return outcome;
}

test("a callback that did not come from the hand-off is refused", async () => {
  /* The server is listening on localhost while a browser is open, so any page in that browser
     could hit it. The state GitHub echoes back is what distinguishes the real one. */
  const err = await withFlow(4361, async (base) => {
    const res = await fetch(`${base}/callback?code=stolen&state=not-the-one`);
    assert.equal(res.status, 400);
    assert.match(await res.text(), /did not come from the hand-off/);
  });
  assert.match(err?.message ?? "", /state did not match/);
});

test("a callback with no code fails rather than hanging", async () => {
  const err = await withFlow(4362, async (base, state) => {
    const res = await fetch(`${base}/callback?state=${state}`);
    assert.equal(res.status, 400);
  });
  assert.match(err?.message ?? "", /no code/);
});

test("nothing else on the server answers", async () => {
  const err = await withFlow(4363, async (base, state) => {
    assert.equal((await fetch(`${base}/anything`)).status, 404);
    // Close the flow so the test does not leave a listener behind.
    await fetch(`${base}/callback?state=${state}`);
  });
  assert.ok(err, "the flow should still have ended");
});

test("the port being taken is an error, not a hang", async () => {
  const first = createApp(SPEC, { port: 4364, noOpen: true, log: () => {} }).then(() => null, (e: Error) => e);
  for (let i = 0; i < 40; i++) {
    try { await fetch("http://localhost:4364/"); break; } catch { await new Promise((r) => setTimeout(r, 25)); }
  }
  const clash = await createApp(SPEC, { port: 4364, noOpen: true, log: () => {} }).then(() => null, (e: Error) => e);
  assert.match(clash?.message ?? "", /EADDRINUSE/);

  await fetch("http://localhost:4364/callback?state=wrong").catch(() => undefined);
  await first;
});
