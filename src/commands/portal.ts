import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import {
  type AppSpec,
  buildManifest,
  exchange,
  handoffPage,
  setSecret,
} from "../lib/appmanifest.js";
import { MAX_UPLOAD } from "../lib/attach.js";
import { bin, withBin } from "../lib/bin.js";
import { openBrowser, shouldOpen } from "../lib/browser.js";
import { accessLink, allowOrgCallers } from "../lib/callable.js";
import { planCredential, readOrgSecret, writeCredential } from "../lib/credential.js";
import { api, ghJson } from "../lib/gh.js";
import type { GitHub } from "../lib/github.js";
import { installTargets, preselectedInstall } from "../lib/install.js";
import { localGitHub } from "../lib/localtoken.js";
import { saveFile } from "../lib/prompt.js";
import { specFromManifest } from "../lib/render.js";
import {
  AGENTS,
  joinTenant,
  loadFrameworkComposer,
  orgHasTenant,
  setupStatus,
} from "../lib/setup.js";
import { syncRepos } from "../lib/sync.js";
import { loadComposer, readOrg, tryWorkspace, type Workspace } from "../lib/workspace.js";
import { portalAsset, portalIndex } from "../portal/assets.js";
import {
  type Actor,
  createPortal,
  handlePortal,
  isPortalRoute,
  type Portal,
} from "../portal/handler.js";
import { layeredKV } from "../portal/kv.js";
import { diskKV } from "../portal/kv-disk.js";
import { deployCommand } from "./deploy.js";
import { collect } from "./doctor.js";
import { fixBrief, gather } from "./fix.js";
import {
  agentTokenEnv,
  applyPlan,
  buildPlan,
  type Flags,
  insertUnder,
  type OrgYaml,
} from "./hire.js";
import { initCommand, initFiles } from "./init.js";
import { applyRetirePlan, buildRetirePlan } from "./retire.js";

export const portalHelp = `
roster portal

  Serve a local view of every staff member's brain: what they know, what changed, what is
  waiting on you, and every file they hold.

  Reads the org from GitHub as you, with your gh login: no checkout needed to look, and what
  it shows is what is on GitHub now. Pass --org to open one you have never cloned.

  With no tenant where you started it, this is the setup screen instead: it stands up a new
  org, or checks out one that already runs roster. \`roster\` with no arguments does the same.

  It can also act on GitHub as you: reply, close, reopen and open issues. Those use your
  own gh token, so they are indistinguishable from doing it on the site.

  --port <n>     default 4300, or the next free one
  --host <addr>  default 127.0.0.1. Anything else exposes write actions to the network.
  --ops <dir>    ops repo directory (default: found by walking up)
  --dir <path>   where a tenant would be created or checked out (default: here)
  --org <org>    the org to show, with no checkout at all (default: the checkout's org.yaml)
  --ops-repo <n> its ops repo's name, with --org (default: roster-ops)
  --no-open      don't open a browser (also off in CI, over SSH, or with BROWSER=none)

  roster portal deploy puts it on the web instead, behind Sign in with GitHub. See
  roster help deploy.
`;

/**
 * Hand-offs in flight, keyed by the state GitHub echoes back.
 *
 * In memory and never persisted: a manifest code is good for an hour, and a restarted portal
 * has no business resuming somebody else's App creation.
 */
const pendingApps = new Map<
  string,
  { spec: AppSpec; brain: string; prefix: string; org: string; targets: string[] }
>();
const appResults = new Map<string, Record<string, unknown>>();

export async function portalCommand(argv: string[]): Promise<number> {
  if (argv[0] === "deploy") return deployCommand(argv.slice(1));
  const opts = parseFlags(argv);
  // Reassigned if 4300 is taken and nobody asked for a port: see the listen below.
  let port = opts.port ?? 4300;
  const host = opts.host ?? "127.0.0.1";
  const startedIn = resolve(opts.ops ?? opts.dir ?? process.cwd());

  /* The portal used to refuse to start without a tenant, which made the surface that should
     run your setup depend on the output of your setup. Now a missing workspace is a mode: the
     server comes up, mounts the setup routes, and re-resolves itself the moment `org.yaml`
     lands on disk. Everything below is `let` for that one reason. */
  let ws = tryWorkspace(startedIn);
  let composer = ws ? await loadComposer(ws.opsDir) : await loadFrameworkComposer();
  const _compose = (...args: Parameters<typeof composer.compose>) => composer.compose(...args);
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
    portal = portalFor(found);
    return true;
  };

  /**
   * The org this serves, read from GitHub. Which org comes from `--org`, or from the checkout
   * the portal was started in; with neither there is no tenant yet and this is the setup screen.
   *
   * One portal for the life of the process, because it holds the snapshots and their cache.
   */
  const kv = layeredKV(diskKV());
  let portal: Portal | null = null;
  const portalFor = (w: Workspace | null): Portal | null => {
    const org = opts.org ?? (w ? String(readOrg(w.opsDir, parseYaml).org ?? "") : "");
    if (!org) return null;
    if (portal?.org === org) return portal;
    return createPortal({
      org,
      opsName: opts.opsRepo ?? w?.opsName ?? "roster-ops",
      kv,
      bin: bin(),
    });
  };
  portal = portalFor(ws);

  /**
   * One request through the shared handler, as you: your token, and this server's write guard.
   * `/api/sync` also fast-forwards the checkout when there is one, because hiring and setup
   * still write to it and push.
   */
  const servePortable = async (
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
    url: URL,
  ) => {
    const local = await localGitHub();
    const actor: Actor = {
      gh: local.ok ? local.gh : signedOut(local.error),
      id: "local",
      canWrite: writeAllowed(req),
    };
    const method = req.method ?? "GET";
    const raw = method === "GET" || method === "HEAD" ? undefined : await bytes(req);
    const request = new Request(new URL(url.pathname + url.search, "http://localhost"), {
      method,
      headers: Object.entries(req.headers).flatMap(([k, v]) =>
        v === undefined ? [] : [[k, Array.isArray(v) ? v.join(", ") : v] as [string, string]],
      ),
      body: raw,
    });
    let answer = await handlePortal(request, portal, actor);
    if (url.pathname === "/api/sync" && ws && answer?.ok) {
      const org = readOrg(ws.opsDir, parseYaml) as any;
      const dirs = [ws.opsName, ...(org.staff ?? []).map((s: any) => s.dir ?? s.handle)];
      const disk = await syncRepos(ws.root, dirs);
      const github = ((await answer.json()) as { results: Array<{ pulled: boolean }> }).results;
      answer = Response.json({ results: [...github, ...disk] });
    }
    if (!answer) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(answer.status, Object.fromEntries(answer.headers));
    // Passed on as it arrives, so a streamed answer (the first load's progress) is not held back.
    if (!answer.body) {
      res.end();
      return;
    }
    const reader = answer.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
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
      json(res, { ...(await setupStatus(startedIn)), startedIn }, true);
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
      const targets = installTargets(
        ws,
        org,
        parseYaml,
        entry.handle,
        spec,
        isPublic ? "public" : "private",
      );
      const existing = await api<{ slug: string }>(`/apps/${name}`);
      if (existing.ok) {
        const install = await preselectedInstall(existing.data?.slug ?? name, org.org, targets);
        res.writeHead(409, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            error: `An App called "${name}" already exists. If it is yours it only needs installing.`,
            install: install.url,
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
        targets,
      });
      json(res, { state, start: `/setup/app/start?state=${state}` });
      return;
    }

    /* The ops repo's Actions access. Read on GET so the page can say it is done without
       anybody pressing anything; set on a guarded POST, with GitHub's reason and the page to
       click when it refuses. */
    if (route === "access") {
      if (!ws) {
        refuseWrite(res);
        return;
      }
      const org = readOrg(ws.opsDir, parseYaml).org;
      const link = accessLink(org, ws.opsName);
      if (req.method === "POST") {
        if (!writeAllowed(req)) {
          refuseWrite(res);
          return;
        }
        json(res, await allowOrgCallers(org, ws.opsName));
        return;
      }
      const now = await api<{ access_level: string }>(
        `repos/${org}/${ws.opsName}/actions/permissions/access`,
      );
      json(res, {
        ok: now.ok && now.data?.access_level === "organization",
        level: now.data?.access_level,
        error: now.ok ? undefined : now.error,
        link,
      });
      return;
    }

    /* The agent credential, once for the org. The value comes in on a local POST and goes out
       on gh's stdin: it is never logged, never written, and never echoed back. */
    if (route === "credential") {
      if (!ws) {
        refuseWrite(res);
        return;
      }
      const org = readOrg(ws.opsDir, parseYaml) as OrgYaml;
      const name = agentTokenEnv(org);
      const brains = (org.staff ?? []).map((s) => `${org.org}/${s.dir ?? s.handle}`);
      if (req.method === "POST") {
        if (!writeAllowed(req)) {
          refuseWrite(res);
          return;
        }
        const payload = JSON.parse((await body(req)) || "{}") as {
          value?: string;
          repoSecrets?: boolean;
        };
        const plan = await planCredential(org.org, name, brains, {
          repoSecrets: payload.repoSecrets === true,
        });
        try {
          json(res, { ok: true, ...(await writeCredential(plan, String(payload.value ?? ""))) });
        } catch (err) {
          json(res, { ok: false, error: (err as Error).message });
        }
        return;
      }
      const agentId = String((org as any).agent?.id ?? (org as any).agent ?? "claude-code-action");
      /* A credential can live on each brain repo instead of once for the org (older orgs, and
         GitHub Free with private repos). Either way it is stored, and asking for it again made
         a working org look unfinished. */
      const [plan, orgSecret, onRepos] = await Promise.all([
        planCredential(org.org, name, brains),
        readOrgSecret(org.org, name),
        Promise.all(brains.map((b) => api(`repos/${b}/actions/secrets/${name}`).then((r) => r.ok))),
      ]);
      const repoSecrets = brains.filter((_, i) => onRepos[i]);
      json(res, {
        name,
        brains,
        plan,
        orgSecret,
        repoSecrets,
        stored: Boolean(orgSecret) || (brains.length > 0 && repoSecrets.length === brains.length),
        howTo: AGENTS.find((a) => a.id === agentId)?.howTo,
      });
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
      const payload = JSON.parse((await body(req)) || "{}") as {
        name?: string;
        role?: string;
        visibility?: string;
      };
      const name = String(payload.name ?? "");
      const role = String(payload.role ?? "product");
      /* The picker knows what gh said. Writing `private` regardless told hire a public product
         repo needed no public identity, which is the one case where it does. */
      const visibility = String(payload.visibility ?? "private").toLowerCase();
      if (
        !/^[\w.-]+$/.test(name) ||
        !/^(product|brain|ops|repo)$/.test(role) ||
        !/^(private|public|internal)$/.test(visibility)
      ) {
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
        insertUnder(
          text,
          "repos",
          `  - { name: ${name}, visibility: ${visibility}, role: ${role} }`,
        ),
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
            ...(
              await initFiles({
                org,
                name: String(params.name ?? org),
                human: String(params.human ?? ""),
                marker: String(params.marker ?? "human"),
                opsName: "roster-ops",
                agent: String(params.agent ?? "claude-code-action"),
              })
            ).keys(),
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

      /* Every route that works the same hosted as it does here: the org read from GitHub, and
         acting on it as you. The rest of this server is what needs a checkout. */
      if (isPortalRoute(url.pathname)) {
        servePortable(req, res, url).catch((err) => {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: String(err?.message ?? err) }));
        });
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
            const install = await preselectedInstall(app.slug, pending.org, pending.targets);
            appResults.set(state, {
              ok: true,
              slug: app.slug,
              install: install.url,
              preselected: install.preselected,
              missing: install.missing,
            });
            res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
            res.end(
              `<body style="font:15px/1.6 system-ui;max-width:34rem;margin:14vh auto;padding:0 1.4rem">` +
                `<h1 style="font-size:1.3rem">${app.slug} created</h1>` +
                `<p>Its keys are saved in ${pending.brain}'s secrets.</p>` +
                `<p><b>Next: install it.</b> Go back to the portal and press Install.</p>` +
                `<p>You can close this tab.</p></body>`,
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
          .then((report) => json(res, report ?? { findings: [], online: false, empty: true }, true))
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
            json(res, { action, plan }, true);
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
          void readOrgSecret(org.org, plan.staff.agentSecret).then((orgSecret) =>
            json(
              res,
              { action, plan: { ...plan, orgSecret, files: [...plan.files.keys()].sort() } },
              true,
            ),
          );
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

      /* Every scanner's findings as one brief for a coding agent. The Health screen's
         "copy all instructions" button, and `roster fix` in the terminal, are the same text. */
      if (url.pathname === "/api/fix") {
        gather(w, url.searchParams.get("offline") === "1")
          .then((items) => json(res, { items, text: fixBrief(w, items) }, true))
          .catch((err) => {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ items: [], error: String(err?.message ?? err) }));
          });
        return;
      }

      res.writeHead(404).end("not found");
    } catch (err) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(err instanceof Error ? err.message : String(err));
    }
  });

  return new Promise((done) => {
    /* A second portal (another workspace, or one left running) is common. Without --port the
       next free port is fine; with it, the person asked for that one, so say it is taken. */
    const tries = opts.port === undefined ? 20 : 1;
    let tried = 1;
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE" && tried < tries) {
        tried++;
        port++;
        server.listen(port, host);
        return;
      }
      if (err.code === "EADDRINUSE") {
        process.stderr.write(
          tries > 1
            ? `roster: ports ${port - tries + 1} to ${port} are all in use. Pass --port <n>.\n`
            : `roster: port ${port} is in use. Try --port ${port + 1}.\n`,
        );
      } else {
        process.stderr.write(`roster: ${err.message}\n`);
      }
      done(1);
    });
    server.on("listening", () => {
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
        `\n  Roster\n  http://localhost:${port}\n${warn}\n  ${where}\n  Ctrl-C to stop.\n\n`,
      );
      if (shouldOpen(process.env, Boolean(process.stdout.isTTY), opts.noOpen === true)) {
        openBrowser(`http://localhost:${port}`);
      }
    });
    server.listen(port, host);
  });
}

/** Why a write was refused. */
function refuseWrite(res: import("node:http").ServerResponse) {
  res.writeHead(403, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "write actions need a local POST from the portal" }));
}

function json(res: import("node:http").ServerResponse, data: unknown, advice = false) {
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  /* Advice the portal shows ("run roster upgrade") has to work for somebody who started it
     with npx. Only advice: a response carrying a file's text is left exactly as it is, or a
     save would write the rewrite back into the file. */
  const text = JSON.stringify(data);
  res.end(advice ? withBin(text) : text);
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

function parseFlags(argv: string[]) {
  const out: {
    port?: number;
    ops?: string;
    host?: string;
    dir?: string;
    noOpen?: boolean;
    org?: string;
    opsRepo?: string;
  } = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--no-open") {
      out.noOpen = true;
      continue;
    }
    const value = argv[++i];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flag === "--port") out.port = Number(value);
    else if (flag === "--host") out.host = value;
    else if (flag === "--ops") out.ops = value;
    else if (flag === "--dir") out.dir = value;
    else if (flag === "--org") out.org = value;
    else if (flag === "--ops-repo") out.opsRepo = value;
    else throw new Error(`unknown flag ${flag}`);
  }
  return out;
}

/** Everything a request body holds, for handing on as a fetch Request. */
function bytes(req: import("node:http").IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      // The upload cap, with base64's third on top; anything bigger is not a portal request.
      if (size > Math.ceil(MAX_UPLOAD * 1.4) + 1_000_000) reject(new Error("body too large"));
      else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/** A client for when there is no token: every call says why, rather than failing obscurely. */
function signedOut(error: string): GitHub {
  const no = async () => ({ ok: false as const, status: 401, error });
  return { request: no, graphql: no };
}

export { join };
