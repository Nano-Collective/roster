import { api, type GhResult } from "./gh.js";

type Api = (path: string, extra?: string[]) => Promise<GhResult<any>>;

export interface AccessResult {
  ok: boolean;
  /** It was already set, so nothing was written. */
  already?: boolean;
  /** Why GitHub refused, in its own words. */
  error?: string;
  /** Where to click instead, when it was refused. */
  link: string;
}

/** The settings page to click through by hand, which is the fallback for every refusal. */
export function accessLink(org: string, repo: string): string {
  return `https://github.com/${org}/${repo}/settings/actions`;
}

/**
 * Let every repo in the org call the ops repo's reusable workflow.
 *
 * Skipped, every caller fails with "workflow not found", which reads like a typo and is a
 * permission. The API for it needs admin on the ops repo; whoever just created it normally has
 * that, and whoever joined an org may not, so a refusal is an answer to report with the page to
 * click rather than an error. Read first, so running it twice writes nothing.
 */
export async function allowOrgCallers(
  org: string,
  repo: string,
  gh: Api = api,
): Promise<AccessResult> {
  const link = accessLink(org, repo);
  const path = `repos/${org}/${repo}/actions/permissions/access`;
  const now = await gh(path);
  if (now.ok && now.data?.access_level === "organization") return { ok: true, already: true, link };

  const set = await gh(path, ["-X", "PUT", "-f", "access_level=organization"]);
  if (set.ok) return { ok: true, link };
  return { ok: false, error: refusal(set), link };
}

/** GitHub's reasons, turned into what to do about them. */
function refusal(res: GhResult<unknown>): string {
  const why = res.error ?? "unknown error";
  if (res.status === 403 || res.status === 404) {
    return `${why}. Setting this needs admin on the repo, and your gh token does not have it here`;
  }
  if (res.status === 422) return `${why}. GitHub only offers this on a private or internal repo`;
  return why;
}
