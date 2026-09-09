import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { type ActRequest, act } from "../lib/act.js";
import { amendBrief } from "../lib/amend.js";
import {
  type AppSpec,
  buildManifest,
  exchange,
  handoffPage,
  setSecret,
} from "../lib/appmanifest.js";
import { attach, MAX_UPLOAD } from "../lib/attach.js";
import { auditPrompt } from "../lib/audit.js";
import { docPages, docsDir } from "../lib/docs.js";
import { buildExport } from "../lib/export.js";
import { api, ghJson } from "../lib/gh.js";
import { fetchInbox, fetchThread } from "../lib/inbox.js";
import { parsePaste } from "../lib/paste.js";
import { briefTemplate, pasteable, pasteBrief } from "../lib/pastebrief.js";
import { isWritable, KINDS, promptView, saveFile, validateOrgYaml } from "../lib/prompt.js";
import { orgTokens, specFromManifest, tokensFor, toolsOf } from "../lib/render.js";
import { joinTenant, loadFrameworkComposer, orgHasTenant, setupStatus } from "../lib/setup.js";
import { syncRepos } from "../lib/sync.js";
import { loadComposer, readOrg, tryWorkspace, type Workspace } from "../lib/workspace.js";
import { portalAsset, portalIndex } from "../portal/assets.js";
import { collect } from "./doctor.js";
import { fixBrief, gather } from "./fix.js";
import { applyPlan, buildPlan, type Flags, insertUnder, type OrgYaml } from "./hire.js";
import { initCommand, initFiles } from "./init.js";
import { applyRetirePlan, buildRetirePlan } from "./retire.js";

export const portalHelp = `
roster portal

  Serve a local view of every staff member's brain: what they know, what changed, what is
  waiting on you, and every file they hold.

  Reads the checked-out repos from disk. No auth, no API rate limits, works offline.

  With no tenant where you started it, this is the setup screen instead: it stands up a new
  org, or checks out one that already runs roster. \`roster\` with no arguments does the same.

  It can also act on GitHub as you: reply, close, reopen and open issues. Those go
  through your own gh, so they are indistinguishable from doing it on the site.

  --port <n>     default 4300
  --host <addr>  default 127.0.0.1. Anything else exposes write actions to the network.
  --ops <dir>    ops repo directory (default: found by walking up)
  --dir <path>   where a tenant would be created or checked out (default: here)
`;

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
  // A brain holds recordings as often as it holds screenshots, and a video served as
  // application/octet-stream is a download prompt rather than something you can watch.
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

/** Types a browser streams rather than downloads, and so may ask for by byte range. */
const SEEKABLE = /^(video|audio)\//;

/**
 * Hand-offs in flight, keyed by the state GitHub echoes back.
 *
 * In memory and never persisted: a manifest code is good for an hour, and a restarted portal
 * has no business resuming somebody else's App creation.
 */
const pendingApps = new Map<
  string,
  { spec: AppSpec; brain: string; prefix: string; org: string }
>();
const appResults = new Map<string, Record<string, unknown>>();

export async function portalCommand(argv: string[]): Promise<number> {
  const opts = parseFlags(argv);
  const port = opts.port ?? 4300;
  const host = opts.host ?? "127.0.0.1";
  const startedIn = resolve(opts.ops ?? opts.dir ?? process.cwd());

  /* The portal used to refuse to start without a tenant, which made the surface that should
     run your setup depend on the output of your setup. Now a missing workspace is a mode: the
     server comes up, mounts the setup routes, and re-resolves itself the moment `org.yaml`
     lands on disk. Everything below is `let` for that one reason. */
  let ws = tryWorkspace(startedIn);
  let composer = ws ? await loadComposer(ws.opsDir) : await loadFrameworkComposer();
  const compose = (...args: Parameters<typeof composer.compose>) => composer.compose(...args);
  const parseYaml = (text: string, file?: string) => composer.parseYaml(text, file);

  /**
   * Pick up a tenant that did not exist when the server started.
   *
   * Switching to the tenant's own vendored `compose.mjs` is the point: the framework's copy is
   * only ever a stand-in for the minutes before `init` has run, and two composers in play is
   * exactly the drift `loadComposer` exists to prevent.
   */
  const adopt = async () => {
    const found = tryWorkspace(startedIn);
    if (!found) return false;
    ws = found;
    composer = await loadComposer(found.opsDir);
    return true;
  };

  // gh calls take about a second each and the inbox hits every repo, so a short cache keeps
  // switching views instant. The refresh button bypasses it.
  let cache: { at: number; body: string } | null = null;
  const TTL = 45_000;

  /* A repo's labels, per repo. They are the vocabulary of the org and change about never, so
     the picker on the new-issue form should not cost a round trip every time it opens. */
  const labelCache = new Map<string, { at: number; labels: unknown[] }>();
  const LABEL_TTL = 300_000;

  const brainDirs = () =>
    (readOrg(ws!.opsDir, parseYaml).staff ?? []).map((s) => s.dir ?? s.handle);

  const knownRepos = () => {
    const org = readOrg(ws!.opsDir, parseYaml) as any;
    return (org.repos ?? []).map((r: any) => ({
      name: r.name,
      owner: org.org,
      role: r.role ?? "repo",
    }));
  };

  /* A local server that can write to GitHub is reachable by any page in the browser, so a
     write needs three things a drive-by request cannot produce: a POST, a custom header
     (which forces a CORS preflight that will fail), and either no Origin or a local one. */
  const writeAllowed = (req: import("node:http").IncomingMessage) => {
    if (req.method !== "POST") return false;
    if (req.headers["x-roster"] !== "1") return false;
    const origin = req.headers.origin;
    if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return false;
    return true;
  };

  /**
   * The setup routes, which are the only ones that run before a tenant exists.
   *
   * `plan` and `apply` are the same `initFiles` the CLI uses, so the browser and the terminal
   * cannot disagree about what a new tenant contains. Plan-then-apply survives the port: the
   * plan writes nothing, and applying is a separate, guarded POST.
   */
  const handleSetup = async (
    url: URL,
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
  ) => {
    const route = url.pathname.slice("/api/setup/".length);

    if (route === "status") {
      json(res, { ...(await setupStatus(startedIn)), startedIn });
      return;
    }

    /* Creating a staff member's GitHub App, on this server rather than on a second one.
       `roster app` spins up its own listener on 4310 for the manifest hand-off; in the portal
       that is one browser, two origins and two ports to explain. Same flow, same one-time code,
       same private key that never touches disk — just served from the page you are already on. */
    if (route === "app") {
      if (!writeAllowed(req) || !ws) {
        refuseWrite(res);
        return;
      }
      const payload = JSON.parse((await body(req)) || "{}") as {
        staff?: string;
        scope?: string;
      };
      const org = readOrg(ws.opsDir, parseYaml) as any;
      const entry = (org.staff ?? []).find((x: any) => x.handle === payload.staff);
      if (!entry) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: `no staff member "${payload.staff}"` }));
        return;
      }
      const dir = entry.dir ?? entry.handle;
      const spec = specFromManifest(
        parseYaml(readFileSync(join(ws.root, dir, "staff.yaml"), "utf8"), "staff.yaml") as any,
        dir,
      );
      const isPublic = payload.scope === "public";
      const name = isPublic ? spec.publicApp : spec.app;
      const prefix = isPublic ? spec.publicSecretPrefix : spec.secretPrefix;
      if (!name) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: `staff.yaml declares no ${payload.scope} app` }));
        return;
      }

      // An App name is unique across GitHub, so the clash is worth catching before a browser
      // is opened rather than after a form is submitted.
      const existing = await api<{ slug: string }>(`/apps/${name}`);
      if (existing.ok) {
        res.writeHead(409, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: `An App called "${name}" already exists. If it is yours it only needs installing.`,
            install: `https://github.com/organizations/${org.org}/settings/apps/${name}/installations`,
          }),
        );
        return;
      }

      const state = randomBytes(16).toString("hex");
      pendingApps.set(state, {
        spec: {
          name,
          org: org.org,
          scope: isPublic ? "public" : "private",
          description: isPublic
            ? `Shared public identity for ${org.name}'s staff, managed by roster.`
            : `${spec.name} at ${org.name}. An agent-run staff member, managed by roster.`,
        },
        brain: spec.brain,
        prefix,
        org: org.org,
      });
      json(res, { state, start: `/setup/app/start?state=${state}` });
      return;
    }

    /* Does this org already run roster. Asked before anything is offered, because "create"
       and "join" are different answers and the wrong one leaves a second ops repo behind. */
    if (route === "check-org") {
      const org = url.searchParams.get("org") ?? "";
      if (!/^[A-Za-z0-9][\w.-]*$/.test(org)) {
        res.writeHead(400).end("bad request");
        return;
      }
      json(res, await orgHasTenant(org));
      return;
    }

    /* Joining one that exists: clone the ops repo, read its staff list, clone each brain
       beside it. That layout is not a preference — it is the shape the CI runner checks out,
       so what you see locally is what runs. */
    if (route === "join") {
      if (!writeAllowed(req)) {
        refuseWrite(res);
        return;
      }
      const payload = JSON.parse((await body(req)) || "{}") as { org?: string };
      const org = String(payload.org ?? "");
      if (!/^[A-Za-z0-9][\w.-]*$/.test(org)) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "an organisation name is needed" }));
        return;
      }
      const said = capture();
      try {
        const cloned = await joinTenant(startedIn, org);
        const adopted = await adopt();
        json(res, { ok: true, adopted, cloned, output: said.text() });
      } catch (err) {
        json(res, { ok: false, error: String((err as Error).message), output: said.text() });
      } finally {
        said.stop();
      }
      return;
    }

    /* The repos the staff operate in. A picker over what your gh can already see beats
       hand-editing a YAML list you have to spell exactly right. */
    if (route === "repos") {
      const org = url.searchParams.get("org") ?? "";
      if (!/^[A-Za-z0-9][\w.-]*$/.test(org)) {
        res.writeHead(400).end("bad request");
        return;
      }
      const list = await ghJson<Array<{ name: string; visibility: string; description: string }>>([
        "repo",
        "list",
        org,
        "--limit",
        "200",
        "--json",
        "name,visibility,description",
      ]);
      json(res, {
        repos: list.ok ? (list.data ?? []) : [],
        error: list.ok ? undefined : list.error,
      });
      return;
    }

    /* Adding one to org.yaml, textually, the same way `hire` appends a staff member: a round
       trip through a generic YAML emitter would reformat the file and lose every comment. */
    if (route === "add-repo") {
      if (!writeAllowed(req) || !ws) {
        refuseWrite(res);
        return;
      }
      const payload = JSON.parse((await body(req)) || "{}") as { name?: string; role?: string };
      const name = String(payload.name ?? "");
      const role = String(payload.role ?? "product");
      if (!/^[\w.-]+$/.test(name) || !/^(product|brain|ops|repo)$/.test(role)) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "a repo name and a known role are needed" }));
        return;
      }
      const path = join(ws.opsDir, "org.yaml");
      const text = readFileSync(path, "utf8");
      if (new RegExp(`name: ${name}[,\\s}]`).test(text)) {
        json(res, { ok: true, note: "already there" });
        return;
      }
      const result = saveFile(
        ws,
        `${ws.opsName}/org.yaml`,
        insertUnder(text, "repos", `  - { name: ${name}, visibility: private, role: ${role} }`),
        `portal: org.yaml lists ${name}`,
      );
      json(res, { ok: true, ...result });
      return;
    }

    if (route === "plan" || route === "apply") {
      const params =
        route === "apply"
          ? (JSON.parse((await body(req)) || "{}") as Record<string, string>)
          : Object.fromEntries(url.searchParams);

      const org = String(params.org ?? "").trim();
      if (!/^[A-Za-z0-9][\w.-]*$/.test(org)) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "an organisation name is needed" }));
        return;
      }
      const argv = [
        "--org",
        org,
        "--name",
        String(params.name ?? org),
        "--dir",
        startedIn,
        "--agent",
        String(params.agent ?? "claude-code-action"),
      ];
      if (params.human) argv.push("--human", String(params.human));
      if (params.marker) argv.push("--marker", String(params.marker));

      if (route === "plan") {
        json(res, {
          org,
          dir: join(startedIn, "roster-ops"),
          files: [
            ...initFiles({
              org,
              name: String(params.name ?? org),
              human: String(params.human ?? ""),
              marker: String(params.marker ?? "human"),
              opsName: "roster-ops",
              agent: String(params.agent ?? "claude-code-action"),
            }).keys(),
          ].sort(),
        });
        return;
      }

      if (!writeAllowed(req)) {
        refuseWrite(res);
        return;
      }
      const said = capture();
      let code: number;
      try {
        code = await initCommand([...argv, "--apply"]);
      } finally {
        said.stop();
      }
      // The whole point of the flip: the tenant that did not exist a second ago is now the one
      // this server serves, without anybody restarting anything.
      const adopted = code === 0 ? await adopt() : false;
      json(res, { ok: code === 0, code, adopted, output: said.text() });
      return;
    }

    res.writeHead(404).end("not found");
  };

  const body = (req: import("node:http").IncomingMessage, limit = 1_000_000) =>
    new Promise<string>((resolve, reject) => {
      let buf = "";
      req.on("data", (c) => {
        buf += c;
        if (buf.length > limit) reject(new Error("body too large"));
      });
      req.on("end", () => resolve(buf));
      req.on("error", reject);
    });

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    try {
      if (url.pathname === "/") {
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end(portalIndex());
        return;
      }

      /* The UI's own stylesheets and modules. Separate from /api/file, which serves the
         workspace: these come from the framework, that comes from the tenant. */
      if (url.pathname.startsWith("/assets/")) {
        const asset = portalAsset(decodeURIComponent(url.pathname.slice("/assets/".length)));
        if (!asset) {
          res.writeHead(404).end("not found");
          return;
        }
        res.writeHead(200, { "content-type": asset.type, "cache-control": "no-store" });
        res.end(asset.body);
        return;
      }

      /* The docs ship with the framework, so the portal serves them from there rather than
         from the tenant. Reading them where you already are beats remembering a URL. */
      if (url.pathname === "/api/docs") {
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(docPages()));
        return;
      }

      if (url.pathname === "/api/doc") {
        const page = url.searchParams.get("page") ?? "";
        // Only a page the listing offered: the name is attacker-controlled and reaches the disk.
        if (!docPages().some((d) => d.file === page)) {
          res.writeHead(404).end("not found");
          return;
        }
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.end(readFileSync(join(docsDir(), page), "utf8"));
        return;
      }

      /* The manifest hand-off, and GitHub's redirect back. Plain pages rather than JSON:
         a browser is the client for both, and the second one is a redirect we do not control. */
      if (url.pathname === "/setup/app/start") {
        const pending = pendingApps.get(url.searchParams.get("state") ?? "");
        if (!pending) {
          res.writeHead(400, { "content-type": "text/html" }).end("<p>Unknown hand-off.</p>");
          return;
        }
        const redirect = `http://localhost:${port}/setup/app/callback`;
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(
          handoffPage(
            pending.spec,
            buildManifest(pending.spec, redirect),
            url.searchParams.get("state") ?? "",
          ),
        );
        return;
      }

      if (url.pathname === "/setup/app/callback") {
        const state = url.searchParams.get("state") ?? "";
        const pending = pendingApps.get(state);
        const code = url.searchParams.get("code") ?? "";
        if (!pending || !code) {
          res
            .writeHead(400, { "content-type": "text/html" })
            .end(
              "<p>That did not come from a hand-off this portal started. Nothing was created.</p>",
            );
          return;
        }
        pendingApps.delete(state);
        exchange(code)
          .then(async (app) => {
            /* The key exists only in memory here. If the secret write fails it is gone, and
               saying so is the difference between a puzzling failure and a known one. */
            await setSecret(pending.brain, `${pending.prefix}_APP_ID`, String(app.id));
            await setSecret(pending.brain, `${pending.prefix}_APP_PRIVATE_KEY`, app.pem);
            appResults.set(state, {
              ok: true,
              slug: app.slug,
              install: `https://github.com/organizations/${pending.org}/settings/apps/${app.slug}/installations`,
            });
            res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
            res.end(
              `<body style="font:15px/1.6 system-ui;max-width:34rem;margin:14vh auto;padding:0 1.4rem">` +
                `<h1 style="font-size:1.3rem">${app.slug} created</h1>` +
                `<p>Its id and private key went straight into ${pending.brain}'s secrets. The key was never written to disk.</p>` +
                `<p><b>It still has to be installed</b>, and granted every tracker this staff member writes to — not just their own.</p>` +
                `<p>Close this tab; the portal has the link.</p></body>`,
            );
          })
          .catch((err: Error) => {
            appResults.set(state, { ok: false, error: err.message });
            res
              .writeHead(502, { "content-type": "text/html; charset=utf-8" })
              .end(
                `<body style="font:15px/1.6 system-ui;padding:2rem"><h1>That did not work</h1><p>${err.message}</p></body>`,
              );
          });
        return;
      }

      if (url.pathname === "/api/setup/app-result") {
        json(res, appResults.get(url.searchParams.get("state") ?? "") ?? { pending: true });
        return;
      }

      /* The scan every checklist is derived from. Above the guard because setup polls it the
         moment a tenant appears, and `collect` finds its own workspace anyway. */
      if (url.pathname === "/api/doctor") {
        collect({ ops: ws?.opsDir, offline: url.searchParams.get("offline") === "1" })
          .then((report) => json(res, report ?? { findings: [], online: false, empty: true }))
          .catch((err) => {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ findings: [], error: String(err?.message ?? err) }));
          });
        return;
      }

      /* Setup runs before there is a tenant, so its routes sit above the guard. */
      if (url.pathname.startsWith("/api/setup/")) {
        handleSetup(url, req, res).catch((err) => {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: String(err?.message ?? err) }));
        });
        return;
      }

      /* Everything past here reads a tenant. Without one the honest answer is which mode the
         server is in, not a 500 from dereferencing a workspace that was never found. */
      if (!ws) {
        res.writeHead(409, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ mode: "setup", error: "there is no tenant here yet" }));
        return;
      }
      const w: Workspace = ws;

      if (url.pathname === "/api/org") {
        // Rebuilt per request so a browser refresh shows what is on disk right now,
        // including whatever an agent pushed thirty seconds ago.
        const org = readOrg(w.opsDir, parseYaml);
        const data = buildExport(w, org as any, parseYaml);
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end(JSON.stringify(data));
        return;
      }

      /* What a staff member is actually sent, and the files it was made of. Composed by the
         tenant's own compose.mjs, so there is no second implementation to drift. */
      if (url.pathname === "/api/prompt") {
        const handle = url.searchParams.get("staff") ?? "";
        const kind = url.searchParams.get("kind") ?? "daily";
        const org = readOrg(w.opsDir, parseYaml);
        const entry = (org.staff ?? []).find((s) => s.handle === handle);
        if (!entry || !(KINDS as readonly string[]).includes(kind)) {
          res.writeHead(400).end("bad request");
          return;
        }
        const brainDir = join(w.root, entry.dir ?? entry.handle);
        try {
          const view = promptView(w, compose, handle, brainDir, kind);
          view.problems = auditPrompt(w, view, workspaceRoots(org as any));
          res.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          });
          res.end(JSON.stringify(view));
        } catch (err) {
          // A prompt that will not compose is the most useful thing this screen can show,
          // so the error is the response rather than a 500 with nothing in it.
          res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ staff: handle, kind, error: String((err as Error).message) }));
        }
        return;
      }

      /* Hiring and retiring, from the same plan-then-apply the CLI runs. The portal builds
         the plan with `buildPlan` and applies it with `applyPlan`, rather than describing
         either again: two descriptions of how to create a repo is one too many. */
      if (url.pathname === "/api/staff/plan") {
        const handle = url.searchParams.get("handle") ?? "";
        const action = url.searchParams.get("action") === "retire" ? "retire" : "hire";
        const org = readOrg(w.opsDir, parseYaml);
        try {
          if (action === "retire") {
            if (!(org.staff ?? []).some((s) => s.handle === handle)) {
              throw new Error(`"${handle}" is not in org.yaml`);
            }
            const plan = buildRetirePlan(w, org, handle, parseYaml);
            json(res, { action, plan });
            return;
          }
          if (!/^[a-z][a-z0-9-]{1,20}$/.test(handle)) {
            throw new Error(`"${handle}" is not a usable handle. Lowercase, digits and dashes.`);
          }
          if ((org.staff ?? []).some((s) => s.handle === handle)) {
            throw new Error(`"${handle}" is already in org.yaml`);
          }
          const flags = hireFlags(url.searchParams);
          const plan = buildPlan(w, org as OrgYaml, handle, flags, parseYaml);
          // The file bodies are megabytes of scaffold nobody reads in a plan. Names only.
          json(res, {
            action,
            plan: { ...plan, files: [...plan.files.keys()].sort() },
          });
        } catch (err) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: String((err as Error).message) }));
        }
        return;
      }

      if (url.pathname === "/api/staff/apply") {
        if (!writeAllowed(req)) {
          refuseWrite(res);
          return;
        }
        body(req)
          .then(async (raw) => {
            const payload = JSON.parse(raw || "{}") as {
              action?: string;
              handle?: string;
              flags?: Record<string, string>;
            };
            const handle = payload.handle ?? "";
            const org = readOrg(w.opsDir, parseYaml);
            /* Both of these write to GitHub and to disk, and both print as they go. The
               output is captured and returned, because a person who just created a repo
               wants the same account of it the terminal gives. */
            const said = capture();
            let code: number;
            try {
              if (payload.action === "retire") {
                code = await applyRetirePlan(w, buildRetirePlan(w, org, handle, parseYaml));
              } else {
                const flags = hireFlags(new URLSearchParams(payload.flags ?? {}));
                const plan = buildPlan(w, org as OrgYaml, handle, flags, parseYaml);
                code = await applyPlan(w, plan, { ...flags, apply: true });
              }
            } finally {
              said.stop();
            }
            json(res, { ok: code === 0, code, output: said.text() });
          })
          .catch((err) => {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: String(err?.message ?? err) }));
          });
        return;
      }

      /* A prompt you paste into your own AI to change what this agent is told. It carries
         the composed text and every layer, because knowing which of eight files to open is
         the hard part and a brief that asks for them has handed that back. */
      /* Every scanner's findings as one brief for a coding agent. The Health screen's
         "copy all instructions" button, and `roster fix` in the terminal, are the same text. */
      if (url.pathname === "/api/fix") {
        gather(w, url.searchParams.get("offline") === "1")
          .then((items) => json(res, { items, text: fixBrief(w, items) }))
          .catch((err) => {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ items: [], error: String(err?.message ?? err) }));
          });
        return;
      }

      /* The copy-a-prompt half of authoring. `mode=paste` carries every file the brief refers
         to and asks for the answer in an envelope, so a chat window with no filesystem is as
         useful here as an agent standing in the repo. */
      if (url.pathname === "/api/brief") {
        const kind = url.searchParams.get("kind") ?? "";
        const handle = url.searchParams.get("staff") ?? "";
        try {
          const brief = buildPasteBrief(w, parseYaml, kind, handle);
          json(res, { kind, text: brief.text, targets: brief.targets.map((t) => t.path) });
        } catch (err) {
          res.writeHead(400, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: String((err as Error).message) }));
        }
        return;
      }

      /* The paste-back half. Parses, never writes: what comes out is a diff and a list of
         things that went wrong, and saving is a second, deliberate click through /api/save. */
      if (url.pathname === "/api/paste") {
        if (req.method !== "POST") {
          res.writeHead(405).end("POST only");
          return;
        }
        body(req)
          .then((raw) => {
            const payload = JSON.parse(raw || "{}") as {
              kind?: string;
              staff?: string;
              answer?: string;
            };
            const brief = buildPasteBrief(w, parseYaml, payload.kind ?? "", payload.staff ?? "");
            const result = parsePaste(payload.answer ?? "", brief.targets);
            const before = new Map(brief.targets.map((t) => [t.path, t.before]));
            json(res, {
              ...result,
              files: result.files.map((f) => ({
                ...f,
                before: before.get(f.path) ?? "",
                writable: isWritable(w, f.path, brainDirs()),
              })),
            });
          })
          .catch((err) => {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: String(err?.message ?? err) }));
          });
        return;
      }

      /* Everything wrong with one staff member's prompts, across every kind of run.
         The Prompt screen used to carry these, which put "what is broken" inside "what is
         sent" — two different questions, and only one of them is a health question. Composed
         per kind because a finding can be true of the daily prompt and not of a mention. */
      if (url.pathname === "/api/promptaudit") {
        const handle = url.searchParams.get("staff") ?? "";
        const org = readOrg(w.opsDir, parseYaml);
        const entry = (org.staff ?? []).find((s) => s.handle === handle);
        if (!entry) {
          res.writeHead(400).end("bad request");
          return;
        }
        const brainDir = join(w.root, entry.dir ?? entry.handle);
        const roots = workspaceRoots(org as any);
        const found = new Map<string, any>();
        const errors: Array<{ kind: string; error: string }> = [];
        for (const kind of KINDS) {
          try {
            const view = promptView(w, compose, handle, brainDir, kind);
            for (const p of auditPrompt(w, view, roots)) {
              // The same stub is a finding on all three prompts. One row, and it says which.
              const key = `${p.id}|${p.path ?? ""}|${p.title}`;
              const seen = found.get(key);
              if (seen) seen.kinds.push(kind);
              else found.set(key, { ...p, kind, kinds: [kind] });
            }
          } catch (err) {
            errors.push({ kind, error: String((err as Error).message) });
          }
        }
        json(res, { staff: handle, problems: [...found.values()], errors });
        return;
      }

      if (url.pathname === "/api/amend") {
        const handle = url.searchParams.get("staff") ?? "";
        const kind = url.searchParams.get("kind") ?? "daily";
        const want = url.searchParams.get("want") ?? "";
        const org = readOrg(w.opsDir, parseYaml);
        const entry = (org.staff ?? []).find((s) => s.handle === handle);
        if (!entry || !(KINDS as readonly string[]).includes(kind)) {
          res.writeHead(400).end("bad request");
          return;
        }
        const dir = entry.dir ?? entry.handle;
        const view = promptView(w, compose, handle, join(w.root, dir), kind);
        const manifestPath = join(w.root, dir, "staff.yaml");
        const tokens = existsSync(manifestPath)
          ? tokensFor(
              orgSpec(org as any, w),
              specFromManifest(
                parseYaml(readFileSync(manifestPath, "utf8"), "staff.yaml") as any,
                dir,
              ),
            )
          : orgTokens(orgSpec(org as any, w));
        res.writeHead(200, {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end(amendBrief(w, view, tokens, want));
        return;
      }

      /* Editing a prompt layer or a charter, committed and pushed as the human. The
         allowlist is in lib/prompt.ts: this writes to repos the agents run from. */
      if (url.pathname === "/api/save") {
        if (!writeAllowed(req)) {
          refuseWrite(res);
          return;
        }
        body(req)
          .then((raw) => {
            const payload = JSON.parse(raw || "{}") as {
              path?: string;
              text?: string;
              message?: string;
            };
            const org = readOrg(w.opsDir, parseYaml);
            const brainDirs = (org.staff ?? []).map((s) => s.dir ?? s.handle);
            if (!payload.path || typeof payload.text !== "string") {
              throw new Error("path and text are required");
            }
            if (!isWritable(w, payload.path, brainDirs)) {
              throw new Error(`${payload.path} is not a file the portal may write`);
            }
            if (payload.path.endsWith("org.yaml")) {
              const wrong = validateOrgYaml(payload.text, parseYaml);
              if (wrong) throw new Error(wrong);
            }
            const result = saveFile(
              w,
              payload.path,
              payload.text,
              payload.message || `portal: edit ${payload.path.split("/").slice(1).join("/")}`,
            );
            res.writeHead(200, {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store",
            });
            res.end(JSON.stringify(result));
          })
          .catch((err) => {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: String(err?.message ?? err) }));
          });
        return;
      }

      if (url.pathname === "/api/act") {
        if (!writeAllowed(req)) {
          refuseWrite(res);
          return;
        }
        body(req)
          .then(async (raw) => {
            const payload = JSON.parse(raw || "{}") as ActRequest;
            const org = readOrg(w.opsDir, parseYaml) as any;
            const known = (org.repos ?? []).map((r: any) => `${org.org}/${r.name}`);
            if (!known.includes(payload.repo))
              throw new Error(`${payload.repo} is not a repo in org.yaml`);
            const result = await act(payload);
            cache = null; // the inbox is now wrong
            res.writeHead(200, {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store",
            });
            res.end(JSON.stringify(result));
          })
          .catch((err) => {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: String(err?.message ?? err) }));
          });
        return;
      }

      /* A file dropped onto an issue. It is committed into the repo the issue lives in, so
         the agent that reads the issue has the file on disk rather than a link it cannot
         fetch. Same guard as every other write: a local POST from the portal. */
      if (url.pathname === "/api/upload") {
        if (!writeAllowed(req)) {
          refuseWrite(res);
          return;
        }
        // Base64 costs a third on top, and the cap is on the file rather than the envelope.
        body(req, Math.ceil(MAX_UPLOAD * 1.4))
          .then((raw) => {
            const payload = JSON.parse(raw || "{}") as {
              repo?: string;
              name?: string;
              data?: string;
            };
            const repo = payload.repo ?? "";
            const known = knownRepos().find((r: any) => `${r.owner}/${r.name}` === repo);
            if (!known) throw new Error(`${repo} is not a repo in org.yaml`);
            if (!payload.name) throw new Error("a file needs a name");
            json(
              res,
              attach({
                repoDir: join(w.root, known.name),
                repo,
                name: payload.name,
                data: Buffer.from(payload.data ?? "", "base64"),
                today: new Date().toISOString().slice(0, 10),
              }),
            );
          })
          .catch((err) => {
            res.writeHead(400, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: String(err?.message ?? err) }));
          });
        return;
      }

      if (url.pathname === "/api/sync") {
        const org = readOrg(w.opsDir, parseYaml) as any;
        const dirs = [w.opsName, ...(org.staff ?? []).map((s: any) => s.dir ?? s.handle)];
        syncRepos(w.root, dirs)
          .then((results) => {
            /* Only what was actually pulled. This used to drop the cache on every sync, so
               every window focus — which syncs first — paid for a full re-read of every repo
               on GitHub, four seconds of it, to learn nothing had changed. */
            if (results.some((r) => r.pulled)) cache = null;
            res.writeHead(200, {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store",
            });
            res.end(JSON.stringify({ results }));
          })
          .catch((err) => {
            res.writeHead(500, { "content-type": "application/json" });
            res.end(JSON.stringify({ results: [], error: String(err?.message ?? err) }));
          });
        return;
      }

      /* The repos org.yaml lists, off disk. Its own route because the new-issue form needs
         them and used to read them off the loaded inbox: click New issue while the inbox was
         still asking GitHub and the repo picker was empty, which is exactly when you would. */
      if (url.pathname === "/api/repos") {
        json(res, { repos: knownRepos() });
        return;
      }

      if (url.pathname === "/api/labels") {
        const repo = url.searchParams.get("repo") ?? "";
        if (!knownRepos().some((r: any) => `${r.owner}/${r.name}` === repo)) {
          res.writeHead(400).end("bad request");
          return;
        }
        const hit = labelCache.get(repo);
        if (hit && Date.now() - hit.at < LABEL_TTL) {
          json(res, { labels: hit.labels });
          return;
        }
        api<Array<{ name: string; color: string; description: string | null }>>(
          `repos/${repo}/labels?per_page=100`,
        )
          .then((result) => {
            if (!result.ok) {
              json(res, { labels: [], error: result.error });
              return;
            }
            const labels = (result.data ?? []).map((l) => ({
              name: l.name,
              color: l.color,
              description: l.description ?? "",
            }));
            labelCache.set(repo, { at: Date.now(), labels });
            json(res, { labels });
          })
          .catch((err) => json(res, { labels: [], error: String(err?.message ?? err) }));
        return;
      }

      if (url.pathname === "/api/inbox") {
        const fresh = url.searchParams.get("refresh") === "1";
        if (!fresh && cache && Date.now() - cache.at < TTL) {
          res.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          });
          res.end(cache.body);
          return;
        }
        fetchInbox(knownRepos())
          .then((data) => {
            const body = JSON.stringify({
              ...data,
              repos: knownRepos(),
              fetchedAt: new Date().toISOString(),
            });
            cache = { at: Date.now(), body };
            res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
            res.end(body);
          })
          .catch((err) => {
            res.writeHead(500, { "content-type": "application/json" });
            res.end(JSON.stringify({ items: [], errors: [String(err?.message ?? err)] }));
          });
        return;
      }

      /**
       * One pull request in the detail the inbox does not carry: its commits, and the patch
       * for every file it touches.
       *
       * Fetched when you ask for it rather than folded into the org-wide read. A diff is the
       * biggest thing on this screen by an order of magnitude, and paying for every open PR's
       * diff on every inbox refresh to show one of them is the wrong trade.
       */
      if (url.pathname === "/api/pr") {
        const repo = url.searchParams.get("repo") ?? "";
        const number = Number(url.searchParams.get("number"));
        const allowed = knownRepos().some((r: any) => `${r.owner}/${r.name}` === repo);
        if (!allowed || !Number.isInteger(number) || number <= 0) {
          res.writeHead(400).end("bad request");
          return;
        }
        Promise.all([
          api<any>(`repos/${repo}/pulls/${number}`),
          api<any[]>(`repos/${repo}/pulls/${number}/commits?per_page=100`),
          api<any[]>(`repos/${repo}/pulls/${number}/files?per_page=100`),
        ])
          .then(([pr, commits, files]) => {
            if (!pr.ok) {
              json(res, { error: pr.error });
              return;
            }
            json(res, {
              base: pr.data.base?.ref,
              head: pr.data.head?.ref,
              draft: !!pr.data.draft,
              /* GitHub computes mergeability in the background, so the first read of a fresh
                 PR can honestly answer "I do not know yet". Passed through as null rather
                 than flattened to false, which would read as a conflict. */
              mergeable: pr.data.mergeable,
              mergeState: pr.data.mergeable_state,
              additions: pr.data.additions,
              deletions: pr.data.deletions,
              changedFiles: pr.data.changed_files,
              commits: (commits.data ?? []).map((c: any) => ({
                sha: String(c.sha).slice(0, 7),
                subject: String(c.commit?.message ?? "").split("\n")[0],
                author: c.author?.login ?? c.commit?.author?.name ?? "",
                date: c.commit?.author?.date,
                url: c.html_url,
              })),
              files: (files.data ?? []).map((f: any) => ({
                path: f.filename,
                status: f.status,
                additions: f.additions,
                deletions: f.deletions,
                // Absent on binaries and on files too large for the API to patch.
                patch: f.patch ?? "",
              })),
              errors: [commits, files].filter((r) => !r.ok).map((r) => r.error),
            });
          })
          .catch((err) => json(res, { error: String(err?.message ?? err) }));
        return;
      }

      if (url.pathname === "/api/thread") {
        const repo = url.searchParams.get("repo") ?? "";
        const number = Number(url.searchParams.get("number"));
        const kind = url.searchParams.get("kind") === "pr" ? "pr" : "issue";
        // Both reach a command line, so neither is trusted: the repo must be one of ours and
        // the number must be a number.
        const allowed = knownRepos().some((r: any) => `${r.owner}/${r.name}` === repo);
        if (!allowed || !Number.isInteger(number) || number <= 0) {
          res.writeHead(400).end("bad request");
          return;
        }
        fetchThread(repo, number, kind)
          .then((thread) => {
            cache = null;
            res.writeHead(200, {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store",
            });
            res.end(JSON.stringify(thread));
          })
          .catch((err) => {
            res.writeHead(502, { "content-type": "application/json" });
            res.end(JSON.stringify({ error: String(err?.message ?? err) }));
          });
        return;
      }

      if (url.pathname === "/api/diff") {
        const dir = url.searchParams.get("dir") ?? "";
        const sha = url.searchParams.get("sha") ?? "";
        const path = url.searchParams.get("path") ?? "memory/INDEX.md";
        // Both are attacker-controlled and both reach a command line, so neither is trusted:
        // the directory must be a known staff repo and the sha must look like a sha.
        const org = readOrg(w.opsDir, parseYaml);
        const known = (org.staff ?? []).map((s) => s.dir ?? s.handle);
        if (!known.includes(dir) || !/^[0-9a-f]{7,40}$/i.test(sha)) {
          res.writeHead(400).end("bad request");
          return;
        }
        const out = execFileSync(
          "git",
          ["-C", join(w.root, dir), "show", "--format=%an%x1f%aI%x1f%s", sha, "--", path],
          {
            encoding: "utf8",
            maxBuffer: 8 * 1024 * 1024,
          },
        );
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.end(out);
        return;
      }

      if (url.pathname === "/api/file") {
        const rel = url.searchParams.get("path") ?? "";
        const full = resolve(w.root, rel);
        // Everything the portal serves must live under the workspace. Without this a crafted
        // path walks straight out of it, and this server is trivially reachable on a LAN.
        if (
          !full.startsWith(resolve(w.root) + "/") ||
          !existsSync(full) ||
          statSync(full).isDirectory()
        ) {
          res.writeHead(404).end("not found");
          return;
        }
        const ext = extname(full).toLowerCase();
        const type = MIME[ext] ?? "application/octet-stream";

        /* Media is streamed, not downloaded, and a <video> that cannot ask for a byte range
           cannot seek — Safari will not play it at all. Everything else is small enough that
           reading it whole is simpler than being clever. */
        if (SEEKABLE.test(type)) {
          const size = statSync(full).size;
          const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
          if (range) {
            const start = range[1] ? Number(range[1]) : 0;
            const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
            if (!(start <= end && start < size)) {
              res.writeHead(416, { "content-range": `bytes */${size}` }).end();
              return;
            }
            res.writeHead(206, {
              "content-type": type,
              "content-length": end - start + 1,
              "content-range": `bytes ${start}-${end}/${size}`,
              "accept-ranges": "bytes",
              "cache-control": "no-store",
            });
            createReadStream(full, { start, end }).pipe(res);
            return;
          }
          res.writeHead(200, {
            "content-type": type,
            "content-length": size,
            "accept-ranges": "bytes",
            "cache-control": "no-store",
          });
          createReadStream(full).pipe(res);
          return;
        }

        res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
        res.end(readFileSync(full));
        return;
      }

      res.writeHead(404).end("not found");
    } catch (err) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(err instanceof Error ? err.message : String(err));
    }
  });

  return new Promise((done) => {
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        process.stderr.write(`roster: port ${port} is in use. Try --port ${port + 1}.\n`);
      } else {
        process.stderr.write(`roster: ${err.message}\n`);
      }
      done(1);
    });
    server.listen(port, host, () => {
      const warn =
        host === "127.0.0.1"
          ? ""
          : `\n  ⚠ bound to ${host}: write actions are reachable from the network.\n`;
      // Without a tenant this is the setup screen, and saying so is the difference between
      // "it is ready" and "it did not find my org".
      const where = ws
        ? `workspace: ${ws.root}`
        : `no tenant in ${startedIn} yet — the page will set one up`;
      process.stdout.write(
        `\n  roster portal\n  http://localhost:${port}\n${warn}\n  ${where}\n  Ctrl-C to stop.\n\n`,
      );
    });
  });
}

/**
 * The paste-mode brief for a kind, built once and used by both halves of the loop.
 *
 * `/api/paste` needs the exact same targets `/api/brief` promised, or a paste could name a file
 * the brief never offered. Building it from the same function is what makes that true rather
 * than merely intended.
 */
function buildPasteBrief(
  ws: import("../lib/workspace.js").Workspace,
  parseYaml: (t: string, f?: string) => Record<string, unknown>,
  kind: string,
  handle: string,
) {
  if (!pasteable(kind)) throw new Error(`there is no paste-mode brief for "${kind}"`);
  const org = readOrg(ws.opsDir, parseYaml);
  const staff = org.staff ?? [];

  let dir = "";
  let tokens: Record<string, string>;
  if (kind === "charter") {
    const entry = staff.find((s) => s.handle === handle);
    if (!entry) {
      const known = staff.map((s) => s.handle).join(", ") || "nobody yet";
      throw new Error(`unknown staff handle "${handle}". org.yaml knows: ${known}`);
    }
    dir = entry.dir ?? entry.handle;
    const manifestPath = join(ws.root, dir, "staff.yaml");
    tokens = tokensFor(
      orgSpec(org as any, ws),
      specFromManifest(parseYaml(readFileSync(manifestPath, "utf8"), "staff.yaml") as any, dir),
    );
  } else {
    tokens = orgTokens(orgSpec(org as any, ws));
  }

  const peers = staff.map((s) => s.dir ?? s.handle).filter((d) => d !== dir);
  return pasteBrief(ws, kind, renderBrief(briefTemplate(kind), tokens), { dir, peers });
}

/**
 * A brief is prose handed to a model, so an unfilled token is a wrong instruction rather than a
 * broken file. `render` throws on those, which is right for a workflow and too strict here.
 */
function renderBrief(text: string, tokens: Record<string, string>): string {
  return text.replace(/%%([A-Z_]+)%%/g, (m, name: string) => tokens[name] ?? m);
}

/** Why a write was refused. */
function refuseWrite(res: import("node:http").ServerResponse) {
  res.writeHead(403, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "write actions need a local POST from the portal" }));
}

function json(res: import("node:http").ServerResponse, data: unknown) {
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(data));
}

/** The hire flags the portal is allowed to set. Everything else keeps its default. */
function hireFlags(params: URLSearchParams): Flags {
  const num = (k: string) => (params.get(k) ? Number(params.get(k)) : undefined);
  return {
    name: params.get("name") ?? undefined,
    dir: params.get("dir") ?? undefined,
    schedule: params.get("schedule") ?? undefined,
    model: params.get("model") ?? undefined,
    timeout: num("timeout"),
    mentionTimeout: num("mentionTimeout"),
    secretPrefix: params.get("secretPrefix") ?? undefined,
    app: params.get("app") ?? undefined,
    publicApp: params.get("publicApp") ?? undefined,
    visibility: params.get("visibility") ?? undefined,
  };
}

/**
 * Both commands narrate to stdout as they work, and that narration is the useful part: which
 * repo was created, which label went where, what could not be done. Captured rather than
 * rewritten, so the portal shows exactly what the terminal would have.
 */
function capture() {
  const chunks: string[] = [];
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  const grab =
    (pass: typeof out) =>
    (chunk: any, ...rest: any[]) => {
      chunks.push(String(chunk));
      return (pass as any)(chunk, ...rest);
    };
  process.stdout.write = grab(out) as any;
  process.stderr.write = grab(err) as any;
  return {
    stop() {
      process.stdout.write = out;
      process.stderr.write = err;
    },
    text: () => chunks.join(""),
  };
}

/** The org half of the token set, for a brief that names the org and the human. */
function orgSpec(
  org: { org: string; name: string; human?: Record<string, string> },
  w: {
    opsName: string;
  },
) {
  const human = org.human ?? {};
  return {
    org: org.org,
    name: org.name,
    opsRepo: `${org.org}/${w.opsName}`,
    opsDirName: w.opsName,
    human: human.name ?? human.github ?? "the human",
    humanMarker: human.marker ?? human.github ?? "human",
    allowedTools: toolsOf(org),
  };
}

/** Every directory a prompt might write a path relative to. */
function workspaceRoots(org: {
  staff?: Array<{ handle: string; dir?: string }>;
  repos?: Array<{ name: string }>;
}): string[] {
  return [
    ...(org.staff ?? []).map((s) => s.dir ?? s.handle),
    ...(org.repos ?? []).map((r) => r.name),
  ];
}

function parseFlags(argv: string[]) {
  const out: { port?: number; ops?: string; host?: string; dir?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[++i];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flag === "--port") out.port = Number(value);
    else if (flag === "--host") out.host = value;
    else if (flag === "--ops") out.ops = value;
    else if (flag === "--dir") out.dir = value;
    else throw new Error(`unknown flag ${flag}`);
  }
  return out;
}

export { join };
