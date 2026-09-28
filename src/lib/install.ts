import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { api, type GhResult } from "./gh.js";
import type { Workspace } from "./workspace.js";

/**
 * Every repo a staff member's App has to be installed on: its own brain, each peer's tracker,
 * and the product repos it works in.
 *
 * The token is minted for the whole installation, and a peer's board is where a brief lands, so
 * an install that grants only the brain looks done and fails the first time it files work
 * anywhere else. Collected here so `roster app` and the portal ask for the same list.
 */
export function installTargets(
  ws: Workspace,
  org: { staff?: Array<{ handle: string; dir?: string }> },
  parseYaml: (t: string, f?: string) => Record<string, unknown>,
  handle: string,
  spec: { brain: string; worksIn: string[] },
): string[] {
  const peers: string[] = [];
  for (const s of org.staff ?? []) {
    if (s.handle === handle) continue;
    const p = join(ws.root, s.dir ?? s.handle, "staff.yaml");
    if (!existsSync(p)) continue;
    try {
      const m = parseYaml(readFileSync(p, "utf8"), "staff.yaml") as { brain?: string };
      if (m.brain) peers.push(String(m.brain));
    } catch {
      /* a manifest that will not parse is doctor's problem, not the install's */
    }
  }
  return [...new Set([spec.brain, ...spec.worksIn, ...peers])];
}

/**
 * The install page, with the org and the repos already chosen.
 *
 * `suggested_target_id` and `repository_ids[]` are what GitHub's own "Configure" links use on
 * this page. They are not in GitHub's documentation, so without the ids this is the plain
 * install page, which still works and only asks the person to pick. The person still confirms
 * either way: pre-selecting is a suggestion, not a grant.
 */
export function installUrl(slug: string, targetId?: number, repoIds: number[] = []): string {
  const base = `https://github.com/apps/${encodeURIComponent(slug)}/installations/new`;
  if (!targetId) return base;
  const q = [`suggested_target_id=${targetId}`, ...repoIds.map((id) => `repository_ids[]=${id}`)];
  return `${base}/permissions?${q.join("&")}`;
}

type Api = (path: string, extra?: string[]) => Promise<GhResult<any>>;

/**
 * The install URL for these repos, resolving the ids GitHub wants.
 *
 * A repo that cannot be read is left out rather than failing the whole link, and says so: the
 * person can still tick it by hand, and an unreadable repo is doctor's finding, not this one's.
 */
export async function preselectedInstall(
  slug: string,
  org: string,
  repos: string[],
  gh: Api = api,
): Promise<{ url: string; preselected: string[]; missing: string[] }> {
  const owner = await gh(`orgs/${org}`);
  const targetId = owner.ok ? Number(owner.data?.id) || undefined : undefined;
  if (!targetId) return { url: installUrl(slug), preselected: [], missing: repos };

  const found = await Promise.all(repos.map((r) => gh(`repos/${r}`)));
  const ids: number[] = [];
  const preselected: string[] = [];
  const missing: string[] = [];
  found.forEach((res, i) => {
    const id = res.ok ? Number(res.data?.id) : 0;
    if (id) {
      ids.push(id);
      preselected.push(repos[i]!);
    } else missing.push(repos[i]!);
  });
  return { url: installUrl(slug, targetId, ids), preselected, missing };
}
