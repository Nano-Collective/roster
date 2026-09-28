import { setOrgSecret, setSecret } from "./appmanifest.js";
import { api, type GhResult } from "./gh.js";

type Api = (path: string, extra?: string[]) => Promise<GhResult<any>>;

/**
 * Where the agent's credential goes, decided before anything is written.
 *
 * One organisation secret, shared with the brain repos, is the default: it is set once, and a
 * hire adds its repo to the list. It falls back to a secret on each brain, and says why, in the
 * two cases where an org secret would be set and then never arrive. On GitHub Free an org
 * secret does not reach a private repo, and every brain is private. And only an org owner can
 * set one, which is also who can read the plan; a gh that cannot read it cannot write it.
 */
export interface CredentialPlan {
  name: string;
  org: string;
  brains: string[];
  mode: "org" | "repo";
  reason: string;
}

export async function planCredential(
  org: string,
  name: string,
  brains: string[],
  opts: { repoSecrets?: boolean } = {},
  gh: Api = api,
): Promise<CredentialPlan> {
  const base = { name, org, brains };
  if (opts.repoSecrets) {
    return { ...base, mode: "repo", reason: "you asked for a secret on each repo" };
  }
  const info = await gh(`orgs/${org}`);
  const plan = info.ok ? info.data?.plan?.name : undefined;
  if (!plan) {
    return {
      ...base,
      mode: "repo",
      reason:
        "your gh cannot read the org's plan, which only an owner can, and only an owner can set an org secret",
    };
  }
  if (plan === "free") {
    return {
      ...base,
      mode: "repo",
      reason:
        "on GitHub Free an org secret does not reach private repos, and every brain is private",
    };
  }
  return { ...base, mode: "org", reason: "one secret for the org, shared with each brain" };
}

export interface Written {
  mode: "org" | "repo";
  /** Where it landed. */
  repos: string[];
  /** The org secret was refused and repo secrets were written instead: why. */
  fellBack?: string;
}

/**
 * Write it where the plan said. The value arrives on stdin at gh and nowhere else.
 *
 * A refused org secret falls back to repo secrets rather than stopping, because the plan said
 * it would and the person has already pasted a credential they may not want to fetch again. The
 * usual refusal is a token without `admin:org`, so the fallback carries the command that adds it.
 */
export async function writeCredential(
  plan: CredentialPlan,
  value: string,
  set = { org: setOrgSecret, repo: setSecret },
): Promise<Written> {
  if (!value.trim()) throw new Error("the credential is empty");
  if (!plan.brains.length) throw new Error("there are no brain repos yet. Hire someone first");
  let fellBack: string | undefined;
  if (plan.mode === "org") {
    try {
      await set.org(plan.org, plan.name, plan.brains.map(repoName), value.trim());
      return { mode: "org", repos: plan.brains };
    } catch (err) {
      fellBack =
        `${(err as Error).message}. An org secret needs the admin:org scope: ` +
        "gh auth refresh -h github.com -s admin:org";
    }
  }
  for (const repo of plan.brains) await set.repo(repo, plan.name, value.trim());
  return { mode: "repo", repos: plan.brains, fellBack };
}

/** How an org secret is shared, when there is one. `null` is none. */
export async function readOrgSecret(
  org: string,
  name: string,
  gh: Api = api,
): Promise<{ visibility: string } | null> {
  const res = await gh(`orgs/${org}/actions/secrets/${name}`);
  return res.ok && res.data?.visibility ? { visibility: String(res.data.visibility) } : null;
}

/**
 * Add a new brain to the org secret's repo list, which is what makes "once per org" true.
 *
 * Only a `selected` secret has a list. One shared with `all` or every `private` repo already
 * reaches the new brain, and writing to it would be an error from GitHub.
 */
export async function shareOrgSecret(
  org: string,
  name: string,
  repo: string,
  gh: Api = api,
): Promise<{ ok: boolean; note: string }> {
  const secret = await readOrgSecret(org, name, gh);
  if (!secret) return { ok: false, note: `there is no org secret ${name}` };
  if (secret.visibility !== "selected") {
    return {
      ok: true,
      note: `${name} is shared with ${secret.visibility} repos, ${repo} included`,
    };
  }
  const found = await gh(`repos/${repo}`);
  const id = found.ok ? Number(found.data?.id) : 0;
  if (!id) return { ok: false, note: `could not read ${repo}'s id: ${found.error}` };
  const added = await gh(`orgs/${org}/actions/secrets/${name}/repositories/${id}`, ["-X", "PUT"]);
  return added.ok
    ? { ok: true, note: `${repo} can read the org secret ${name}` }
    : {
        ok: false,
        note:
          `could not share ${name} with ${repo}: ${added.error}. ` +
          `roster credential --apply sets it again for every brain`,
      };
}

/** `--repos` takes names inside the org, not `owner/name`. */
function repoName(full: string): string {
  return full.includes("/") ? full.split("/")[1]! : full;
}
