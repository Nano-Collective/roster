/**
 * The portal on a made-up org, for the screenshots in docs/images and website/public/screens.
 *
 *   npx tsx scripts/demo-portal.ts [port]            then open http://127.0.0.1:4399
 *   npx tsx scripts/demo-portal.ts [port] --setup    the first-run screen instead
 *
 * The real portal reads everything from GitHub, which is the wrong thing to photograph: the
 * screenshots would be somebody's own org. This serves the same page and answers its routes for
 * Acme, a two-person org generated the way the tests generate theirs. What lives in files (the
 * org, each brain, the composed prompt, the docs) comes from that tenant through the same
 * functions the handler calls, so it looks the way a real one does. What lives on GitHub (issues,
 * runs in progress, run history) is written out below, and is the only invented part.
 *
 * Read-only: anything that would write answers with a note saying this is a demo.
 */
import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { initFiles } from "../src/commands/init.js";
import { auditPrompt } from "../src/lib/audit.js";
import { docAsset, docPages, docsDir, searchDocs } from "../src/lib/docs.js";
import { buildExport } from "../src/lib/export.js";
import { promptView } from "../src/lib/prompt.js";
import { AGENTS } from "../src/lib/setup.js";
import { loadComposer, readOrg } from "../src/lib/workspace.js";
import { portalAsset, portalIndex } from "../src/portal/assets.js";
import { workspaceRoots } from "../src/portal/brief.js";
import * as frameworkComposer from "../templates/ops/compose.mjs";
import { makeTenant } from "../test/helpers/tenant.js";

const port = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 4399);
const SETUP = process.argv.includes("--setup");
const compose = frameworkComposer.compose as import("../src/lib/prompt.js").Compose;

/* ---------- Acme, on disk ---------- */

const root = mkdtempSync(join(tmpdir(), "roster-demo-"));
process.once("exit", () => rmSync(root, { recursive: true, force: true }));
const ws = await makeTenant(root, {
  org: "acme",
  staff: [
    { handle: "cto", name: "Chief Technology Officer", dir: "technology", schedule: "0 7 * * 1-5" },
    { handle: "cmo", name: "Chief Marketing Officer", dir: "marketing", schedule: "40 7 * * 1-5" },
  ],
});
// A brain with months in it, rather than the two facts a new one has.
const MEMORY = join(import.meta.dirname, "..", "test", "fixtures", "memory");
for (const dir of ["technology", "marketing"]) {
  rmSync(join(root, dir, "memory"), { recursive: true, force: true });
  cpSync(MEMORY, join(root, dir, "memory"), { recursive: true });
}
// The person they answer to: Sam, rather than the generator's stand-in.
const orgFile = join(ws.opsDir, "org.yaml");
writeFileSync(
  orgFile,
  readFileSync(orgFile, "utf8")
    .replaceAll("someone", "sam")
    .replaceAll("boss", "sam")
    .replace("name: acme", "name: Acme")
    .replace(/^(human:\n {2}name:) sam$/m, "$1 Sam"),
);
const { parseYaml } = await loadComposer(ws.opsDir);
const orgYaml = readOrg(ws.opsDir, parseYaml) as Record<string, any>;
const ORG = JSON.parse(JSON.stringify(buildExport(ws, orgYaml as never, parseYaml))) as Record<
  string,
  any
>;
const STAFF = ORG.staff as Array<Record<string, any>>;
// Set up and running, so Getting started has nothing to offer.
ORG.unfinished = [];
for (const [i, s] of STAFF.entries()) {
  if (s.rig) {
    s.rig.charterStub = false;
    // Not a git checkout, so there is no history to read: as of this morning's run.
    s.rig.lastCommit = { date: new Date(Date.now() - (2 + i) * 3_600_000).toISOString() };
  }
}
const ME = "sam";

/* ---------- Acme, on GitHub: invented, and kept to what the screens show ---------- */

const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const issue = (o: Record<string, any>) => ({
  role: "brain",
  kind: "issue",
  labels: [],
  assignees: [],
  author: "acme-cto[bot]",
  state: "OPEN",
  comments: [],
  reactions: [],
  events: [],
  url: `https://github.com/${o.repo}/issues/${o.number}`,
  createdAt: o.updatedAt,
  ...o,
});

const REPORT_CTO = `**Status: needs you.** Saved searches are live behind a flag; the onboarding flag is yours to call.

## Done
- Shipped saved searches behind a flag (acme/web#212), with the migration run on staging first.
- Fixed the checkout test that failed one run in five: it raced the webhook.

## Needs you
- #41: ship the new onboarding to everyone, or keep the flag a week.

## Next
- Search ranking: recent and starred first, then by how often a result is opened.
- The flaky export test, which has the same race as checkout.`;

const REPORT_CMO = `**Status: on track.** The saved-searches launch post is drafted and waiting on one read.

## Done
- Drafted the launch post for saved searches (#18).
- Wrote the comparison notes against the two tools people ask about most.

## Needs you
- #18: a read and an approve.

## Next
- The comparison page, from those notes, once the launch post is out.`;

const ITEMS = [
  issue({
    repo: "acme/technology",
    number: 1,
    title: "Where we are",
    labels: ["status", "keep-open"],
    body: REPORT_CTO,
    updatedAt: ago(2),
  }),
  issue({
    repo: "acme/marketing",
    number: 1,
    title: "Where we are",
    labels: ["status", "keep-open"],
    author: "acme-cmo[bot]",
    body: REPORT_CMO,
    updatedAt: ago(1.2),
  }),
  issue({
    repo: "acme/technology",
    number: 39,
    title: "Add the STRIPE_KEY secret to acme/web so checkout tests can run in CI",
    labels: ["chore"],
    assignees: [ME],
    body: "The checkout tests skip without it. Settings → Secrets → Actions, name `STRIPE_KEY`, the test-mode key.",
    updatedAt: ago(50),
  }),
  issue({
    repo: "acme/technology",
    number: 41,
    title: "Ship the new onboarding to everyone, or keep it behind the flag for a week?",
    labels: ["decision"],
    assignees: [ME],
    body: "Completion is up from 61% to 74% on the flag. **Default:** ship to everyone on Friday.",
    updatedAt: ago(26),
  }),
  issue({
    repo: "acme/marketing",
    number: 18,
    title: "Launch post for saved searches: a read and an approve",
    labels: ["review"],
    assignees: [ME],
    author: "acme-cmo[bot]",
    body: "Draft in `drafts/saved-searches.md`. 600 words, one screenshot.",
    updatedAt: ago(5),
  }),
  {
    ...issue({
      repo: "acme/web",
      number: 214,
      title: "Search: rank recent and starred results first",
      body: "Ranking behind the same flag as saved searches.",
      updatedAt: ago(3),
    }),
    role: "product",
    kind: "pr",
    checks: "passing",
    mergeable: "MERGEABLE",
    url: "https://github.com/acme/web/pull/214",
  },
  issue({
    repo: "acme/marketing",
    number: 22,
    title: "Which two tools should the comparison page cover?",
    author: ME,
    body: "@cmo which two do people ask about most?",
    lastComment: { author: "acme-cmo[bot]", createdAt: ago(4) },
    comments: [
      { author: "acme-cmo[bot]", createdAt: ago(4), body: "Linear and Jira, by a distance." },
    ],
    updatedAt: ago(4),
  }),
  issue({
    repo: "acme/technology",
    number: 44,
    title: "From the CMO: can saved searches be shared by link?",
    labels: ["from-cmo"],
    author: "acme-cmo[bot]",
    unread: true,
    body: "People asking in the beta channel.",
    updatedAt: ago(1),
  }),
  issue({
    repo: "acme/technology",
    number: 37,
    title: "Checkout test fails one run in five",
    state: "CLOSED",
    closedAt: ago(0.6),
    closedBy: "acme-cto[bot]",
    body: "It raced the webhook.",
    updatedAt: ago(0.6),
  }),
];

const INBOX = {
  repos: [{ name: "web", owner: "acme", role: "product" }],
  fetchedAt: new Date().toISOString(),
  errors: [],
  items: ITEMS,
};

const run = (o: Record<string, any>) => ({
  id: Math.floor(Math.random() * 1e9),
  issue: null,
  status: "completed",
  conclusion: "success",
  url: "https://github.com/acme/technology/actions",
  ...o,
  updatedAt: o.updatedAt ?? o.createdAt,
});
const LIVE = {
  fetchedAt: new Date().toISOString(),
  staff: [
    {
      handle: "cto",
      brain: "acme/technology",
      running: [
        run({
          trigger: "mention",
          issue: 44,
          status: "in_progress",
          conclusion: null,
          createdAt: ago(0.1),
        }),
      ],
      finished: [run({ trigger: "daily", createdAt: ago(3), updatedAt: ago(2.6) })],
      automatic: 1,
      limit: 6,
    },
    {
      handle: "cmo",
      brain: "acme/marketing",
      running: [],
      finished: [run({ trigger: "daily", createdAt: ago(1.6), updatedAt: ago(1.2) })],
      automatic: 0,
      limit: 6,
    },
  ],
};

const history = (handle: string, seed: number) =>
  Array.from({ length: 12 }, (_, i) => {
    const kind = i % 3 === 1 ? "mention" : "daily";
    const fail = handle === "cto" && i === 4;
    const mins = kind === "daily" ? 11 + ((i * seed) % 9) : 2 + ((i + seed) % 4);
    const turns = kind === "daily" ? 30 + ((i * 7 + seed) % 25) : 6 + ((i * 3) % 10);
    return {
      id: 1000 + i,
      kind,
      status: "completed",
      conclusion: fail ? "failure" : "success",
      createdAt: ago(5 + i * 20),
      url: `https://github.com/acme/${handle === "cto" ? "technology" : "marketing"}/actions`,
      minutes: mins,
      record: {
        outcome: fail ? "failure" : "success",
        duration_s: mins * 60,
        turns,
        cost_usd: Math.round(turns * 0.041 * 100) / 100,
      },
    };
  });
const runsFor = (s: Record<string, any>, seed: number) => {
  const runs = history(s.handle, seed);
  const usd = Math.round(runs.reduce((n, r) => n + r.record.cost_usd, 0) * 100) / 100;
  return {
    handle: s.handle,
    name: s.name,
    brain: `acme/${s.dir ?? s.handle}`,
    budget: null,
    spend: { usd, known: runs.length, runs: runs.length },
    runs,
    errors: [],
    pending: 0,
  };
};
const RUNS = (() => {
  const staff = STAFF.map((s, i) => runsFor(s, i + 3));
  const usd = Math.round(staff.reduce((n, s) => n + s.spend.usd, 0) * 100) / 100;
  const runs = staff.reduce((n, s) => n + s.spend.runs, 0);
  return {
    online: true,
    fetchedAt: new Date().toISOString(),
    budget: null,
    spend: { usd, known: runs, runs },
    staff,
    pending: 0,
  };
})();

/* ---------- routes ---------- */

const json = (body: unknown) => ({ type: "application/json", body: JSON.stringify(body) });

function orgLayer() {
  const files: Array<Record<string, unknown>> = [{ path: "org.yaml", group: "org", title: "" }];
  for (const dir of ["org", "prompts"]) {
    for (const f of readdirSync(join(ws.opsDir, dir))
      .filter((x) => x.endsWith(".md"))
      .sort()) {
      const body = readFileSync(join(ws.opsDir, dir, f), "utf8");
      files.push({
        path: `${dir}/${f}`,
        group: dir,
        title:
          body
            .split("\n")
            .find((l) => l.startsWith("# "))
            ?.slice(2)
            .trim() ?? "",
      });
    }
  }
  for (const f of files) f.bytes = statSync(join(ws.opsDir, String(f.path))).size;
  return { files, opsName: ws.opsName };
}

/* Before there is a tenant: a new user, signed in to gh, about to make one in /tmp/acme. */
async function setupRoute(path: string, q: URLSearchParams) {
  const startedIn = "/tmp/acme";
  if (path === "/api/setup/status") {
    return json({
      tenant: { found: false },
      gh: { ok: true, login: "jordan-acme" },
      orgs: ["acme"],
      agents: AGENTS,
      startedIn,
    });
  }
  if (path === "/api/setup/plan") {
    const org = q.get("org") || "acme";
    const files = await initFiles({
      org,
      name: q.get("name") || org,
      human: q.get("human") ?? "",
      marker: q.get("marker") ?? "human",
      opsName: "roster-ops",
      agent: q.get("agent") ?? "claude-code-action",
    });
    return json({ org, dir: join(startedIn, "roster-ops"), files: [...files.keys()].sort() });
  }
  if (path === "/api/session") return json({ login: "jordan-acme", hosted: false });
  if (path.startsWith("/api/setup/")) return json({});
  return json({ mode: "setup", error: "there is no tenant here yet" });
}

function route(path: string, q: URLSearchParams): { type: string; body: string | Buffer } | null {
  switch (path) {
    case "/api/session":
      return json({ login: ME, hosted: false });
    case "/api/org":
      return json(ORG);
    case "/api/inbox":
      return json(INBOX);
    case "/api/live":
      return json(LIVE);
    case "/api/runs":
      return json(RUNS);
    case "/api/thread":
      return json(ITEMS.find((i) => String(i.number) === q.get("number")) ?? ITEMS[0]);
    case "/api/repos":
      return json({ repos: INBOX.repos });
    case "/api/labels":
      return json({ labels: [] });
    case "/api/staff/progress":
      return json({ app: true, publicApp: true, installed: true, credential: true, ran: true });
    case "/api/connectors":
      return json({
        catalogue: [],
        connectors: [],
        staff: STAFF.map((s) => ({ handle: s.handle, name: s.name })),
        signIn: false,
        canWrite: true,
      });
    case "/api/orglayer":
      return json(orgLayer());
    case "/api/docs":
      return json(docPages());
    case "/api/docsearch":
      return json({ hits: searchDocs(q.get("q") ?? "") });
    case "/api/doc": {
      const page = q.get("page") ?? "";
      if (!docPages().some((d) => d.file === page)) return null;
      return {
        type: "text/plain; charset=utf-8",
        body: readFileSync(join(docsDir(), page), "utf8"),
      };
    }
    case "/api/docasset": {
      const a = docAsset(q.get("path") ?? "");
      return a ? { type: a.type, body: readFileSync(a.path) } : null;
    }
    case "/api/file": {
      // Any file in the workspace, as the real route serves it from its snapshot.
      const full = resolve(root, q.get("path") ?? "");
      if (
        relative(root, full).startsWith("..") ||
        !statSync(full, { throwIfNoEntry: false })?.isFile()
      ) {
        return null;
      }
      return { type: "text/plain; charset=utf-8", body: readFileSync(full) };
    }
    case "/api/prompt": {
      const s = STAFF.find((x) => x.handle === q.get("staff"));
      if (!s) return null;
      const view = promptView(
        ws,
        compose,
        s.handle,
        join(root, s.dir ?? s.handle),
        q.get("kind") ?? "daily",
      );
      view.problems = auditPrompt(ws, view, workspaceRoots(orgYaml as never));
      return json(view);
    }
  }
  return null;
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://demo");
  const send = (status: number, type: string, body: string | Buffer) => {
    res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
    res.end(body);
  };
  if (req.method !== "GET")
    return send(
      200,
      "application/json",
      JSON.stringify({ ok: false, error: "This is a demo: nothing is written." }),
    );
  if (url.pathname === "/" || url.pathname === "/index.html")
    return send(200, "text/html; charset=utf-8", portalIndex());
  if (url.pathname.startsWith("/assets/")) {
    const a = portalAsset(url.pathname.slice("/assets/".length));
    return a ? send(200, a.type, a.body) : send(404, "text/plain", "not found");
  }
  if (url.pathname.startsWith("/api/")) {
    try {
      if (SETUP && !url.pathname.startsWith("/api/doc")) {
        const r = await setupRoute(url.pathname, url.searchParams);
        return send(200, r.type, r.body);
      }
      const r = route(url.pathname, url.searchParams);
      return r ? send(200, r.type, r.body) : send(404, "application/json", "{}");
    } catch (err) {
      return send(
        500,
        "application/json",
        JSON.stringify({ error: String((err as Error).message) }),
      );
    }
  }
  send(404, "text/plain", "not found");
}).listen(port, "127.0.0.1", () => console.log(`Acme demo portal: http://127.0.0.1:${port}`));
