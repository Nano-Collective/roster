import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { type ActRequest, act } from "../lib/act.js";
import { docPages, docsDir } from "../lib/docs.js";
import { buildExport } from "../lib/export.js";
import { fetchInbox, fetchThread } from "../lib/inbox.js";
import { syncRepos } from "../lib/sync.js";
import { findWorkspace, loadComposer, readOrg } from "../lib/workspace.js";
import { portalAsset, portalIndex } from "../portal/assets.js";

export const portalHelp = `
roster portal

  Serve a local view of every staff member's brain: what they know, what changed, what is
  waiting on you, and every file they hold.

  Reads the checked-out repos from disk. No auth, no API rate limits, works offline.

  It can also act on GitHub as you: reply, close, reopen and open issues. Those go
  through your own gh, so they are indistinguishable from doing it on the site.

  --port <n>     default 4300
  --host <addr>  default 127.0.0.1. Anything else exposes write actions to the network.
  --ops <dir>    ops repo directory (default: found by walking up)
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
};

export async function portalCommand(argv: string[]): Promise<number> {
  const opts = parseFlags(argv);
  const ws = findWorkspace(opts.ops);
  const { parseYaml } = await loadComposer(ws.opsDir);
  const port = opts.port ?? 4300;
  const host = opts.host ?? "127.0.0.1";

  // gh calls take about a second each and the inbox hits every repo, so a short cache keeps
  // switching views instant. The refresh button bypasses it.
  let cache: { at: number; body: string } | null = null;
  const TTL = 45_000;

  const knownRepos = () => {
    const org = readOrg(ws.opsDir, parseYaml) as any;
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

  const body = (req: import("node:http").IncomingMessage) =>
    new Promise<string>((resolve, reject) => {
      let buf = "";
      req.on("data", (c) => {
        buf += c;
        if (buf.length > 1_000_000) reject(new Error("body too large"));
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

      if (url.pathname === "/api/org") {
        // Rebuilt per request so a browser refresh shows what is on disk right now,
        // including whatever an agent pushed thirty seconds ago.
        const org = readOrg(ws.opsDir, parseYaml);
        const data = buildExport(ws, org as any, parseYaml);
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        res.end(JSON.stringify(data));
        return;
      }

      if (url.pathname === "/api/act") {
        if (!writeAllowed(req)) {
          res.writeHead(403, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "write actions need a local POST from the portal" }));
          return;
        }
        body(req)
          .then(async (raw) => {
            const payload = JSON.parse(raw || "{}") as ActRequest;
            const org = readOrg(ws.opsDir, parseYaml) as any;
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

      if (url.pathname === "/api/sync") {
        const org = readOrg(ws.opsDir, parseYaml) as any;
        const dirs = [ws.opsName, ...(org.staff ?? []).map((s: any) => s.dir ?? s.handle)];
        syncRepos(ws.root, dirs)
          .then((results) => {
            cache = null; // anything pulled invalidates the inbox too
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
        const org = readOrg(ws.opsDir, parseYaml);
        const known = (org.staff ?? []).map((s) => s.dir ?? s.handle);
        if (!known.includes(dir) || !/^[0-9a-f]{7,40}$/i.test(sha)) {
          res.writeHead(400).end("bad request");
          return;
        }
        const out = execFileSync(
          "git",
          ["-C", join(ws.root, dir), "show", "--format=%an%x1f%aI%x1f%s", sha, "--", path],
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
        const full = resolve(ws.root, rel);
        // Everything the portal serves must live under the workspace. Without this a crafted
        // path walks straight out of it, and this server is trivially reachable on a LAN.
        if (
          !full.startsWith(resolve(ws.root) + "/") ||
          !existsSync(full) ||
          statSync(full).isDirectory()
        ) {
          res.writeHead(404).end("not found");
          return;
        }
        const ext = extname(full).toLowerCase();
        res.writeHead(200, {
          "content-type": MIME[ext] ?? "application/octet-stream",
          "cache-control": "no-store",
        });
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
      process.stdout.write(
        `\n  roster portal\n  http://localhost:${port}\n${warn}\n  workspace: ${ws.root}\n  Ctrl-C to stop.\n\n`,
      );
    });
  });
}

function parseFlags(argv: string[]) {
  const out: { port?: number; ops?: string; host?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[++i];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flag === "--port") out.port = Number(value);
    else if (flag === "--host") out.host = value;
    else if (flag === "--ops") out.ops = value;
    else throw new Error(`unknown flag ${flag}`);
  }
  return out;
}

export { join };
