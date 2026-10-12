import { untargz } from "../lib/archive.js";
import type { GitHub } from "../lib/github.js";
import type { VirtualFile, VirtualTree } from "../lib/vfs.js";
import type { KeyValue } from "./kv.js";

/**
 * A repository, as it is on GitHub right now, held in memory.
 *
 * This is what the portal reads instead of a checkout. The parsing is unchanged — it is the
 * same `readFileSync` over the same paths, through `vfs.ts` — so the only new thing is keeping
 * the copy current, and the rule for that is cheap enough to run on every request:
 *
 * 1. Ask GitHub for the default branch's head, conditionally. Unchanged is a 304, and a 304
 *    does not count against the hour's allowance. Most requests stop here.
 * 2. When it moved, read the new tree: every path, its size and its blob sha, in one call.
 * 3. Fetch the bodies of the text files whose blob sha has not been seen before. A commit that
 *    changed three files fetches three blobs. A first load, with nothing seen, takes the whole
 *    repository as one tarball instead of hundreds of blobs.
 *
 * Blobs are kept by sha in a `KeyValue`, so a restarted portal (or a fresh Worker) is warm again
 * after the one head check. Large and binary files are listed with their size and fetched only
 * when someone opens one.
 */

/** Bigger than this, or not text, and the body is not held. A brain's notes are a few KiB each. */
const MAX_TEXT = 512 * 1024;
/** More missing bodies than this and one tarball beats that many requests. */
const TARBALL_OVER = 25;
/** GraphQL aliases per file-date query. */
const DATES_PER_QUERY = 80;

const BINARY =
  /\.(png|jpe?g|gif|webp|ico|bmp|tiff?|pdf|zip|gz|tgz|tar|7z|mp[34]|m4[av]|mov|webm|ogv|oga|wav|flac|woff2?|ttf|otf|eot|psd|sketch|fig|heic|avif|wasm)$/i;

export function isTextPath(path: string, size: number): boolean {
  return size <= MAX_TEXT && !BINARY.test(path);
}

interface Entry {
  size: number;
  sha: string;
  text?: string;
  mtime?: string;
}

export interface RepoSnapshot {
  repo: string;
  /** The commit this is a picture of. */
  sha: string;
  /** When that commit was made, which is the date of anything with no date of its own. */
  date: string;
  files: Map<string, Entry>;
  dirs: Map<string, Set<string>>;
  /** True when only the paths were read, never the bodies: a product repo, for "does it exist". */
  pathsOnly: boolean;
}

export interface RefreshResult {
  ok: boolean;
  /** The head moved and the snapshot was rebuilt. */
  changed: boolean;
  error?: string;
  status?: number;
}

export class Snapshots {
  private repos = new Map<string, RepoSnapshot>();
  private inflight = new Map<string, Promise<RefreshResult>>();
  private checked = new Map<string, number>();

  constructor(
    private kv: KeyValue,
    /** How long a head check is trusted before it is asked again. */
    private freshMs = 4_000,
  ) {}

  get(repo: string): RepoSnapshot | undefined {
    return this.repos.get(repo);
  }

  /**
   * Bring one repository up to date with GitHub, as whoever `gh` is.
   *
   * Concurrent calls for the same repository share one refresh. `force` skips the few seconds a
   * head check is trusted for, which is what a refresh button and a write both want.
   */
  refresh(
    gh: GitHub,
    repo: string,
    opts: { force?: boolean; pathsOnly?: boolean } = {},
  ): Promise<RefreshResult> {
    const last = this.checked.get(repo) ?? 0;
    if (!opts.force && this.repos.has(repo) && Date.now() - last < this.freshMs) {
      return Promise.resolve({ ok: true, changed: false });
    }
    const running = this.inflight.get(repo);
    if (running) return running;
    const work = this.load(gh, repo, opts.pathsOnly === true).finally(() =>
      this.inflight.delete(repo),
    );
    this.inflight.set(repo, work);
    return work;
  }

  /**
   * After a write the portal made itself: the file is in the new commit, so patching it in
   * saves fetching what we already know. The next head check confirms the sha.
   */
  patch(repo: string, path: string, text: string, sha: string, commit?: string): void {
    const snap = this.repos.get(repo);
    if (!snap) return;
    snap.files.set(path, {
      size: new TextEncoder().encode(text).length,
      sha,
      text,
      mtime: new Date().toISOString(),
    });
    addDirs(snap.dirs, path);
    if (commit) snap.sha = commit;
    void this.kv.put(`blob:${sha}`, text);
  }

  private async load(gh: GitHub, repo: string, pathsOnly: boolean): Promise<RefreshResult> {
    const head = await gh.request<string>("GET", `repos/${repo}/commits/HEAD`, {
      accept: "application/vnd.github.sha",
      as: "text",
    });
    if (!head.ok || !head.data) {
      return { ok: false, changed: false, error: head.error, status: head.status };
    }
    this.checked.set(repo, Date.now());
    const sha = head.data.trim();
    const before = this.repos.get(repo);
    if (before && before.sha === sha && before.pathsOnly === pathsOnly) {
      return { ok: true, changed: false };
    }

    const next = await this.build(gh, repo, sha, pathsOnly, before);
    if (!next.ok) return { ok: false, changed: false, error: next.error, status: next.status };
    this.repos.set(repo, next.snap);
    return { ok: true, changed: true };
  }

  private async build(
    gh: GitHub,
    repo: string,
    sha: string,
    pathsOnly: boolean,
    before?: RepoSnapshot,
  ): Promise<{ ok: true; snap: RepoSnapshot } | { ok: false; error?: string; status?: number }> {
    const [tree, commit] = await Promise.all([
      gh.request<{ tree: Array<{ path: string; type: string; size?: number; sha: string }> }>(
        "GET",
        `repos/${repo}/git/trees/${sha}?recursive=1`,
      ),
      gh.request<{ commit: { committer?: { date?: string } } }>(
        "GET",
        `repos/${repo}/commits/${sha}`,
      ),
    ]);
    if (!tree.ok) return { ok: false, error: tree.error, status: tree.status };
    const date = commit.data?.commit?.committer?.date ?? new Date().toISOString();

    const snap: RepoSnapshot = {
      repo,
      sha,
      date,
      files: new Map(),
      dirs: new Map([["", new Set()]]),
      pathsOnly,
    };
    for (const t of tree.data?.tree ?? []) {
      if (t.type === "tree") {
        addDirs(snap.dirs, `${t.path}/`);
        continue;
      }
      if (t.type !== "blob") continue; // a submodule is a pointer, not a file
      snap.files.set(t.path, { size: t.size ?? 0, sha: t.sha });
      addDirs(snap.dirs, t.path);
    }
    if (pathsOnly) return { ok: true, snap };

    // Bodies: what this process already holds, then the cache, then GitHub.
    const known = new Map<string, Entry>();
    for (const [_path, e] of before?.files ?? []) known.set(e.sha, e);
    const wanted = [...snap.files].filter(([path, e]) => isTextPath(path, e.size));
    const missing: Array<[string, Entry]> = [];
    await Promise.all(
      wanted.map(async ([path, e]) => {
        const held = known.get(e.sha)?.text ?? (await this.kv.get(`blob:${e.sha}`));
        if (held !== undefined) e.text = held;
        else missing.push([path, e]);
      }),
    );

    if (missing.length > TARBALL_OVER) {
      const tgz = await gh.request<Uint8Array>("GET", `repos/${repo}/tarball/${sha}`, {
        as: "bytes",
      });
      if (!tgz.ok || !tgz.data) return { ok: false, error: tgz.error, status: tgz.status };
      const need = new Set(missing.map(([p]) => p));
      for (const t of await untargz(tgz.data, (p) => need.has(p))) {
        const e = snap.files.get(t.path);
        if (!e || !t.data) continue;
        const text = decode(t.data);
        if (text === undefined) continue;
        e.text = text;
        void this.kv.put(`blob:${e.sha}`, text);
      }
    } else {
      await pool(missing, 8, async ([, e]) => {
        const res = await gh.request<Uint8Array>("GET", `repos/${repo}/git/blobs/${e.sha}`, {
          accept: "application/vnd.github.raw",
          as: "bytes",
        });
        if (!res.ok || !res.data) return;
        const text = decode(res.data);
        if (text === undefined) return;
        e.text = text;
        void this.kv.put(`blob:${e.sha}`, text);
      });
    }

    await this.dates(gh, repo, snap, before);
    return { ok: true, snap };
  }

  /**
   * When each file last changed, which a tree does not say.
   *
   * Carried over from the last snapshot for every file whose blob is the same, and asked of
   * GitHub, in batches, only for the ones that are new or changed. Kept by commit, so a warm
   * start never asks at all.
   */
  private async dates(gh: GitHub, repo: string, snap: RepoSnapshot, before?: RepoSnapshot) {
    const key = `dates:${repo}@${snap.sha}`;
    const kept = await this.kv.get(key);
    if (kept) {
      const map = JSON.parse(kept) as Record<string, string>;
      for (const [path, e] of snap.files) e.mtime = map[path];
      return;
    }

    const ask: string[] = [];
    for (const [path, e] of snap.files) {
      const prior = before?.files.get(path);
      if (prior && prior.sha === e.sha && prior.mtime) e.mtime = prior.mtime;
      else ask.push(path);
    }

    const [owner, name] = repo.split("/");
    for (let i = 0; i < ask.length; i += DATES_PER_QUERY) {
      const batch = ask.slice(i, i + DATES_PER_QUERY);
      const fields = batch
        .map(
          (p, n) =>
            `f${n}: history(first:1, path:${JSON.stringify(p)}) { nodes { committedDate } }`,
        )
        .join("\n");
      const res = await gh.graphql<{ repository: { object: Record<string, any> } }>(
        `query($owner:String!, $name:String!, $sha:GitObjectID!) {
          repository(owner:$owner, name:$name) { object(oid:$sha) { ... on Commit { ${fields} } } }
        }`,
        { owner, name, sha: snap.sha },
      );
      const obj = res.ok ? res.data?.repository?.object : null;
      batch.forEach((path, n) => {
        const date = obj?.[`f${n}`]?.nodes?.[0]?.committedDate;
        if (date) snap.files.get(path)!.mtime = date;
      });
    }

    const map: Record<string, string> = {};
    for (const [path, e] of snap.files) if (e.mtime) map[path] = e.mtime;
    void this.kv.put(key, JSON.stringify(map));
  }

  /** Every snapshot held, as one directory with a folder per repository, as a workspace has. */
  tree(dirOf: (repo: string) => string): VirtualTree {
    const byDir = () => {
      const out = new Map<string, RepoSnapshot>();
      for (const snap of this.repos.values()) out.set(dirOf(snap.repo), snap);
      return out;
    };
    return {
      file: (rel) => {
        const slash = rel.indexOf("/");
        if (slash < 0) return undefined;
        const snap = byDir().get(rel.slice(0, slash));
        const e = snap?.files.get(rel.slice(slash + 1));
        if (!snap || !e) return undefined;
        const file: VirtualFile = { size: e.size, mtime: new Date(e.mtime ?? snap.date) };
        if (e.text !== undefined) file.text = e.text;
        return file;
      },
      dir: (rel) => {
        const dirs = byDir();
        if (!rel) return [...dirs.keys()];
        const slash = rel.indexOf("/");
        const snap = dirs.get(slash < 0 ? rel : rel.slice(0, slash));
        const names = snap?.dirs.get(slash < 0 ? "" : rel.slice(slash + 1));
        return names ? [...names] : undefined;
      },
    };
  }
}

/** Register every directory on the way to `path`, and the leaf in its parent. */
function addDirs(dirs: Map<string, Set<string>>, path: string): void {
  const parts = path.split("/");
  let dir = "";
  for (let i = 0; i < parts.length; i++) {
    const name = parts[i]!;
    if (!name) break;
    if (!dirs.has(dir)) dirs.set(dir, new Set());
    dirs.get(dir)!.add(name);
    dir = dir ? `${dir}/${name}` : name;
    if (i < parts.length - 1 && !dirs.has(dir)) dirs.set(dir, new Set());
  }
}

/** UTF-8, or undefined for something that is not text after all. */
function decode(bytes: Uint8Array): string | undefined {
  if (bytes.subarray(0, 8000).includes(0)) return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

async function pool<T>(items: T[], size: number, work: (item: T) => Promise<void>) {
  let next = 0;
  const lanes = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) await work(items[next++]!);
  });
  await Promise.all(lanes);
}
