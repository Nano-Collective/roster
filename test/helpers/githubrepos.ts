import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";
import type { ApiResult, GitHub, RequestOpts } from "../../src/lib/github.js";

/**
 * Directories on disk, served as if they were repositories on GitHub.
 *
 * Enough of the API for the portal's snapshots and writes: the head, the tree, blobs, a
 * tarball, a commit, and the contents endpoint for a write. Each repository's head is a hash of
 * what is in it, so changing a file on disk is a new commit as far as the portal can tell.
 *
 * `calls` is every request, and `writes` every file committed, so a test can say what the
 * portal asked for as well as what it showed.
 */
export interface FakeRepos extends GitHub {
  calls: string[];
  writes: Array<{ repo: string; path: string; text: string; sha?: string; message: string }>;
}

export function serveRepos(owner: string, root: string, dirs: string[]): FakeRepos {
  const calls: string[] = [];
  const writes: FakeRepos["writes"] = [];

  const files = (dir: string) => {
    const out = new Map<string, Buffer>();
    const walk = (d: string) => {
      for (const name of readdirSync(d)) {
        if (name === ".git") continue;
        const full = join(d, name);
        if (statSync(full).isDirectory()) walk(full);
        else out.set(relative(join(root, dir), full).replaceAll("\\", "/"), readFileSync(full));
      }
    };
    walk(join(root, dir));
    return out;
  };
  const blobSha = (b: Buffer) =>
    createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex");
  const head = (dir: string) => {
    const h = createHash("sha1");
    for (const [p, b] of [...files(dir)].sort()) h.update(p).update(blobSha(b));
    return h.digest("hex");
  };

  const ok = <T>(data: unknown, status = 200): ApiResult<T> => ({
    ok: true,
    status,
    data: data as T,
  });
  const no = <T>(status = 404, error = "Not Found"): ApiResult<T> => ({ ok: false, status, error });

  return {
    calls,
    writes,
    async graphql<T>() {
      calls.push("GRAPHQL");
      // File dates: none known, so everything is dated by its commit.
      return ok<T>({ repository: { object: {} } });
    },
    async request<T>(method: string, path: string, opts: RequestOpts = {}) {
      calls.push(`${method} ${path}`);
      const m = new RegExp(`^repos/${owner}/([^/]+)/(.*)$`).exec(path.split("?")[0]!);
      if (!m || !dirs.includes(m[1]!)) return no<T>();
      const dir = m[1]!;
      const rest = m[2]!;
      const all = files(dir);

      if (method === "GET" && rest === "commits/HEAD") return ok<T>(head(dir));
      if (method === "GET" && rest.startsWith("git/trees/")) {
        const tree = [...all].map(([p, b]) => ({
          path: p,
          type: "blob",
          size: b.length,
          sha: blobSha(b),
        }));
        return ok<T>({ tree });
      }
      if (method === "GET" && rest.startsWith("git/blobs/")) {
        const sha = rest.slice("git/blobs/".length);
        const hit = [...all.values()].find((b) => blobSha(b) === sha);
        return hit ? ok<T>(new Uint8Array(hit)) : no<T>();
      }
      if (method === "GET" && rest.startsWith("tarball/")) {
        return ok<T>(new Uint8Array(gzipSync(tar(`${owner}-${dir}-x`, all))));
      }
      if (method === "GET" && rest === "commits") return ok<T>([]);
      if (method === "GET" && rest.startsWith("commits/")) {
        return ok<T>({ commit: { committer: { date: "2026-10-01T00:00:00Z" } }, files: [] });
      }
      if (method === "PUT" && rest.startsWith("contents/")) {
        const file = decodeURIComponent(rest.slice("contents/".length));
        const body = opts.body as { message: string; content: string; sha?: string };
        const current = all.get(file);
        if (current && body.sha !== blobSha(current)) return no<T>(409, "does not match");
        const text = Buffer.from(body.content, "base64").toString("utf8");
        writes.push({
          repo: `${owner}/${dir}`,
          path: file,
          text,
          sha: body.sha,
          message: body.message,
        });
        // Committed, so the repository's head moves to match.
        writeFileSync(join(root, dir, file), text);
        return ok<T>({
          commit: { sha: head(dir) },
          content: {
            sha: blobSha(Buffer.from(text)),
            html_url: `https://github.com/${owner}/${dir}/blob/main/${file}`,
          },
        });
      }
      return no<T>();
    },
  };
}

/** A ustar archive with one top directory, which is how GitHub's tarballs are laid out. */
export function tar(top: string, files: Map<string, Buffer>): Buffer {
  const blocks: Buffer[] = [];
  const header = (name: string, size: number, type: string) => {
    const h = Buffer.alloc(512);
    h.write(name.slice(0, 100), 0);
    h.write("0000644\0", 100);
    h.write("0000000\0", 108);
    h.write("0000000\0", 116);
    h.write(`${size.toString(8).padStart(11, "0")}\0`, 124);
    h.write("00000000000\0", 136);
    h.write("        ", 148);
    h.write(type, 156);
    h.write("ustar\0", 257);
    h.write("00", 263);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
    return h;
  };
  blocks.push(header(`${top}/`, 0, "5"));
  for (const [path, body] of files) {
    blocks.push(header(`${top}/${path}`, body.length, "0"), body);
    const pad = (512 - (body.length % 512)) % 512;
    if (pad) blocks.push(Buffer.alloc(pad));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}
