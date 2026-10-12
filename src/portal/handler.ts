import { join, resolve } from "node:path";
// @ts-expect-error: vendored plain JS, with no types on purpose
import * as frameworkComposer from "../../templates/ops/compose.mjs";
import { type ActRequest, act } from "../lib/act.js";
import { amendBrief } from "../lib/amend.js";
import { attachPath, MAX_UPLOAD } from "../lib/attach.js";
import { auditPrompt } from "../lib/audit.js";
import { docAsset, docPages, docsDir, searchDocs } from "../lib/docs.js";
import { CHARTER_EXAMPLES, charterStarter, matchExample } from "../lib/examples.js";
import { buildExport, readManifest } from "../lib/export.js";
import type { GitHub } from "../lib/github.js";
import { fetchInbox, fetchThread } from "../lib/inbox.js";
import { liveFor } from "../lib/live.js";
import { markRead, unreadFor } from "../lib/notifications.js";
import { parsePaste } from "../lib/paste.js";
import { isWritable, KINDS, promptView, validateOrgYaml } from "../lib/prompt.js";
import { orgTokens, specFromManifest, tokensFor } from "../lib/render.js";
import { dailyWorkflow, dispatch, findDispatched, runState } from "../lib/runonce.js";
import { budgetOf, spend, staffRuns } from "../lib/runs.js";
import { unfinished } from "../lib/setup.js";
import { existsSync, mount, readFileSync, statSync } from "../lib/vfs.js";
import { readOrg, type Workspace } from "../lib/workspace.js";
import { buildPasteBrief, orgSpec, workspaceRoots } from "./brief.js";
import { type BrainHistory, loadedHistory, loadHistory } from "./history.js";
import type { KeyValue } from "./kv.js";
import { Snapshots } from "./snapshot.js";

/**
 * The portal, as a function from a request to a response.
 *
 * Everything here runs the same on your machine and on a Worker: it reads the org through
 * snapshots of its repositories on GitHub (`snapshot.ts`), mounted where a checkout would be,
 * and it acts through a GitHub client holding the person's own token. No `gh`, no `git`, no disk.
 *
 * What it does not do is anything that needs a checkout to exist: standing up a tenant, hiring,
 * retiring, the GitHub App hand-off, doctor. Those stay in the local server (`node.ts`), which
 * calls this first and handles only what this declines.
 */

const compose = frameworkComposer.compose as import("../lib/prompt.js").Compose;
const parseYaml = frameworkComposer.parseYaml as (t: string, f?: string) => Record<string, any>;

/** One org's portal: where its snapshots are mounted, and what is cached across requests. */
export interface Portal {
  org: string;
  /** The ops repository's name, which is also its directory in the workspace. */
  opsName: string;
  ws: Workspace;
  snapshots: Snapshots;
  kv: KeyValue;
  /** How a command is spelled back to the person: `roster`, or the npx form. */
  bin: string;
  /** Short-lived answers, so switching views does not ask GitHub again. Per person where it differs. */
  caches: {
    inbox: Map<string, { at: number; body: string }>;
    labels: Map<string, { at: number; labels: unknown[] }>;
    runs: { at: number; body: unknown } | null;
    progress: Map<string, { at: number; body: unknown }>;
    files: Map<string, Uint8Array>;
  };
}

/** Who is asking, and whether this request may write. Decided by whichever server calls this. */
export interface Actor {
  gh: GitHub;
  /** What per-person caches are keyed by: a login hosted, "local" on your own machine. */
  id: string;
  /** True only for a request that has passed the server's own write guard. */
  canWrite: boolean;
  /** Where work that outlives the response goes. A Worker passes its waitUntil. */
  background?: (work: Promise<unknown>) => void;
}

const TTL = 45_000;
const LABEL_TTL = 300_000;

export function createPortal(opts: {
  org: string;
  opsName: string;
  kv: KeyValue;
  bin?: string;
  /** Where the snapshots are mounted. One org per prefix. */
  root?: string;
}): Portal {
  const root = opts.root ?? `/@roster/${opts.org}`;
  const snapshots = new Snapshots(opts.kv);
  mount(
    root,
    snapshots.tree((repo) => repo.slice(repo.indexOf("/") + 1)),
  );
  return {
    org: opts.org,
    opsName: opts.opsName,
    ws: { root, opsDir: join(root, opts.opsName), opsName: opts.opsName },
    snapshots,
    kv: opts.kv,
    bin: opts.bin ?? "roster",
    caches: {
      inbox: new Map(),
      labels: new Map(),
      runs: null,
      progress: new Map(),
      files: new Map(),
    },
  };
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Answer one request, or return undefined when it is not one this handles, so the caller can
 * try its own routes.
 */
export async function handlePortal(
  req: Request,
  portal: Portal | null,
  actor: Actor,
): Promise<Response | undefined> {
  const url = new URL(req.url);
  const p = url.pathname;
  try {
    const route = ROUTES[p];
    if (!route) return undefined;
    /* Without an org there is nothing to read but the docs. The page knows this answer: it is
       the one that sends it to the setup screen. */
    if (!portal && !DOCS.has(p)) {
      return json({ mode: "setup", error: "there is no tenant here yet" }, 409);
    }
    return await route({ req, url, portal: portal!, actor });
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    return json({ error: String((err as Error)?.message ?? err) }, 500);
  }
}

interface Ctx {
  req: Request;
  url: URL;
  portal: Portal;
  actor: Actor;
}

type Route = (c: Ctx) => Promise<Response>;

/* ------------------------------------------------------------------------------------------ */
/* Bringing the snapshots up to date                                                           */
/* ------------------------------------------------------------------------------------------ */

/**
 * The ops repository and every brain, current as of a few seconds ago.
 *
 * Every route that reads the org calls this first. It costs a conditional request per repo at
 * most every few seconds, and those are free when nothing moved.
 */
async function ready(c: Ctx, opts: { force?: boolean; products?: boolean } = {}) {
  const { portal, actor } = c;
  const ops = await portal.snapshots.refresh(actor.gh, `${portal.org}/${portal.opsName}`, opts);
  if (!ops.ok) {
    throw new HttpError(
      ops.status === 404 || ops.status === 401 ? ops.status : 502,
      `could not read ${portal.org}/${portal.opsName}: ${ops.error}`,
    );
  }
  const org = readOrg(portal.ws.opsDir, parseYaml) as any;
  const brains = (org.staff ?? []).map((s: any) => String(s.dir ?? s.handle));
  const products = opts.products
    ? (org.repos ?? [])
        .map((r: any) => String(r.name))
        .filter((n: string) => n !== portal.opsName && !brains.includes(n))
    : [];
  const results = await Promise.all([
    ...brains.map((d: string) =>
      portal.snapshots
        .refresh(actor.gh, `${portal.org}/${d}`, { force: opts.force })
        .then((r) => ({ dir: d, ...r })),
    ),
    ...products.map((d: string) =>
      portal.snapshots
        .refresh(actor.gh, `${portal.org}/${d}`, { force: opts.force, pathsOnly: true })
        .then((r) => ({ dir: d, ...r })),
    ),
  ]);
  return { org, brains, results: [{ dir: portal.opsName, ...ops }, ...results] };
}

/**
 * org.yaml, read with somebody's own token, or null when they cannot read the ops repository.
 * For deciding whether a GitHub login may use a hosted portal at all.
 */
export async function readOrgFor(portal: Portal, gh: GitHub): Promise<Record<string, any> | null> {
  const ops = await portal.snapshots.refresh(gh, `${portal.org}/${portal.opsName}`, {
    force: true,
  });
  if (!ops.ok) return null;
  return readOrg(portal.ws.opsDir, parseYaml) as Record<string, any>;
}

/* ------------------------------------------------------------------------------------------ */
/* Routes                                                                                      */
/* ------------------------------------------------------------------------------------------ */

const DOCS = new Set(["/api/docs", "/api/docsearch", "/api/doc", "/api/docasset"]);

/** Whether a path is one this handler answers, for a server deciding where to send it. */
export function isPortalRoute(path: string): boolean {
  return Object.hasOwn(ROUTES, path);
}

const ROUTES: Record<string, Route> = {
  /* The docs ship with the framework, so they are served from there rather than the tenant. */
  "/api/docs": async () => json(docPages()),

  "/api/docsearch": async ({ url }) => json({ hits: searchDocs(url.searchParams.get("q") ?? "") }),

  "/api/doc": async ({ url }) => {
    const page = url.searchParams.get("page") ?? "";
    // Only a page the listing offered: the name is attacker-controlled.
    if (!docPages().some((d) => d.file === page)) return notFound();
    return text(readFileSync(join(docsDir(), page), "utf8"), "text/plain; charset=utf-8");
  },

  "/api/docasset": async ({ url }) => {
    const asset = docAsset(url.searchParams.get("path") ?? "");
    if (!asset) return notFound();
    return new Response(new Uint8Array(readFileSync(asset.path)), {
      headers: { "content-type": asset.type, "cache-control": "public, max-age=86400" },
    });
  },

  "/api/org": async (c) => {
    const { portal, actor } = c;
    const { org, brains } = await ready(c);
    // History is per head commit and kept, so this asks GitHub only after an agent has pushed.
    const byRoot = new Map<string, BrainHistory>();
    await Promise.all(
      brains.map(async (dir: string) => {
        const repo = `${portal.org}/${dir}`;
        const snap = portal.snapshots.get(repo);
        if (!snap) return;
        byRoot.set(
          join(portal.ws.root, dir),
          await loadHistory(actor.gh, portal.kv, repo, snap.sha),
        );
      }),
    );
    const data = buildExport(portal.ws, org, parseYaml, { history: loadedHistory(byRoot) });
    const left = unfinished(portal.ws.opsDir, (org.staff ?? []).length);
    return json({ ...data, unfinished: left });
  },

  /* Every file in the org layer the portal may write: isWritable's allowlist, nothing more. */
  "/api/orglayer": async (c) => {
    const { portal } = c;
    const { brains } = await ready(c);
    const ws = portal.ws;
    const listMd = (dir: string, prefix: string) => {
      const names = portal.snapshots.get(`${portal.org}/${portal.opsName}`)?.dirs.get(dir);
      return [...(names ?? [])]
        .filter((f) => f.endsWith(".md"))
        .sort()
        .map((f) => prefix + f);
    };
    const files = ["org.yaml", ...listMd("org", "org/"), ...listMd("prompts", "prompts/")]
      .filter((rel) => isWritable(ws, `${ws.opsName}/${rel}`, brains))
      .map((rel) => {
        const full = join(ws.opsDir, rel);
        const body = readFileSync(full, "utf8");
        return {
          path: rel,
          bytes: statSync(full).size,
          group: rel.startsWith("prompts/") ? "prompts" : "org",
          title: rel.endsWith(".md")
            ? (body
                .split("\n")
                .find((l) => l.startsWith("# "))
                ?.slice(2)
                .trim() ?? "")
            : "",
        };
      });
    return json({ files, opsName: ws.opsName });
  },

  /* What a staff member is actually sent, and the files it was made of. */
  "/api/prompt": async (c) => {
    const { url, portal } = c;
    const { org } = await ready(c, { products: true });
    const handle = url.searchParams.get("staff") ?? "";
    const kind = url.searchParams.get("kind") ?? "daily";
    const entry = (org.staff ?? []).find((s: any) => s.handle === handle);
    if (!entry || !(KINDS as readonly string[]).includes(kind)) return bad();
    const brainDir = join(portal.ws.root, entry.dir ?? entry.handle);
    try {
      const view = promptView(portal.ws, compose, handle, brainDir, kind);
      view.problems = auditPrompt(portal.ws, view, workspaceRoots(org));
      return json(view);
    } catch (err) {
      // A prompt that will not compose is the most useful thing this screen can show.
      return json({ staff: handle, kind, error: String((err as Error).message) });
    }
  },

  "/api/promptaudit": async (c) => {
    const { url, portal } = c;
    const { org } = await ready(c, { products: true });
    const handle = url.searchParams.get("staff") ?? "";
    const entry = (org.staff ?? []).find((s: any) => s.handle === handle);
    if (!entry) return bad();
    const brainDir = join(portal.ws.root, entry.dir ?? entry.handle);
    const roots = workspaceRoots(org);
    const found = new Map<string, any>();
    const errors: Array<{ kind: string; error: string }> = [];
    for (const kind of KINDS) {
      try {
        const view = promptView(portal.ws, compose, handle, brainDir, kind);
        for (const p of auditPrompt(portal.ws, view, roots)) {
          // The same stub is a finding on every prompt. One row, and it says which.
          const key = `${p.id}|${p.path ?? ""}|${p.title}`;
          const seen = found.get(key);
          if (seen) seen.kinds.push(kind);
          else found.set(key, { ...p, kind, kinds: [kind] });
        }
      } catch (err) {
        errors.push({ kind, error: String((err as Error).message) });
      }
    }
    return json({ staff: handle, problems: [...found.values()], errors });
  },

  "/api/charter-example": async (c) => {
    const { url } = c;
    const { org } = await ready(c);
    const handle = url.searchParams.get("staff") ?? "";
    const entry = (org.staff ?? []).find((s: any) => s.handle === handle);
    const asked = url.searchParams.get("kind") ?? matchExample(handle, entry?.name ?? "");
    if (!asked || !(CHARTER_EXAMPLES as readonly string[]).includes(asked)) {
      return json({ kind: null, text: "" });
    }
    return json({ kind: asked, text: charterStarter(asked, String(org.name ?? org.org)) });
  },

  /* What only GitHub knows about a staff member's setup. Cached for a minute. */
  "/api/staff/progress": async (c) => {
    const { url, portal, actor } = c;
    const handle = url.searchParams.get("staff") ?? "";
    const hit = portal.caches.progress.get(handle);
    if (url.searchParams.get("fresh") !== "1" && hit && Date.now() - hit.at < 60_000) {
      return json(hit.body);
    }
    const { org } = await ready(c);
    const entry = (org.staff ?? []).find((s: any) => s.handle === handle);
    if (!entry) return json({ error: `no staff member "${handle}"` }, 400);
    const dir = entry.dir ?? entry.handle;
    const spec = specFromManifest(readManifest(join(portal.ws.root, dir), parseYaml) as any, dir);
    try {
      const body = await staffProgress(actor.gh, org.org, spec, dailyWorkflow(entry.handle));
      portal.caches.progress.set(handle, { at: Date.now(), body });
      return json(body);
    } catch {
      return json({ app: null, publicApp: null, installed: null, credential: null, ran: null });
    }
  },

  /* One daily run, now. The repo and the workflow come from the manifest, never the request. */
  "/api/run/start": async (c) => {
    const { req, portal, actor } = c;
    if (!actor.canWrite) return refuse();
    const payload = (await body(req)) as { staff?: string };
    const brain = await brainOf(c, payload.staff ?? "");
    const workflow = dailyWorkflow(payload.staff ?? "");
    const since = Date.now();
    const started = await dispatch(actor.gh, brain, workflow);
    if (!started.ok) return json({ error: `could not start ${workflow}: ${started.error}` }, 400);
    const run = await findDispatched(actor.gh, brain, workflow, since);
    portal.caches.runs = null;
    return json({
      ok: true,
      id: run?.databaseId,
      url: run?.url ?? `https://github.com/${brain}/actions/workflows/${workflow}`,
    });
  },

  "/api/run/state": async (c) => {
    const { url, actor } = c;
    const brain = await brainOf(c, url.searchParams.get("staff") ?? "");
    return json(await runState(actor.gh, brain, Number(url.searchParams.get("id"))));
  },

  /* The copy-a-prompt half of authoring, with every file it refers to inlined. */
  "/api/brief": async (c) => {
    const { url, portal } = c;
    await ready(c);
    const kind = url.searchParams.get("kind") ?? "";
    try {
      const brief = buildPasteBrief(
        portal.ws,
        parseYaml,
        kind,
        url.searchParams.get("staff") ?? "",
        url.searchParams.get("example") ?? undefined,
        url.searchParams.get("about") ?? undefined,
      );
      return json({
        kind,
        text: brief.text,
        targets: brief.targets.map((t) => t.path),
        example: brief.example,
        examples: kind === "charter" ? [...CHARTER_EXAMPLES, "none"] : undefined,
      });
    } catch (err) {
      return json({ error: String((err as Error).message) }, 400);
    }
  },

  /* The paste-back half. Parses, never writes: saving is a second click through /api/save. */
  "/api/paste": async (c) => {
    const { req, portal } = c;
    if (req.method !== "POST") return new Response("POST only", { status: 405 });
    const { brains } = await ready(c);
    const payload = (await body(req)) as { kind?: string; staff?: string; answer?: string };
    try {
      const brief = buildPasteBrief(portal.ws, parseYaml, payload.kind ?? "", payload.staff ?? "");
      const result = parsePaste(payload.answer ?? "", brief.targets);
      const before = new Map(brief.targets.map((t) => [t.path, t.before]));
      return json({
        ...result,
        files: result.files.map((f) => ({
          ...f,
          before: before.get(f.path) ?? "",
          writable: isWritable(portal.ws, f.path, brains),
        })),
      });
    } catch (err) {
      return json({ error: String((err as Error).message) }, 400);
    }
  },

  "/api/amend": async (c) => {
    const { url, portal } = c;
    const { org, brains } = await ready(c);
    const handle = url.searchParams.get("staff") ?? "";
    const kind = url.searchParams.get("kind") ?? "daily";
    const entry = (org.staff ?? []).find((s: any) => s.handle === handle);
    if (!entry || !(KINDS as readonly string[]).includes(kind)) return bad();
    const dir = entry.dir ?? entry.handle;
    const view = promptView(portal.ws, compose, handle, join(portal.ws.root, dir), kind);
    const manifest = join(portal.ws.root, dir, "staff.yaml");
    const tokens = existsSync(manifest)
      ? tokensFor(
          orgSpec(org, portal.ws),
          specFromManifest(parseYaml(readFileSync(manifest, "utf8"), "staff.yaml") as any, dir),
        )
      : orgTokens(orgSpec(org, portal.ws));
    const want = url.searchParams.get("want") ?? "";
    return text(
      amendBrief(portal.ws, view, tokens, want, amendTargets(portal.ws, view, brains)),
      "text/plain; charset=utf-8",
    );
  },

  "/api/amend/check": async (c) => {
    const { req, portal } = c;
    if (req.method !== "POST") return new Response("POST only", { status: 405 });
    const { org, brains } = await ready(c);
    const payload = (await body(req)) as { staff?: string; kind?: string; answer?: string };
    const entry = (org.staff ?? []).find((s: any) => s.handle === payload.staff);
    const kind = payload.kind ?? "daily";
    if (!entry || !(KINDS as readonly string[]).includes(kind))
      return json({ error: "bad request" }, 400);
    const dir = entry.dir ?? entry.handle;
    const view = promptView(portal.ws, compose, entry.handle, join(portal.ws.root, dir), kind);
    const targets = amendTargets(portal.ws, view, brains).map((path) => ({
      path,
      before: existsSync(join(portal.ws.root, path))
        ? readFileSync(join(portal.ws.root, path), "utf8")
        : "",
    }));
    const result = parsePaste(payload.answer ?? "", targets);
    const before = new Map(targets.map((t) => [t.path, t.before]));
    return json({
      ...result,
      files: result.files.map((f) => ({
        ...f,
        before: before.get(f.path) ?? "",
        writable: isWritable(portal.ws, f.path, brains),
      })),
    });
  },

  /* Editing a prompt layer or a charter: one commit, as the person, straight to GitHub. */
  "/api/save": async (c) => {
    const { req, portal, actor } = c;
    if (!actor.canWrite) return refuse();
    const { brains } = await ready(c, { force: true });
    const payload = (await body(req)) as {
      path?: string;
      text?: string;
      message?: string;
      base?: string;
    };
    if (!payload.path || typeof payload.text !== "string") {
      return json({ error: "path and text are required" }, 400);
    }
    if (!isWritable(portal.ws, payload.path, brains)) {
      return json({ error: `${payload.path} is not a file the portal may write` }, 400);
    }
    if (payload.path.endsWith("org.yaml")) {
      const wrong = validateOrgYaml(payload.text, parseYaml);
      if (wrong) return json({ error: wrong }, 400);
    }
    const [dir, ...rest] = payload.path.split("/");
    const message = payload.message || `portal: edit ${payload.path.split("/").slice(1).join("/")}`;
    const base = typeof payload.base === "string" ? payload.base : undefined;
    return json(
      await commitFile(portal, actor.gh, dir!, rest.join("/"), payload.text, message, base),
    );
  },

  /* Acting on GitHub as the person: reply, close, reopen, open, approve, merge, ask. */
  "/api/act": async (c) => {
    const { req, portal, actor } = c;
    if (!actor.canWrite) return refuse();
    const { org } = await ready(c);
    const payload = (await body(req)) as ActRequest;
    const known = (org.repos ?? []).map((r: any) => `${org.org}/${r.name}`);
    if (!known.includes(payload.repo)) {
      return json({ error: `${payload.repo} is not a repo in org.yaml` }, 400);
    }
    // An ask touches two repositories, and the second is checked by the same rule.
    if (payload.action === "ask" && !known.includes(payload.ask?.pr?.repo ?? "")) {
      return json({ error: `${payload.ask?.pr?.repo ?? ""} is not a repo in org.yaml` }, 400);
    }
    try {
      const result = await act(actor.gh, payload);
      portal.caches.inbox.delete(actor.id); // the inbox is now wrong
      return json(result);
    } catch (err) {
      return json({ error: String((err as Error)?.message ?? err) }, 400);
    }
  },

  /* A file dropped onto an issue, committed into the repo the issue lives in. */
  "/api/upload": async (c) => {
    const { req, portal, actor } = c;
    if (!actor.canWrite) return refuse();
    const length = Number(req.headers.get("content-length") ?? 0);
    // Base64 costs a third on top, and the cap is on the file rather than the envelope.
    if (length > Math.ceil(MAX_UPLOAD * 1.4)) return json({ error: "body too large" }, 400);
    await ready(c);
    const payload = (await body(req)) as { repo?: string; name?: string; data?: string };
    const repo = payload.repo ?? "";
    const known = knownRepos(portal).find((r) => `${r.owner}/${r.name}` === repo);
    if (!known) return json({ error: `${repo} is not a repo in org.yaml` }, 400);
    if (!payload.name) return json({ error: "a file needs a name" }, 400);
    try {
      return json(await upload(actor.gh, repo, payload.name, payload.data ?? ""));
    } catch (err) {
      return json({ error: String((err as Error).message) }, 400);
    }
  },

  /* There is nothing to pull: this is "look again now", for the refresh button. */
  "/api/sync": async (c) => {
    const { results } = await ready(c, { force: true });
    return json({
      results: results.map((r: any) => ({
        dir: r.dir,
        behind: 0,
        ahead: 0,
        dirty: false,
        pulled: Boolean(r.changed),
        ...(r.ok ? {} : { error: r.error }),
      })),
    });
  },

  "/api/repos": async (c) => {
    await ready(c);
    return json({ repos: knownRepos(c.portal) });
  },

  "/api/labels": async (c) => {
    const { url, portal, actor } = c;
    await ready(c);
    const repo = url.searchParams.get("repo") ?? "";
    if (!knownRepos(portal).some((r) => `${r.owner}/${r.name}` === repo)) return bad();
    const hit = portal.caches.labels.get(repo);
    if (hit && Date.now() - hit.at < LABEL_TTL) return json({ labels: hit.labels });
    const res = await actor.gh.request<Array<{ name: string; color: string; description: string }>>(
      "GET",
      `repos/${repo}/labels?per_page=100`,
    );
    if (!res.ok) return json({ labels: [], error: res.error });
    const labels = (res.data ?? []).map((l) => ({
      name: l.name,
      color: l.color,
      description: l.description ?? "",
    }));
    portal.caches.labels.set(repo, { at: Date.now(), labels });
    return json({ labels });
  },

  /* Opening a thread marks it read on GitHub; the cached inbox is updated in place. */
  "/api/notifications/read": async (c) => {
    const { req, portal, actor } = c;
    if (req.method !== "POST") return notFound();
    if (!actor.canWrite) return refuse();
    const payload = (await body(req)) as { thread?: string; ref?: string };
    const ok = await markRead(actor.gh, String(payload.thread ?? ""));
    const cache = portal.caches.inbox.get(actor.id);
    if (ok && cache && payload.ref) {
      const data = JSON.parse(cache.body);
      for (const i of data.items ?? [])
        if (`${i.repo}#${i.number}` === payload.ref) i.unread = null;
      portal.caches.inbox.set(actor.id, { at: cache.at, body: JSON.stringify(data) });
    }
    return json({ ok });
  },

  "/api/inbox": async (c) => {
    const { url, portal, actor } = c;
    const fresh = url.searchParams.get("refresh") === "1";
    const cache = portal.caches.inbox.get(actor.id);
    if (!fresh && cache && Date.now() - cache.at < TTL) return text(cache.body, JSON_TYPE);
    const { org } = await ready(c);
    const repos = knownRepos(portal);
    const [data, unread] = await Promise.all([
      fetchInbox(actor.gh, repos),
      unreadFor(actor.gh, org.org).catch(() => new Map()),
    ]);
    const out = JSON.stringify({
      ...data,
      // Marked from GitHub's notifications, so unread here is unread there.
      items: data.items.map((i) => ({ ...i, unread: unread.get(`${i.repo}#${i.number}`) ?? null })),
      repos,
      fetchedAt: new Date().toISOString(),
    });
    portal.caches.inbox.set(actor.id, { at: Date.now(), body: out });
    return text(out, JSON_TYPE);
  },

  /* Who is running right now. Polled every few seconds, never cached here: the run lists are
     conditional requests, so a poll that finds nothing new costs nothing. */
  "/api/live": async (c) => {
    const { portal, actor } = c;
    const { org } = await ready(c);
    const staff = (org.staff ?? []).map((s: any) => {
      const dir = s.dir ?? s.handle;
      let m: Record<string, any> = {};
      try {
        m = readManifest(join(portal.ws.root, dir), parseYaml) as Record<string, any>;
      } catch {
        // A manifest that does not parse is a doctor finding; this still lists the brain.
      }
      return {
        handle: String(s.handle),
        brain: String(m.brain ?? `${org.org}/${dir}`),
        limit: Number(m.max_runs_per_day ?? 6),
      };
    });
    try {
      return json({ fetchedAt: new Date().toISOString(), staff: await liveFor(actor.gh, staff) });
    } catch (err) {
      return json({ error: String((err as Error)?.message ?? err), staff: [] });
    }
  },

  /* Every staff member's recent runs, and what the last 30 days cost. */
  "/api/runs": async (c) => {
    const { url, portal, actor } = c;
    const fresh = url.searchParams.get("refresh") === "1";
    const kept = portal.caches.runs;
    if (!fresh && kept && Date.now() - kept.at < TTL) return json(kept.body);
    const { org } = await ready(c);
    const staff = await Promise.all(
      (org.staff ?? []).map(async (s: any) => {
        const brain = `${org.org}/${s.dir ?? s.handle}`;
        // At once, with the costs already known; the rest arrive in the background.
        const { runs, errors, pending } = await staffRuns(actor.gh, brain, s.handle, 30, {
          wait: false,
          background: actor.background,
        });
        return {
          handle: s.handle,
          name: s.name ?? s.handle,
          brain,
          budget: budgetOf(s.budget),
          spend: spend(runs),
          runs,
          errors,
          pending,
        };
      }),
    );
    const total = { usd: 0, known: 0, runs: 0 };
    for (const s of staff) {
      total.usd = Math.round((total.usd + s.spend.usd) * 100) / 100;
      total.known += s.spend.known;
      total.runs += s.spend.runs;
    }
    const pending = staff.reduce((n: number, s: { pending: number }) => n + s.pending, 0);
    const out = {
      online: true,
      fetchedAt: new Date().toISOString(),
      budget: budgetOf(org.budget),
      spend: total,
      staff,
      // Costs still being read. The screen asks again until this is 0.
      pending,
    };
    // Only a complete answer is kept: a partial one would hide the costs as they arrive.
    if (!pending) portal.caches.runs = { at: Date.now(), body: out };
    return json(out);
  },

  /* One pull request in the detail the inbox does not carry: its commits and patches. */
  "/api/pr": async (c) => {
    const { url, portal, actor } = c;
    await ready(c);
    const repo = url.searchParams.get("repo") ?? "";
    const number = Number(url.searchParams.get("number"));
    const allowed = knownRepos(portal).some((r) => `${r.owner}/${r.name}` === repo);
    if (!allowed || !Number.isInteger(number) || number <= 0) return bad();
    const [pr, commits, files] = await Promise.all([
      actor.gh.request<any>("GET", `repos/${repo}/pulls/${number}`),
      actor.gh.request<any[]>("GET", `repos/${repo}/pulls/${number}/commits?per_page=100`),
      actor.gh.request<any[]>("GET", `repos/${repo}/pulls/${number}/files?per_page=100`),
    ]);
    if (!pr.ok) return json({ error: pr.error });
    return json({
      base: pr.data.base?.ref,
      head: pr.data.head?.ref,
      draft: !!pr.data.draft,
      // Passed through as null rather than flattened to false, which would read as a conflict.
      mergeable: pr.data.mergeable,
      mergeState: pr.data.mergeable_state,
      additions: pr.data.additions,
      deletions: pr.data.deletions,
      changedFiles: pr.data.changed_files,
      commits: (commits.data ?? []).map((x: any) => ({
        sha: String(x.sha).slice(0, 7),
        subject: String(x.commit?.message ?? "").split("\n")[0],
        author: x.author?.login ?? x.commit?.author?.name ?? "",
        date: x.commit?.author?.date,
        url: x.html_url,
      })),
      files: (files.data ?? []).map((f: any) => ({
        path: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        patch: f.patch ?? "",
      })),
      errors: [commits, files].filter((r) => !r.ok).map((r) => r.error),
    });
  },

  "/api/thread": async (c) => {
    const { url, portal, actor } = c;
    await ready(c);
    const repo = url.searchParams.get("repo") ?? "";
    const number = Number(url.searchParams.get("number"));
    const kind = url.searchParams.get("kind") === "pr" ? "pr" : "issue";
    const allowed = knownRepos(portal).some((r) => `${r.owner}/${r.name}` === repo);
    if (!allowed || !Number.isInteger(number) || number <= 0) return bad();
    try {
      const thread = await fetchThread(actor.gh, repo, number, kind);
      portal.caches.inbox.delete(actor.id);
      return json(thread);
    } catch (err) {
      return json({ error: String((err as Error)?.message ?? err) }, 502);
    }
  },

  /* One commit's diff of one file in a brain, in the shape `git show` gave the page. */
  "/api/diff": async (c) => {
    const { url, portal, actor } = c;
    const { brains } = await ready(c);
    const dir = url.searchParams.get("dir") ?? "";
    const sha = url.searchParams.get("sha") ?? "";
    const path = url.searchParams.get("path") ?? "memory/INDEX.md";
    if (!brains.includes(dir) || !/^[0-9a-f]{7,40}$/i.test(sha)) return bad();
    const res = await actor.gh.request<any>("GET", `repos/${portal.org}/${dir}/commits/${sha}`);
    if (!res.ok) return json({ error: res.error }, 502);
    const author = res.data.commit?.author ?? {};
    const subject = String(res.data.commit?.message ?? "").split("\n")[0];
    const file = (res.data.files ?? []).find((f: any) => f.filename === path);
    const diff = file?.patch
      ? `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${file.patch}\n`
      : "";
    return text(
      `${author.name ?? ""}\x1f${author.date ?? ""}\x1f${subject}\n\n${diff}`,
      "text/plain; charset=utf-8",
    );
  },

  /* Any file in the org, as it is on GitHub. Media can be asked for by byte range. */
  "/api/file": async (c) => {
    const { req, url, portal, actor } = c;
    await ready(c, { products: true });
    const rel = url.searchParams.get("path") ?? "";
    const full = resolve(portal.ws.root, rel);
    if (!full.startsWith(`${resolve(portal.ws.root)}/`) || !existsSync(full)) return notFound();
    const st = statSync(full);
    if (st.isDirectory()) return notFound();
    const inside = full.slice(portal.ws.root.length + 1);
    const dir = inside.slice(0, inside.indexOf("/"));
    const path = inside.slice(dir.length + 1);
    const type = MIME[extOf(path)] ?? "application/octet-stream";

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(readFileSync(full));
    } catch {
      // Not held in memory, being binary or large: fetched from GitHub when it is opened.
      const snap = portal.snapshots.get(`${portal.org}/${dir}`);
      const key = `${dir}@${snap?.sha}:${path}`;
      let got = portal.caches.files.get(key);
      if (!got) {
        const res = await actor.gh.request<Uint8Array>(
          "GET",
          `repos/${portal.org}/${dir}/contents/${encodePath(path)}?ref=${snap?.sha ?? "HEAD"}`,
          { accept: "application/vnd.github.raw", as: "bytes" },
        );
        if (!res.ok || !res.data) return json({ error: res.error }, 502);
        got = res.data;
        remember(portal.caches.files, key, got);
      }
      bytes = got;
    }

    // A <video> that cannot ask for a byte range cannot seek, and Safari will not play it.
    if (SEEKABLE.test(type)) {
      const size = bytes.length;
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
      if (range) {
        const start = range[1] ? Number(range[1]) : 0;
        const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
        if (!(start <= end && start < size)) {
          return new Response(null, {
            status: 416,
            headers: { "content-range": `bytes */${size}` },
          });
        }
        return new Response(bytes.slice(start, end + 1), {
          status: 206,
          headers: {
            "content-type": type,
            "content-range": `bytes ${start}-${end}/${size}`,
            "accept-ranges": "bytes",
            "cache-control": "no-store",
          },
        });
      }
      return new Response(bytes, {
        headers: { "content-type": type, "accept-ranges": "bytes", "cache-control": "no-store" },
      });
    }
    return new Response(bytes, { headers: { "content-type": type, "cache-control": "no-store" } });
  },
};

/* ------------------------------------------------------------------------------------------ */
/* Helpers                                                                                     */
/* ------------------------------------------------------------------------------------------ */

function knownRepos(portal: Portal) {
  const org = readOrg(portal.ws.opsDir, parseYaml) as any;
  return (org.repos ?? []).map((r: any) => ({
    name: String(r.name),
    owner: String(org.org),
    role: String(r.role ?? "repo"),
    // As org.yaml has it. Absent on a hand-written entry, which hire treats as public.
    visibility: r.visibility,
  })) as Array<{ name: string; owner: string; role: string; visibility?: string }>;
}

/** A staff member's brain repo, from their own manifest, never from the request. */
async function brainOf(c: Ctx, handle: string): Promise<string> {
  const { org } = await ready(c);
  const entry = (org.staff ?? []).find((x: any) => x.handle === handle);
  if (!entry) throw new HttpError(400, `no staff member "${handle}"`);
  const dir = entry.dir ?? entry.handle;
  return specFromManifest(readManifest(join(c.portal.ws.root, dir), parseYaml) as any, dir).brain;
}

/** The files a prompt fix may write: every layer of that prompt the portal is allowed to save. */
function amendTargets(
  ws: Workspace,
  view: { layers: Array<{ path: string; missing?: boolean }> },
  brains: string[],
): string[] {
  return [
    ...new Set(
      view.layers.filter((l) => !l.missing && isWritable(ws, l.path, brains)).map((l) => l.path),
    ),
  ];
}

/**
 * One file, committed to GitHub as the person, in the shape `saveFile` returned.
 *
 * GitHub refuses the write when the file has moved on since it was read, which is the same
 * protection a rejected push gave: somebody's newer edit is not silently overwritten.
 */
async function commitFile(
  portal: Portal,
  gh: GitHub,
  dir: string,
  path: string,
  body: string,
  message: string,
  base?: string,
) {
  const repo = `${portal.org}/${dir}`;
  const snap = portal.snapshots.get(repo);
  const current = snap?.files.get(path);
  const moved = () =>
    new HttpError(
      409,
      `${dir}/${path} changed on GitHub since this page read it. Reload, then make the edit again.`,
    );
  if (current?.text === body)
    return {
      path: `${dir}/${path}`,
      repo: dir,
      committed: false,
      pushed: false,
      note: "no change",
    };
  // The page says what it started from; GitHub, read just now, says what is there.
  if (base !== undefined && (current?.text ?? "") !== base) throw moved();
  const res = await gh.request<{ commit: { sha: string }; content: { sha: string } }>(
    "PUT",
    `repos/${repo}/contents/${encodePath(path)}`,
    {
      body: {
        message,
        content: base64(new TextEncoder().encode(body)),
        ...(current ? { sha: current.sha } : {}),
      },
    },
  );
  if (!res.ok) {
    if (res.status === 409 || /does not match/i.test(res.error ?? "")) throw moved();
    throw new HttpError(400, `commit failed: ${res.error}`);
  }
  portal.snapshots.patch(repo, path, body, res.data!.content.sha, res.data!.commit.sha);
  return {
    path: `${dir}/${path}`,
    repo: dir,
    committed: true,
    pushed: true,
    sha: res.data!.commit.sha.slice(0, 7),
  };
}

/** A dropped file, committed under attachments/, with a name nobody else has used today. */
async function upload(gh: GitHub, repo: string, name: string, data: string) {
  const bytes = fromBase64(data);
  const today = new Date().toISOString().slice(0, 10);
  const listing = await gh.request<Array<{ name: string }>>(
    "GET",
    `repos/${repo}/contents/attachments`,
  );
  const taken = new Set(
    (listing.ok ? (listing.data ?? []) : []).map((f) => `attachments/${f.name}`),
  );
  const rel = attachPath(name, bytes.length, today, (p) => taken.has(p));
  const res = await gh.request<{ content: { html_url: string } }>(
    "PUT",
    `repos/${repo}/contents/${encodePath(rel)}`,
    { body: { message: `portal: attach ${rel}`, content: base64(bytes) } },
  );
  if (!res.ok) throw new Error(`commit failed: ${res.error}`);
  return { path: rel, url: res.data!.content.html_url, bytes: bytes.length, pushed: true };
}

/** How far a staff member's setup has got, from GitHub. `null` for anything unreadable. */
async function staffProgress(
  gh: GitHub,
  org: string,
  spec: {
    brain: string;
    app?: string;
    publicApp?: string;
    secretPrefix: string;
    publicSecretPrefix: string;
    agentSecret: string;
  },
  workflow: string,
) {
  const [repo, shared, runs, installs] = await Promise.all([
    gh.request<{ secrets: Array<{ name: string }> }>("GET", `repos/${spec.brain}/actions/secrets`),
    gh.request<{ secrets: Array<{ name: string }> }>(
      "GET",
      `repos/${spec.brain}/actions/organization-secrets`,
    ),
    gh.request<{ total_count: number }>(
      "GET",
      `repos/${spec.brain}/actions/workflows/${workflow}/runs?status=success&per_page=1`,
    ),
    gh.request<{ installations: Array<{ app_slug: string; repository_selection: string }> }>(
      "GET",
      `orgs/${org}/installations`,
    ),
  ]);
  const names = repo.ok
    ? new Set([
        ...repo.data!.secrets.map((x) => x.name),
        ...(shared.ok ? shared.data!.secrets.map((x) => x.name) : []),
      ])
    : null;
  const install = (slug?: string) => {
    if (!installs.ok || !slug) return null;
    return (
      installs.data!.installations.find((i) => i.app_slug.toLowerCase() === slug.toLowerCase()) ??
      false
    );
  };
  const priv = install(spec.app);
  const pub = install(spec.publicApp);
  return {
    app: names ? names.has(`${spec.secretPrefix}_APP_ID`) : null,
    publicApp: names ? names.has(`${spec.publicSecretPrefix}_APP_ID`) : null,
    installed: priv === null ? null : Boolean(priv),
    // "selected" means only chosen repos, which has to include the ops repo for a run to start.
    installSelection: priv ? priv.repository_selection : null,
    publicInstalled: pub === null ? null : Boolean(pub),
    credential: names ? names.has(spec.agentSecret) : null,
    ran: runs.ok ? (runs.data?.total_count ?? 0) > 0 : null,
  };
}

const JSON_TYPE = "application/json; charset=utf-8";

function json(data: unknown, status = 200): Response {
  return text(JSON.stringify(data), JSON_TYPE, status);
}

function text(body: string, type: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": type, "cache-control": "no-store" },
  });
}

function bad(): Response {
  return new Response("bad request", { status: 400 });
}

function notFound(): Response {
  return new Response("not found", { status: 404 });
}

function refuse(): Response {
  return json({ error: "write actions need a POST from the portal itself" }, 403);
}

async function body(req: Request): Promise<Record<string, any>> {
  const raw = await req.text();
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new HttpError(400, "the request body is not JSON");
  }
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function fromBase64(data: string): Uint8Array {
  const s = atob(data);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** A small, bounded memory of opened media, so scrubbing through a video is one download. */
function remember(map: Map<string, Uint8Array>, key: string, bytes: Uint8Array) {
  map.set(key, bytes);
  let total = 0;
  for (const v of map.values()) total += v.length;
  for (const k of map.keys()) {
    if (total <= 64 * 1024 * 1024) break;
    total -= map.get(k)!.length;
    map.delete(k);
  }
}

function extOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot < 0 ? "" : path.slice(dot).toLowerCase();
}

const SEEKABLE = /^(video|audio)\//;

const MIME: Record<string, string> = {
  ".md": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".yaml": "text/plain; charset=utf-8",
  ".yml": "text/plain; charset=utf-8",
  ".csv": "text/plain; charset=utf-8",
  ".ts": "text/plain; charset=utf-8",
  ".tsx": "text/plain; charset=utf-8",
  ".js": "text/plain; charset=utf-8",
  ".mjs": "text/plain; charset=utf-8",
  ".sql": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".ogv": "video/ogg",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".oga": "audio/ogg",
};
