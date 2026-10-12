import { type Commit, type FactChange, factChanges, type History } from "../lib/export.js";
import type { GitHub } from "../lib/github.js";
import type { KeyValue } from "./kv.js";

/**
 * A brain's recent history, from GitHub rather than from `git log`.
 *
 * The export asks three questions of git: the last 25 commits, the last one that touched
 * memory/, and which facts came and went in the index over the last fortnight. These are the
 * same three questions over the commits API, asked once per head commit and kept, so a portal
 * that is polled all day asks them again only when an agent has pushed.
 */
export interface BrainHistory {
  recent: Commit[];
  lastMemory?: Commit;
  facts: FactChange[];
}

const DAYS = 14;

export async function loadHistory(
  gh: GitHub,
  kv: KeyValue,
  repo: string,
  head: string,
  now = Date.now(),
): Promise<BrainHistory> {
  const since = new Date(now - DAYS * 86_400_000).toISOString();
  // Per head and per day: the window moves at midnight even when nobody has pushed.
  const key = `history:${repo}@${head}:${since.slice(0, 10)}`;
  const kept = await kv.get(key);
  if (kept) return JSON.parse(kept) as BrainHistory;

  const list = (q: string) =>
    gh.request<Array<Record<string, any>>>("GET", `repos/${repo}/commits?sha=${head}&${q}`);
  const [recent, memory, index] = await Promise.all([
    list("per_page=25"),
    list("path=memory&per_page=1"),
    list(`path=memory/INDEX.md&since=${since}&per_page=100`),
  ]);

  const patches = await Promise.all(
    (index.data ?? []).map(async (c) => ({
      sha: String(c.sha),
      date: String(c.commit?.author?.date ?? ""),
      diff: await indexPatch(gh, kv, repo, String(c.sha)),
    })),
  );

  const out: BrainHistory = {
    recent: (recent.data ?? []).map(commit),
    lastMemory: (memory.data ?? []).map(commit)[0],
    facts: factChanges(patches),
  };
  // A failed read is not kept: the next request should ask again rather than show nothing all day.
  if (recent.ok && memory.ok && index.ok) await kv.put(key, JSON.stringify(out));
  return out;
}

/** One commit's change to the memory index. A commit never changes, so this is kept for good. */
async function indexPatch(gh: GitHub, kv: KeyValue, repo: string, sha: string): Promise<string> {
  const key = `patch:${repo}@${sha}:memory/INDEX.md`;
  const kept = await kv.get(key);
  if (kept !== undefined) return kept;
  const res = await gh.request<{ files?: Array<{ filename: string; patch?: string }> }>(
    "GET",
    `repos/${repo}/commits/${sha}`,
  );
  if (!res.ok) return "";
  const patch = res.data?.files?.find((f) => f.filename === "memory/INDEX.md")?.patch ?? "";
  await kv.put(key, patch);
  return patch;
}

/** `git log --format=%H%x1f%aI%x1f%s%x1f%an`, from a REST commit. */
function commit(c: Record<string, any>): Commit {
  return {
    sha: String(c.sha).slice(0, 8),
    date: String(c.commit?.author?.date ?? ""),
    subject: String(c.commit?.message ?? "").split("\n")[0]!,
    author: String(c.commit?.author?.name ?? ""),
  };
}

/** The export's `History`, answered from what was loaded, by brain directory. */
export function loadedHistory(byRoot: Map<string, BrainHistory>): History {
  return {
    log(root, n, path) {
      const h = byRoot.get(root);
      if (!h) return [];
      if (path === "memory") return h.lastMemory ? [h.lastMemory] : [];
      return h.recent.slice(0, n);
    },
    factsChanged(root) {
      return byRoot.get(root)?.facts ?? [];
    },
  };
}
