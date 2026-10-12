import { type AskRequest, askBody, askFollowUp, askHead, askTitle } from "./ask.js";
import { type GitHub, splitRepo } from "./github.js";

export type Action = "comment" | "close" | "reopen" | "create" | "merge" | "ask" | "approve";

export interface ActRequest {
  action: Action;
  repo: string;
  number?: number;
  body?: string;
  title?: string;
  labels?: string[];
  /** Only for close: GitHub's own reason, so "not planned" is expressible. */
  reason?: "completed" | "not planned";
  /**
   * Only for merge, and normally absent.
   *
   * How to merge is a question about git, not about this pull request, and answering it is not
   * the work. Left unset, the repository is asked what it allows and the first of squash, merge
   * commit, rebase that it permits is used. Set it only to override that deliberately.
   */
  mergeMethod?: "squash" | "merge" | "rebase";
  /** Only for ask: who it is for, which pull request it is about, and where they were looking. */
  ask?: AskRequest;
  /**
   * Only for ask. Post the same text on the pull request as well, so the thread the question
   * was asked in does not go silent while the answer is being written somewhere else.
   */
  alsoOnPr?: boolean;
}

const MERGE_METHODS = ["squash", "merge", "rebase"] as const;

export interface ActResult {
  ok: true;
  action: Action;
  url?: string;
  /** Only for ask: the comment left on the pull request, when one was asked for. */
  prUrl?: string;
  /** Only for merge: how it was merged, since nobody was asked. */
  mergedBy?: "squash" | "merge" | "rebase";
  /**
   * Only for ask: the copy on the pull request did not go up, but the ask did.
   *
   * Reported rather than thrown. The tracker issue is what wakes the agent and it already
   * exists; failing the whole action here would say nothing happened, and the next click would
   * ask the same staff member the same question twice.
   */
  warning?: string;
}

/**
 * Write actions, with the human's own token.
 *
 * Everything here posts **as the human**, not as any staff member. That is the point: the
 * portal is where a person answers their agents, and a reply typed here should be
 * indistinguishable from one typed on github.com.
 *
 * The caller is responsible for checking the repo is one of ours; this only validates shape.
 */
export async function act(gh: GitHub, req: ActRequest): Promise<ActResult> {
  const { action, repo } = req;

  if (action === "create") {
    const title = (req.title ?? "").trim();
    if (!title) throw new Error("an issue needs a title");
    const url = await openIssue(gh, repo, title, req.body ?? "", req.labels);
    return { ok: true, action, url };
  }

  /**
   * Hand a pull request back to a staff member.
   *
   * Two writes, in an order that matters. The tracker issue is what actually wakes them, so it
   * goes first and its failure is the action's failure. The copy on the pull request is a
   * courtesy to whoever reads that thread next, and its failure is a warning: by then the ask
   * has already been made, and reporting it as an error would invite a second one.
   *
   * `repo` is the staff member's brain repo — where the issue lands — and not the repo the
   * pull request is on. The caller checks both against org.yaml.
   */
  if (action === "ask") {
    const ask = req.ask;
    if (!ask) throw new Error("an ask needs to say who it is for and what it is about");
    if (!ask.staff?.brain) throw new Error(`${ask.staff?.name ?? "they"} has no brain repo`);
    if (repo !== ask.staff.brain)
      throw new Error(`an ask goes to ${ask.staff.brain}, not to ${repo}`);
    if (!ask.body?.trim()) throw new Error("an empty ask is not an ask");

    /* One thread per pull request. A second ask about the same one while the first is still
       open goes on that issue as a comment, which wakes them the same way. Two open issues
       about one pull request was the usual result of asking twice. */
    const open = await openAskFor(gh, repo, askHead(ask));
    let url: string | undefined;
    if (open) {
      url = await comment(gh, repo, open, askFollowUp(ask));
    } else {
      const title = (req.title ?? "").trim() || askTitle(ask);
      url = await openIssue(gh, repo, title, askBody(ask), req.labels);
    }

    if (!req.alsoOnPr) return { ok: true, action, url };

    /* What goes on the pull request is what they typed, plus where the answer will come from.
       Not the composed body: that one is written for an agent, and the diff's thread is read
       by people. */
    const note =
      `${ask.body.trim()}\n\n` +
      `— asked ${ask.staff.name} (${ask.staff.mention}): ${url ?? ask.staff.brain}`;
    try {
      const prUrl = await comment(gh, ask.pr.repo, ask.pr.number, note);
      return { ok: true, action, url, prUrl };
    } catch (err) {
      return {
        ok: true,
        action,
        url,
        warning:
          `${ask.staff.name} was asked, but the copy on ${ask.pr.repo}#${ask.pr.number} ` +
          `did not go up: ${String((err as Error)?.message ?? err).split("\n")[0]}`,
      };
    }
  }

  const number = req.number;
  if (!Number.isInteger(number) || (number as number) <= 0)
    throw new Error("a valid issue number is required");
  const n = number as number;

  if (action === "comment") {
    const body = (req.body ?? "").trim();
    if (!body) throw new Error("an empty comment is not a comment");
    return { ok: true, action, url: await comment(gh, repo, n, body) };
  }

  /* The comment goes first, as `gh issue close --comment` did: a closing note reads above the
     close in the timeline, and a close that then fails has still said why. */
  if (action === "close") {
    if (req.body?.trim()) await comment(gh, repo, n, req.body.trim());
    must(
      await gh.request("PATCH", `repos/${repo}/issues/${n}`, {
        body: {
          state: "closed",
          state_reason: req.reason === "not planned" ? "not_planned" : "completed",
        },
      }),
    );
    return { ok: true, action };
  }

  if (action === "reopen") {
    must(await gh.request("PATCH", `repos/${repo}/issues/${n}`, { body: { state: "open" } }));
    return { ok: true, action };
  }

  /* An approving review, as the person who pressed Approve. A repository whose rules require one
     blocks a merge without it, and the staff cannot approve their own work, so this is the
     person's review, given deliberately: the portal never approves on a Merge press. */
  if (action === "approve") {
    const res = await gh.request("POST", `repos/${repo}/pulls/${n}/reviews`, {
      body: { event: "APPROVE", ...(req.body?.trim() ? { body: req.body.trim() } : {}) },
    });
    if (!res.ok)
      throw new Error(`Not approved: ${res.error || "GitHub refused it without saying why."}`);
    return { ok: true, action };
  }

  /* The only action here that cannot be taken back with another click. It never deletes the
     branch: that is a second decision, and it is not this button's to make.

     The method used to be a dropdown on the page. It is a question about git rather than about
     the pull request in front of you, and three of the four answers are wrong on any given
     repository — so it is worked out here instead, from what the repository itself allows. */
  if (action === "merge") {
    const how = req.mergeMethod ?? (await mergeMethodFor(gh, repo));
    if (!MERGE_METHODS.includes(how)) throw new Error(`unknown merge method "${req.mergeMethod}"`);
    const res = await gh.request("PUT", `repos/${repo}/pulls/${n}/merge`, {
      body: {
        merge_method: how,
        // A rebase produces no merge commit, so there is nothing for a body to be the body of.
        ...(req.body?.trim() && how !== "rebase" ? { commit_message: req.body.trim() } : {}),
      },
    });
    if (!res.ok) throw new Error(whyNotMerged(res.error ?? "", await prState(gh, repo, n)));
    return { ok: true, action, mergedBy: how };
  }

  throw new Error(`unknown action "${action}"`);
}

/** An issue, opened. Its address on github.com, which is what the page links to. */
async function openIssue(
  gh: GitHub,
  repo: string,
  title: string,
  body: string,
  labels: string[] = [],
): Promise<string | undefined> {
  const res = must(
    await gh.request<{ html_url: string }>("POST", `repos/${repo}/issues`, {
      body: { title, body, ...(labels.length ? { labels } : {}) },
    }),
  );
  return res.data?.html_url;
}

/** A comment on an issue or a pull request, which GitHub treats as the same thing. */
async function comment(
  gh: GitHub,
  repo: string,
  number: number,
  body: string,
): Promise<string | undefined> {
  const res = must(
    await gh.request<{ html_url: string }>("POST", `repos/${repo}/issues/${number}/comments`, {
      body: { body },
    }),
  );
  return res.data?.html_url;
}

function must<T extends { ok: boolean; error?: string }>(res: T): T {
  if (!res.ok) throw new Error(res.error || "GitHub refused it without saying why.");
  return res;
}

/** The open tracker issue already asking about this pull request, if there is one. */
async function openAskFor(gh: GitHub, repo: string, head: string): Promise<number | null> {
  const q = `repo:${repo} is:issue is:open in:title "${head.replace(/ — $/, "")}"`;
  const res = await gh.request<{ items: Array<{ number: number; title: string }> }>(
    "GET",
    `search/issues?per_page=20&q=${encodeURIComponent(q)}`,
  );
  // Not finding one is the ordinary case, and a search that fails should not stop the ask.
  if (!res.ok) return null;
  return (res.data?.items ?? []).find((i) => i.title.startsWith(head))?.number ?? null;
}

export interface PrState {
  mergeStateStatus?: string;
  /** REVIEW_REQUIRED, APPROVED or CHANGES_REQUESTED; empty where no review is required. */
  reviewDecision?: string;
  statusCheckRollup?: {
    name?: string;
    context?: string;
    status?: string;
    state?: string;
    conclusion?: string;
  }[];
}

/**
 * A refused merge, said plainly.
 *
 * `gh pr merge` refuses a blocked pull request with "the base branch policy prohibits the
 * merge" and advice about its own flags, which tells the person at the page neither what is
 * wrong nor what to do. The usual cause is a required check still running, so the checks are
 * read and named. Anything else falls back to gh's own first line, without the flag advice.
 */
export function whyNotMerged(ghError: string, pr: PrState | null): string {
  const checks = pr?.statusCheckRollup ?? [];
  const name = (c: (typeof checks)[number]) => c.name || c.context || "a check";
  const running = checks.filter(
    (c) =>
      (c.status && c.status !== "COMPLETED") || c.state === "PENDING" || c.state === "EXPECTED",
  );
  const failing = checks.filter((c) =>
    ["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "ERROR"].includes(
      String(c.conclusion || c.state || ""),
    ),
  );
  const list = (cs: typeof checks) => cs.map(name).join(", ");

  if (pr?.mergeStateStatus === "BLOCKED" && failing.length)
    return `Not merged: checks failed (${list(failing)}).`;
  if (pr?.mergeStateStatus === "BLOCKED" && running.length)
    return `Not merged: checks are still running (${list(running)}). Merge again once they pass.`;
  if (pr?.mergeStateStatus === "BLOCKED" && pr.reviewDecision === "REVIEW_REQUIRED")
    return "Not merged: the branch rules need an approving review first. Press Approve, then Merge.";
  if (pr?.mergeStateStatus === "BLOCKED" && pr.reviewDecision === "CHANGES_REQUESTED")
    return "Not merged: a reviewer has asked for changes. Open it to see what.";
  if (pr?.mergeStateStatus === "BLOCKED")
    return "Not merged: the branch rules require something first, such as a review. Open it in GitHub to see what.";
  if (pr?.mergeStateStatus === "BEHIND")
    return "Not merged: the branch is behind its base, and the branch rules require it to be up to date.";
  if (pr?.mergeStateStatus === "DIRTY") return "Not merged: the branch conflicts with its base.";

  const line = ghError
    .split("\n")
    .map((l) => l.replace(/^[!X✗]\s*/, "").trim())
    .find((l) => l && !l.startsWith("Command failed") && !/--auto|--admin/.test(l));
  return `Not merged: ${line ?? "GitHub refused it without saying why."}`;
}

/* The checks are flattened to the shape `gh pr view --json statusCheckRollup` gave: a check run
   carries a name, status and conclusion, a commit status carries a context and a state. */
const PR_STATE = `
query($owner:String!, $name:String!, $number:Int!) {
  repository(owner:$owner, name:$name) {
    pullRequest(number:$number) {
      mergeStateStatus reviewDecision
      commits(last:1) { nodes { commit { statusCheckRollup { contexts(first:50) { nodes {
        ... on CheckRun { name status conclusion }
        ... on StatusContext { context state }
      } } } } } }
    }
  }
}`;

async function prState(gh: GitHub, repo: string, n: number): Promise<PrState | null> {
  const res = await gh.graphql<{ repository: { pullRequest: any } }>(PR_STATE, {
    ...splitRepo(repo),
    number: n,
  });
  const pr = res.ok ? res.data?.repository?.pullRequest : null;
  if (!pr) return null;
  return {
    mergeStateStatus: pr.mergeStateStatus,
    reviewDecision: pr.reviewDecision ?? "",
    statusCheckRollup:
      pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes?.filter(Boolean) ?? [],
  };
}

/**
 * How this repository wants to be merged.
 *
 * Squash first, because a staff member's branch is a run's worth of commits and one of them is
 * the change; then a merge commit; then rebase. A repository that has turned squash off has
 * made that decision already, and asking the person at the keyboard to make it again — per
 * merge, from a dropdown — is asking them to know something the repository knows.
 *
 * A repository that cannot be read falls back to squash rather than failing: `gh pr merge` will
 * then say what is actually wrong, which is a better error than one invented here.
 */
async function mergeMethodFor(gh: GitHub, repo: string): Promise<"squash" | "merge" | "rebase"> {
  const res = await gh.request<{
    allow_squash_merge?: boolean;
    allow_merge_commit?: boolean;
    allow_rebase_merge?: boolean;
  }>("GET", `repos/${repo}`);
  /* offline, no access, or a shape that is not what it was: squash, and let GitHub explain */
  if (!res.ok || !res.data) return "squash";
  if (res.data.allow_squash_merge) return "squash";
  if (res.data.allow_merge_commit) return "merge";
  if (res.data.allow_rebase_merge) return "rebase";
  return "squash";
}
