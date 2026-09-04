import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve, extname } from "node:path";
import { findWorkspace, loadComposer, readOrg } from "../lib/workspace.js";
import { buildExport } from "../lib/export.js";
import { PORTAL_HTML } from "../portal/html.js";

export const portalHelp = `
roster portal

  Serve a local view of every staff member's brain: what they know, what changed, what is
  waiting on you, and every file they hold.

  Reads the checked-out repos from disk. No auth, no API rate limits, works offline.

  --port <n>     default 4300
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

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    try {
      if (url.pathname === "/") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(PORTAL_HTML);
        return;
      }

      if (url.pathname === "/api/org") {
        // Rebuilt per request so a browser refresh shows what is on disk right now,
        // including whatever an agent pushed thirty seconds ago.
        const org = readOrg(ws.opsDir, parseYaml);
        const data = buildExport(ws, org as any, parseYaml);
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(data));
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
        const out = execFileSync("git", ["-C", join(ws.root, dir), "show", "--format=%an%x1f%aI%x1f%s", sha, "--", path], {
          encoding: "utf8",
          maxBuffer: 8 * 1024 * 1024,
        });
        res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
        res.end(out);
        return;
      }

      if (url.pathname === "/api/file") {
        const rel = url.searchParams.get("path") ?? "";
        const full = resolve(ws.root, rel);
        // Everything the portal serves must live under the workspace. Without this a crafted
        // path walks straight out of it, and this server is trivially reachable on a LAN.
        if (!full.startsWith(resolve(ws.root) + "/") || !existsSync(full) || statSync(full).isDirectory()) {
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
    server.listen(port, () => {
      process.stdout.write(`\n  roster portal\n  http://localhost:${port}\n\n  workspace: ${ws.root}\n  Ctrl-C to stop.\n\n`);
    });
  });
}

function parseFlags(argv: string[]) {
  const out: { port?: number; ops?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[++i];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flag === "--port") out.port = Number(value);
    else if (flag === "--ops") out.ops = value;
    else throw new Error(`unknown flag ${flag}`);
  }
  return out;
}

export { join };
