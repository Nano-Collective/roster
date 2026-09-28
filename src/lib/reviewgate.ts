import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { api } from "./gh.js";

/**
 * "Nothing goes out unread" is the promise the whole autonomy contract rests on, and until this
 * it was kept by the human's discipline alone. The staff open PRs on a product repo; what stops
 * one of them merging its own is a rule on the default branch that needs an approving review,
 * with no staff App on the list of who may skip it.
 *
 * Both of GitHub's mechanisms are read, rulesets and classic branch protection, because an org
 * may use either and the stricter one is what applies.
 */
export interface GateReading {
  repo: string;
  branch?: string;
  /** Approvals a merge needs. `null` when nothing requires a pull request at all. */
  approvals: number | null;
  /** Staff Apps allowed to skip the rule. */
  bypass: string[];
  /** Set when the settings could not be read, which is not the same as their being absent. */
  error?: string;
}

/**
 * GitHub's answer when a free plan asks about protection on a private repo. It is not a missing
 * permission and not a missing rule: the feature is off for that repo, and saying "could not
 * read" sent people looking for an admin setting that does not exist.
 */
const PLAN_LIMIT = /upgrade to github (pro|team)|make this repository public/i;

export function isPlanLimit(error?: string): boolean {
  return PLAN_LIMIT.test(error ?? "");
}

/**
 * Whether the org asked for the gate. Off unless `review_gate: true` is in org.yaml: GitHub
 * only enforces it on private repos for paid plans, and most orgs running this are not on one,
 * so a default of on was a warning nobody could clear without paying.
 */
export function gateOn(org: { review_gate?: unknown }): boolean {
  return org.review_gate === true || org.review_gate === "on";
}

export interface GateVerdict {
  level: "ok" | "warn" | "fail";
  title: string;
  fix?: string;
}

export function judgeGate(r: GateReading): GateVerdict {
  if (isPlanLimit(r.error)) {
    return {
      level: "warn",
      title: `${r.repo} can't require reviews: GitHub only allows that on private repos with a paid plan`,
      fix: "Make the repo public, or move the org to GitHub Team. Until then, staff can merge their own pull requests, so check what gets merged.",
    };
  }
  if (r.error) {
    return {
      level: "warn",
      title: `could not read the review gate on ${r.repo}: ${r.error}`,
      fix: "Reading branch protection needs admin on the repo. Until it is read, nothing proves a staff PR waits for you.",
    };
  }
  const where = `${r.repo}@${r.branch ?? "default"}`;
  if (r.bypass.length) {
    return {
      level: "fail",
      title: `${r.bypass.join(", ")} can bypass the review rule on ${where}`,
      fix: "Take the staff Apps off the bypass list. An agent that can skip review can ship unread.",
    };
  }
  if (r.approvals === null) {
    return {
      level: "fail",
      title: `nothing requires a reviewed PR on ${where}, so a staff member can push straight to it`,
      fix: "Add a ruleset requiring one approving review on the default branch. See docs/security.md.",
    };
  }
  if (r.approvals < 1) {
    return {
      level: "warn",
      title: `${where} requires a PR but no approving review, so whoever opens one can merge it`,
      fix: "Set required approvals to 1 in the ruleset or branch protection.",
    };
  }
  return {
    level: "ok",
    title: `${where} needs ${r.approvals} approving review${r.approvals === 1 ? "" : "s"} before a merge`,
  };
}

interface Rule {
  type: string;
  ruleset_id?: number;
  parameters?: { required_approving_review_count?: number };
}

interface Protection {
  required_pull_request_reviews?: {
    required_approving_review_count?: number;
    bypass_pull_request_allowances?: { apps?: Array<{ slug?: string }> };
  };
}

/** What the default branch of `repo` actually enforces, and which of `apps` can skip it. */
export async function readGate(repo: string, apps: string[]): Promise<GateReading> {
  const info = await api<{ default_branch: string }>(`repos/${repo}`);
  if (!info.ok) return { repo, approvals: null, bypass: [], error: info.error };
  const branch = info.data!.default_branch;

  const [rules, protection] = await Promise.all([
    api<Rule[]>(`repos/${repo}/rules/branches/${encodeURIComponent(branch)}`),
    api<Protection>(`repos/${repo}/branches/${encodeURIComponent(branch)}/protection`),
  ]);

  let approvals: number | null = null;
  const bypass = new Set<string>();
  const more = (n: number) => {
    approvals = approvals === null ? n : Math.max(approvals, n);
  };

  const prRules = (rules.ok ? (rules.data ?? []) : []).filter((r) => r.type === "pull_request");
  for (const r of prRules) more(r.parameters?.required_approving_review_count ?? 0);

  /* A 404 here is GitHub saying "Branch not protected", which is an answer. Anything else
     is not, and with no ruleset either there is nothing to conclude from. */
  if (protection.ok) {
    const reviews = protection.data?.required_pull_request_reviews;
    if (reviews) {
      more(reviews.required_approving_review_count ?? 0);
      for (const a of reviews.bypass_pull_request_allowances?.apps ?? []) {
        if (a.slug && apps.includes(a.slug)) bypass.add(a.slug);
      }
    }
  } else if (protection.status !== 404 && !rules.ok) {
    return { repo, branch, approvals: null, bypass: [], error: protection.error };
  }

  // A ruleset's bypass list names Apps by id, so the staff Apps are looked up to compare.
  const rulesetIds = [...new Set(prRules.map((r) => r.ruleset_id).filter((id) => id != null))];
  if (rulesetIds.length && apps.length) {
    const ids = await Promise.all(apps.map((slug) => api<{ id: number }>(`apps/${slug}`)));
    const byId = new Map<number, string>();
    ids.forEach((res, i) => {
      if (res.ok && res.data?.id) byId.set(res.data.id, apps[i]!);
    });
    const sets = await Promise.all(
      rulesetIds.map((id) =>
        api<{ bypass_actors?: Array<{ actor_type?: string; actor_id?: number | null }> }>(
          `repos/${repo}/rulesets/${id}`,
        ),
      ),
    );
    for (const set of sets) {
      for (const actor of set.data?.bypass_actors ?? []) {
        const slug =
          actor.actor_type === "Integration" ? byId.get(actor.actor_id ?? -1) : undefined;
        if (slug) bypass.add(slug);
      }
    }
  }

  return { repo, branch, approvals, bypass: [...bypass] };
}

/**
 * The ruleset `roster hire --apply` adds to a product repo that has no gate.
 *
 * One approving review on the default branch. Repository admins may bypass it only by merging
 * a pull request, which is how the human's own merge stays the approval (a solo founder cannot
 * approve their own PR) while an App, which is never an admin, cannot merge at all.
 */
export const GATE_RULESET = {
  name: "roster: review before merge",
  target: "branch",
  enforcement: "active",
  conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
  rules: [
    {
      type: "pull_request",
      parameters: {
        required_approving_review_count: 1,
        dismiss_stale_reviews_on_push: true,
        require_code_owner_review: false,
        require_last_push_approval: false,
        required_review_thread_resolution: false,
      },
    },
  ],
  // 5 is the built-in admin repository role.
  bypass_actors: [{ actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "pull_request" }],
};

/** POSTed from a file because `gh api -f` cannot spell an array of objects. */
export async function addGate(repo: string): Promise<{ ok: boolean; error?: string }> {
  const dir = mkdtempSync(join(tmpdir(), "roster-gate-"));
  const body = join(dir, "ruleset.json");
  try {
    writeFileSync(body, JSON.stringify(GATE_RULESET));
    const res = await api(`repos/${repo}/rulesets`, ["-X", "POST", "--input", body]);
    return { ok: res.ok, error: res.error };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
