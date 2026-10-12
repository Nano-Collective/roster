import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { deflateRawSync, gzipSync } from "node:zlib";
import { untargz, unzip } from "../src/lib/archive.js";
import { buildExport } from "../src/lib/export.js";
import { githubClient } from "../src/lib/github.js";
import { loadComposer, readOrg } from "../src/lib/workspace.js";
import { type Actor, createPortal, handlePortal } from "../src/portal/handler.js";
import { memoryKV } from "../src/portal/kv.js";
import { serveRepos, tar } from "./helpers/githubrepos.js";
import { makeTenant } from "./helpers/tenant.js";

/**
 * The portal with no checkout: the org read from GitHub, through the same handler a Worker runs.
 *
 * GitHub here is a scaffolded tenant on disk served through the API's shapes, so the question
 * every test asks is the one that matters — does the portal show and write what a checkout
 * would have — without the network or anybody's org.
 */

let n = 0;
async function setup() {
  const root = mkdtempSync(join(tmpdir(), "roster-hosted-"));
  const ws = await makeTenant(root, {
    org: "acme",
    staff: [
      { handle: "cto", name: "Chief Technology Officer" },
      { handle: "cmo", name: "Chief Marketing Officer" },
    ],
  });
  const gh = serveRepos("acme", root, ["roster-ops", "cto", "cmo"]);
  const portal = createPortal({
    org: "acme",
    opsName: "roster-ops",
    kv: memoryKV(),
    root: `/@roster-test/${++n}`,
  });
  const as = (canWrite: boolean): Actor => ({ gh, id: "someone", canWrite });
  const get = (path: string, canWrite = false) =>
    handlePortal(new Request(`http://portal${path}`), portal, as(canWrite));
  const post = (path: string, body: unknown, canWrite = true) =>
    handlePortal(
      new Request(`http://portal${path}`, { method: "POST", body: JSON.stringify(body) }),
      portal,
      as(canWrite),
    );
  return { root, ws, gh, portal, get, post };
}

/** Everything but what only git or the clock can say. */
function comparable(data: any) {
  return JSON.parse(
    JSON.stringify(data, (k, v) =>
      [
        "generatedAt",
        "modified",
        "recentCommits",
        "factsChanged",
        "lastCommit",
        "lastMemoryCommit",
      ].includes(k)
        ? undefined
        : v,
    ),
  );
}

test("the org read from GitHub is the org a checkout shows", async () => {
  const { ws, get } = await setup();
  const res = await get("/api/org");
  assert.equal(res?.status, 200);
  const hosted = (await res!.json()) as any;

  const { parseYaml } = await loadComposer(ws.opsDir);
  const disk = buildExport(ws, readOrg(ws.opsDir, parseYaml) as any, parseYaml);
  assert.deepEqual(comparable(hosted).staff, comparable(disk).staff);
  assert.equal(hosted.org, "acme");
  assert.deepEqual(
    hosted.staff.map((s: any) => s.handle),
    ["cto", "cmo"],
  );
});

test("a prompt composes from the snapshot, not from disk", async () => {
  const { get } = await setup();
  const view = (await (await get("/api/prompt?staff=cto&kind=daily"))!.json()) as any;
  assert.equal(view.error, undefined);
  assert.match(view.composed, /Chief Technology Officer/);
  assert.ok(view.layers.length > 1, "the includes were walked");
});

test("a second look asks GitHub only whether anything moved, and a change fetches only it", async () => {
  const { root, gh, get, portal } = await setup();
  await get("/api/org");
  const cold = gh.calls.length;

  await get("/api/org");
  assert.equal(gh.calls.length, cold, "inside a few seconds, nothing is asked at all");

  gh.calls.length = 0;
  await handlePortal(new Request("http://portal/api/sync"), portal, {
    gh,
    id: "x",
    canWrite: false,
  });
  assert.deepEqual(
    gh.calls.filter((c) => !c.endsWith("commits/HEAD")),
    [],
    "unchanged: only the three head checks",
  );

  writeFileSync(join(root, "cto", "CHARTER.md"), "# A charter\n\nWritten by hand.\n");
  gh.calls.length = 0;
  await handlePortal(new Request("http://portal/api/sync"), portal, {
    gh,
    id: "x",
    canWrite: false,
  });
  const blobs = gh.calls.filter((c) => c.includes("/git/blobs/"));
  assert.equal(blobs.length, 1, "one changed file is one blob");
  assert.ok(!gh.calls.some((c) => c.includes("/tarball/")));
  const org = (await (await get("/api/org"))!.json()) as any;
  assert.equal(org.staff.find((s: any) => s.handle === "cto").rig.charterStub, false);
});

test("a save is one commit as the person, against the version that was read", async () => {
  const { root, gh, get, post } = await setup();
  await get("/api/orglayer");
  const before = readFileSync(join(root, "roster-ops", "org", "voice.md"), "utf8");

  const refused = await post("/api/save", { path: "roster-ops/org/voice.md", text: "x" }, false);
  assert.equal(refused?.status, 403);
  assert.equal(gh.writes.length, 0);

  const res = await post("/api/save", {
    path: "roster-ops/org/voice.md",
    text: `${before}\nPlain words.\n`,
  });
  const saved = (await res!.json()) as any;
  assert.equal(res?.status, 200, JSON.stringify(saved));
  assert.equal(saved.committed, true);
  assert.equal(gh.writes.length, 1);
  assert.equal(gh.writes[0]!.path, "org/voice.md");
  assert.ok(gh.writes[0]!.sha, "the write names the version it replaces");

  const noop = (await (await post("/api/save", {
    path: "roster-ops/org/voice.md",
    text: `${before}\nPlain words.\n`,
  }))!.json()) as any;
  assert.equal(noop.note, "no change", "the snapshot already holds what was written");
});

test("a save refuses a file that moved on GitHub since it was read", async () => {
  const { root, get, post } = await setup();
  await get("/api/orglayer");
  const before = readFileSync(join(root, "roster-ops", "org", "voice.md"), "utf8");
  // Somebody else's push, after this page read the file.
  writeFileSync(join(root, "roster-ops", "org", "voice.md"), "# Voice\n\nChanged elsewhere.\n");
  const res = await post("/api/save", {
    path: "roster-ops/org/voice.md",
    text: "# Voice\n\nMine.\n",
    base: before,
  });
  assert.equal(res?.status, 409);
  assert.match(((await res!.json()) as any).error, /changed on GitHub since this page read it/);
});

test("only the files the portal may write can be saved", async () => {
  const { post, gh } = await setup();
  const res = await post("/api/save", { path: "cto/.github/workflows/cto-daily.yaml", text: "x" });
  assert.equal(res?.status, 400);
  assert.match(((await res!.json()) as any).error, /not a file the portal may write/);
  assert.equal(gh.writes.length, 0);
});

test("files outside the org cannot be read through /api/file", async () => {
  const { get } = await setup();
  assert.equal((await get("/api/file?path=../../etc/passwd"))?.status, 404);
  const charter = await get("/api/file?path=cto/CHARTER.md");
  assert.equal(charter?.status, 200);
  assert.match(await charter!.text(), /CHARTER|Charter|charter/);
});

test("with no org there is the setup screen, and the docs", async () => {
  const gh = serveRepos("acme", tmpdir(), []);
  const actor: Actor = { gh, id: "x", canWrite: false };
  const org = await handlePortal(new Request("http://portal/api/org"), null, actor);
  assert.equal(org?.status, 409);
  assert.equal(((await org!.json()) as any).mode, "setup");
  const docs = await handlePortal(new Request("http://portal/api/docs"), null, actor);
  assert.equal(docs?.status, 200);
  assert.equal(await handlePortal(new Request("http://portal/api/doctor"), null, actor), undefined);
});

test("a GET is asked conditionally, and a 304 is answered from what was kept", async () => {
  const seen: Array<string | null> = [];
  const fake = (async (_url: string, init: RequestInit) => {
    const h = init.headers as Record<string, string>;
    seen.push(h["if-none-match"] ?? null);
    if (h["if-none-match"] === '"v1"') return new Response(null, { status: 304 });
    return new Response(JSON.stringify({ n: 1 }), { status: 200, headers: { etag: '"v1"' } });
  }) as unknown as typeof fetch;
  const gh = githubClient("t", { fetch: fake });
  const first = await gh.request("GET", "repos/acme/cto");
  const second = await gh.request("GET", "repos/acme/cto");
  assert.deepEqual(seen, [null, '"v1"']);
  assert.deepEqual(second.data, first.data);
  assert.equal(second.cached, true);
});

test("the API limit is said plainly", async () => {
  const fake = (async () =>
    new Response('{"message":"API rate limit exceeded"}', {
      status: 403,
      headers: { "x-ratelimit-remaining": "0" },
    })) as unknown as typeof fetch;
  const res = await githubClient("t", { fetch: fake }).request("GET", "user");
  assert.equal(res.ok, false);
  assert.match(res.error!, /limit for this hour is used up/);
});

test("a run record unzips, and a tarball untars, with no dependency", async () => {
  const body = Buffer.from(JSON.stringify({ v: 1, cost_usd: 1.5 }));
  const zipped = zip("run.json", deflateRawSync(body), body.length);
  const files = await unzip(new Uint8Array(zipped));
  assert.deepEqual(JSON.parse(Buffer.from(files.get("run.json")!).toString()), {
    v: 1,
    cost_usd: 1.5,
  });

  const tgz = gzipSync(
    tar(
      "acme-cto-abc",
      new Map([
        ["memory/INDEX.md", Buffer.from("# Memory\n")],
        ["big.png", Buffer.alloc(10)],
      ]),
    ),
  );
  const entries = await untargz(new Uint8Array(tgz), (p) => p.endsWith(".md"));
  assert.deepEqual(
    entries.map((e) => [e.path, e.size, e.data ? Buffer.from(e.data).toString() : null]),
    [
      ["memory/INDEX.md", 9, "# Memory\n"],
      ["big.png", 10, null],
    ],
  );
});

/** One deflated entry, in the layout GitHub's artifact zips use. */
function zip(name: string, data: Buffer, size: number): Buffer {
  const nameBuf = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(size, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(size, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);
  const at = 30 + nameBuf.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + nameBuf.length, 12);
  end.writeUInt32LE(at, 16);
  return Buffer.concat([local, nameBuf, data, central, nameBuf, end]);
}
