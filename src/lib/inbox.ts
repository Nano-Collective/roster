import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tidy } from "./gh.js";

const run = promisify(execFile);

export interface Comment {
  author: string;
  createdAt: string;
  body: string;
}

/**
 * A reaction, with who left it.
 *
 * This is how an agent says "seen" without writing a comment: the runner puts 👀 on the thing
 * it picked up. Without it the portal showed a person their own message and nothing else, and
 * the only way to know it had landed was to open GitHub.
 */
export interface Reaction {
  /** GitHub's enum: THUMBS_UP, EYES, ROCKET… */
  content: string;
  count: number;
  /** The first few, for the tooltip. Not all of them: nobody hovers to count. */
  by: string[];
}

const REACTIONS = `
  reactionGroups {
    content
    reactors(first:6) { totalCount nodes { ... on User { login } ... on Bot { login } } }
  }
`;

/**
 * One entry in a thread's history, in the order GitHub tells it.
 *
 * Comments alone are not the thread. Half of what these agents do to each other is a
 * cross-reference — a commit that names an issue, a PR that closes it, another issue that
 * mentions it — and a portal that shows only the comments makes a conversation look like it
 * skipped a step, because it did.
 */
export interface TimelineEvent {
  type:
    | "comment"
    | "cross-referenced"
    | "referenced"
    | "closed"
    | "reopened"
    | "merged"
    | "review"
    | "ready-for-review"
    | "review-requested"
    | "labeled"
    | "unlabeled"
    | "assigned"
    | "unassigned"
    | "renamed";
  actor: string;
  createdAt: string;
  /** comment and review bodies */
  body?: string;
  url?: string;
  /** what pointed at this thread, for a cross-reference */
  source?: {
    repo: string;
    number: number;
    title: string;
    url: string;
    state: string;
    kind: "issue" | "pr";
  };
  /** the commit behind a `referenced` or `merged` event */
  commit?: { sha: string; subject: string; url: string; repo?: string };
  /** the pull request that closed this, when something did */
  closer?: { number: number; title: string; url: string };
  label?: string;
  assignee?: string;
  /** a rename, from and to */
  from?: string;
  to?: string;
  /** APPROVED / CHANGES_REQUESTED / COMMENTED, on a review */
  state?: string;
  /** What people and agents put on a comment. Only comments carry these. */
  reactions?: Reaction[];
}

export interface InboxItem {
  repo: string;
  /** brain | product | ops — which part of the org this work belongs to. */
  role: string;
  kind: "issue" | "pr";
  number: number;
  title: string;
  body: string;
  labels: string[];
  assignees: string[];
  author: string;
  createdAt: string;
  updatedAt: string;
  url: string;
  state: string;
  draft?: boolean;
  checks?: "passing" | "failing" | "pending" | "none";
  /**
   * Whether this PR still applies to its base.
   *
   * GitHub computes this in the background, so a freshly pushed branch honestly answers
   * `UNKNOWN`. Carried through as it comes rather than folded into a boolean: "not known yet"
   * and "conflicts" are different answers, and only one of them is worth interrupting someone
   * about.
   */
  mergeable?: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  /** REVIEW_REQUIRED, APPROVED or CHANGES_REQUESTED; absent where no review is required. */
  reviewDecision?: string;
  /** When it was closed, and by whom. Home's "Closed today" is staff closing things. */
  closedAt?: string;
  closedBy?: string;
  /** The newest reply, from the list: who has the last word is what a request's state is. */
  lastComment?: Comment;
  /**
   * A decision's default, from the line the prompts ask for: "If I hear nothing by
   * <YYYY-MM-DD>, I'll <do X>." Home shows it, with the days left.
   */
  due?: { date: string; action: string };
  /** Kept because a count of replies is worth having without walking the timeline. */
  comments: Comment[];
  /** How many replies, known from the list before the thread itself has been read. */
  commentCount?: number;
  /**
   * True when this came from the list, which carries no body or timeline. The thread is read
   * on its own when it is opened: carrying every timeline in the list cost most of an hour's
   * GitHub API allowance per load.
   */
  partial?: boolean;
  events: TimelineEvent[];
  /** On the opening post, as opposed to on any of the replies. */
  reactions: Reaction[];
}

/* The inline fragments are the same text in both unions, so they are written once. They
   cannot be a named GraphQL fragment: an issue's timeline is `IssueTimelineItems` and a pull
   request's is `PullRequestTimelineItems`, and a fragment is bound to one type. */
const TIMELINE_COMMON = `
  __typename
  ... on IssueComment { author { login } createdAt body url ${REACTIONS} }
  ... on CrossReferencedEvent {
    actor { login } createdAt
    source {
      ... on Issue { number title url state repository { nameWithOwner } }
      ... on PullRequest { number title url state isDraft repository { nameWithOwner } }
    }
  }
  ... on ReferencedEvent {
    actor { login } createdAt
    commit { oid messageHeadline url }
    commitRepository { nameWithOwner }
  }
  ... on ClosedEvent {
    actor { login } createdAt
    closer { ... on PullRequest { number title url } ... on Commit { oid url } }
  }
  ... on ReopenedEvent { actor { login } createdAt }
  ... on LabeledEvent { actor { login } createdAt label { name } }
  ... on UnlabeledEvent { actor { login } createdAt label { name } }
  ... on AssignedEvent {
    actor { login } createdAt
    assignee { ... on User { login } ... on Bot { login } }
  }
  ... on UnassignedEvent {
    actor { login } createdAt
    assignee { ... on User { login } ... on Bot { login } }
  }
  ... on RenamedTitleEvent { actor { login } createdAt previousTitle currentTitle }
`;

const TIMELINE_PR = `
  ... on MergedEvent { actor { login } createdAt commit { oid url } }
  ... on PullRequestReview { author { login } createdAt state body url }
  ... on ReadyForReviewEvent { actor { login } createdAt }
  ... on ReviewRequestedEvent {
    actor { login } createdAt
    requestedReviewer { ... on User { login } ... on Team { name } }
  }
`;

/* Closed work is fetched with a shorter timeline than open work. It is there to be found and
   read, not triaged, and the whole org's history at full depth is a payload nobody asked for
   on a screen that refreshes every forty-five seconds. */
const CLOSED_FIRST = 30;
/** How far back "recently closed" reaches. Older than this and you want GitHub's search. */
const CLOSED_DAYS = 45;

const ISSUE_TYPES = `[ISSUE_COMMENT, CROSS_REFERENCED_EVENT, REFERENCED_EVENT, CLOSED_EVENT,
  REOPENED_EVENT, LABELED_EVENT, UNLABELED_EVENT, ASSIGNED_EVENT, UNASSIGNED_EVENT,
  RENAMED_TITLE_EVENT]`;

const PR_TYPES = `[ISSUE_COMMENT, CROSS_REFERENCED_EVENT, REFERENCED_EVENT, CLOSED_EVENT,
  REOPENED_EVENT, MERGED_EVENT, LABELED_EVENT, UNLABELED_EVENT, ASSIGNED_EVENT,
  UNASSIGNED_EVENT, RENAMED_TITLE_EVENT, PULL_REQUEST_REVIEW, READY_FOR_REVIEW_EVENT,
  REVIEW_REQUESTED_EVENT]`;

/**
 * One GraphQL call per repo, bodies and full timelines included.
 *
 * The obvious shape — list, then fetch each thread when it is clicked — is one `gh`
 * invocation per issue, about a second each. Forty-two of those is a portal that feels
 * broken. This is four requests for the whole org, and opening a thread is then instant
 * because it is already in memory.
 *
 * It runs through the human's own `gh`, so it shows exactly what they would see signed
 * in, private repos included, without the portal holding a token.
 */
/* The list: what a row shows and what the filters read, and nothing else. GitHub prices a query
   by how much it could return, and the old one asked for every timeline, every comment and
   every reactor in four lists per repo, which priced one inbox load at most of an hour's
   allowance. */
const LIGHT = `number title url state createdAt updatedAt closedAt body
        author { login }
        labels(first:12) { nodes { name } }
        assignees(first:8) { nodes { login } }
        comments { totalCount }
        last: comments(last:1) { nodes { author { login } createdAt body } }
        closer: timelineItems(last:1, itemTypes:[CLOSED_EVENT]) {
          nodes { ... on ClosedEvent { actor { login } } }
        }`;
const LIGHT_PR = `${LIGHT} isDraft mergeable reviewDecision
        commits(last:1) { nodes { commit { statusCheckRollup { state } } } }`;

const QUERY = `
query($owner:String!, $name:String!) {
  repository(owner:$owner, name:$name) {
    issues(states:OPEN, first:60, orderBy:{field:UPDATED_AT, direction:DESC}) { nodes { ${LIGHT} } }
    pullRequests(states:OPEN, first:60, orderBy:{field:UPDATED_AT, direction:DESC}) { nodes { ${LIGHT_PR} } }
    closedIssues: issues(states:CLOSED, first:${CLOSED_FIRST}, orderBy:{field:UPDATED_AT, direction:DESC}) {
      nodes { ${LIGHT} }
    }
    closedPullRequests: pullRequests(
      states:[CLOSED, MERGED], first:${CLOSED_FIRST}, orderBy:{field:UPDATED_AT, direction:DESC}
    ) { nodes { ${LIGHT_PR} } }
  }
}`;

/* What a row is sorted by on Home, so a thread read on its own can replace its row: when it
   closed and who closed it, and who had the last word. */
const ROW_EXTRAS = `closedAt
        last: comments(last:1) { nodes { author { login } createdAt body } }
        closer: timelineItems(last:1, itemTypes:[CLOSED_EVENT]) {
          nodes { ... on ClosedEvent { actor { login } } }
        }`;

/* One thread, whole: its body, its reactions and its timeline. Asked for when it is opened. */
const THREAD_QUERY = `
query($owner:String!, $name:String!, $number:Int!) {
  repository(owner:$owner, name:$name) {
    issueOrPullRequest(number:$number) {
      ... on Issue {
        number title body url state createdAt updatedAt ${ROW_EXTRAS}
        author { login }
        ${REACTIONS}
        labels(first:12) { nodes { name } }
        assignees(first:8) { nodes { login } }
        timelineItems(last:100, itemTypes:${ISSUE_TYPES}) { nodes { ${TIMELINE_COMMON} } }
      }
      ... on PullRequest {
        number title body url state createdAt updatedAt isDraft mergeable reviewDecision ${ROW_EXTRAS}
        author { login }
        ${REACTIONS}
        labels(first:12) { nodes { name } }
        assignees(first:8) { nodes { login } }
        commits(last:1) { nodes { commit { statusCheckRollup { state } } } }
        timelineItems(last:100, itemTypes:${PR_TYPES}) { nodes { ${TIMELINE_COMMON} ${TIMELINE_PR} } }
      }
    }
  }
}`;

export async function fetchInbox(
  repos: Array<{ name: string; owner: string; role: string }>,
): Promise<{ items: InboxItem[]; errors: string[] }> {
  const items: InboxItem[] = [];
  const errors: string[] = [];

  await Promise.all(
    repos.map(async (r) => {
      const full = `${r.owner}/${r.name}`;
      try {
        const repo = await query(r.owner, r.name);
        if (!repo) return;

        for (const n of repo.issues?.nodes ?? []) items.push(shape(n, full, r.role, "issue"));
        for (const n of repo.pullRequests?.nodes ?? []) {
          const item = shape(n, full, r.role, "pr");
          item.draft = n.isDraft;
          item.checks = rollup(n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state);
          item.mergeable = n.mergeable;
          if (n.reviewDecision) item.reviewDecision = n.reviewDecision;
          items.push(item);
        }

        const cutoff = Date.now() - CLOSED_DAYS * 86_400_000;
        const recent = (n: any) => new Date(n.updatedAt).getTime() >= cutoff;
        for (const n of (repo.closedIssues?.nodes ?? []).filter(recent)) {
          items.push(shape(n, full, r.role, "issue"));
        }
        for (const n of (repo.closedPullRequests?.nodes ?? []).filter(recent)) {
          const item = shape(n, full, r.role, "pr");
          item.draft = n.isDraft;
          items.push(item);
        }
      } catch (e) {
        errors.push(`${full}: ${short(e)}`);
      }
    }),
  );

  // The same failure on every repo (the API limit, gh signed out) is one message, not one per repo.
  const reasons = errors.map((e) => e.slice(e.indexOf(": ") + 2));
  if (errors.length > 1 && reasons.every((r) => r === reasons[0]))
    errors.splice(0, errors.length, reasons[0]!);

  // Newest first. Must return 0 for a tie: a comparator that never does claims both
  // orders for equal keys, and the sort result becomes arbitrary.
  items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { items, errors };
}

async function query(owner: string, name: string): Promise<any> {
  const { stdout } = await run(
    "gh",
    ["api", "graphql", "-f", `query=${QUERY}`, "-F", `owner=${owner}`, "-F", `name=${name}`],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(stdout)?.data?.repository;
}

function shape(n: any, repo: string, role: string, kind: "issue" | "pr"): InboxItem {
  const events = (n.timelineItems?.nodes ?? [])
    .map((e: any) => event(e))
    .filter(Boolean) as TimelineEvent[];
  return {
    repo,
    role,
    kind,
    number: n.number,
    title: n.title ?? "",
    // The list carries the body only to find a decision's default; a row never shows it, and
    // a thread that is opened is read whole on its own.
    body: n.timelineItems ? (n.body ?? "") : "",
    ...extras(n),
    labels: (n.labels?.nodes ?? []).map((l: any) => l.name),
    assignees: (n.assignees?.nodes ?? []).map((a: any) => a.login),
    author: n.author?.login ?? "",
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    url: n.url,
    state: n.state ?? "OPEN",
    comments: events
      .filter((e) => e.type === "comment")
      .map((e) => ({ author: e.actor, createdAt: e.createdAt, body: e.body ?? "" })),
    // From the list, the count comes without the comments; from a thread, they are counted.
    commentCount: n.comments?.totalCount ?? events.filter((e) => e.type === "comment").length,
    partial: !n.timelineItems,
    events,
    reactions: reactions(n),
  };
}

/** What a row needs beyond its title: who closed it, the last word, a decision's default. */
function extras(n: any): Partial<InboxItem> {
  const out: Partial<InboxItem> = {};
  if (n.closedAt) out.closedAt = n.closedAt;
  const closer = n.closer?.nodes?.[0]?.actor?.login;
  if (closer) out.closedBy = closer;
  const last = n.last?.nodes?.[0];
  if (last) {
    out.lastComment = {
      author: last.author?.login ?? "",
      createdAt: last.createdAt,
      body: String(last.body ?? "").slice(0, 800),
    };
  }
  const due = dueOf(n.body ?? "");
  if (due) out.due = due;
  return out;
}

/** "If I hear nothing by 2026-10-09, I'll ship it." The date and what happens then. */
export function dueOf(body: string): InboxItem["due"] | undefined {
  const m = /if i hear nothing by \**(\d{4}-\d{2}-\d{2})\**,?\s*i(?:'|’)?ll\s+([^\n]+)/i.exec(body);
  if (!m) return undefined;
  const action = m[2]!
    .replace(/[*_"“”]+/g, "")
    .replace(/\.\s*$/, "")
    .trim();
  return { date: m[1]!, action };
}

/** GitHub sends a group per reaction type whether or not anyone used it. Empty ones are noise. */
function reactions(n: any): Reaction[] {
  return (n.reactionGroups ?? [])
    .filter((g: any) => (g.reactors?.totalCount ?? 0) > 0)
    .map((g: any) => ({
      content: g.content,
      count: g.reactors.totalCount,
      by: (g.reactors.nodes ?? []).map((u: any) => u?.login).filter(Boolean),
    }));
}

/** One raw timeline node, flattened. Anything unrecognised is dropped rather than guessed at. */
function event(e: any): TimelineEvent | null {
  const who = e.actor?.login ?? e.author?.login ?? "";
  const at = e.createdAt;

  switch (e.__typename) {
    case "IssueComment":
      return {
        type: "comment",
        actor: who,
        createdAt: at,
        body: e.body ?? "",
        url: e.url,
        reactions: reactions(e),
      };

    case "CrossReferencedEvent": {
      const s = e.source;
      if (!s?.number) return null;
      return {
        type: "cross-referenced",
        actor: who,
        createdAt: at,
        source: {
          repo: s.repository?.nameWithOwner ?? "",
          number: s.number,
          title: s.title ?? "",
          url: s.url,
          // A draft PR is not "open" in any sense that matters when you are scanning.
          state: s.isDraft ? "DRAFT" : (s.state ?? "OPEN"),
          kind: "isDraft" in s ? "pr" : "issue",
        },
      };
    }

    case "ReferencedEvent": {
      if (!e.commit?.oid) return null;
      return {
        type: "referenced",
        actor: who,
        createdAt: at,
        commit: {
          sha: String(e.commit.oid).slice(0, 7),
          subject: e.commit.messageHeadline ?? "",
          url: e.commit.url,
          repo: e.commitRepository?.nameWithOwner,
        },
      };
    }

    case "ClosedEvent": {
      const out: TimelineEvent = { type: "closed", actor: who, createdAt: at };
      if (e.closer?.number) {
        out.closer = { number: e.closer.number, title: e.closer.title ?? "", url: e.closer.url };
      } else if (e.closer?.oid) {
        out.commit = { sha: String(e.closer.oid).slice(0, 7), subject: "", url: e.closer.url };
      }
      return out;
    }

    case "ReopenedEvent":
      return { type: "reopened", actor: who, createdAt: at };

    case "MergedEvent":
      return {
        type: "merged",
        actor: who,
        createdAt: at,
        commit: e.commit?.oid
          ? { sha: String(e.commit.oid).slice(0, 7), subject: "", url: e.commit.url }
          : undefined,
      };

    case "PullRequestReview":
      return {
        type: "review",
        actor: who,
        createdAt: at,
        state: e.state,
        body: e.body ?? "",
        url: e.url,
      };

    case "ReadyForReviewEvent":
      return { type: "ready-for-review", actor: who, createdAt: at };

    case "ReviewRequestedEvent":
      return {
        type: "review-requested",
        actor: who,
        createdAt: at,
        assignee: e.requestedReviewer?.login ?? e.requestedReviewer?.name ?? "",
      };

    case "LabeledEvent":
      return { type: "labeled", actor: who, createdAt: at, label: e.label?.name ?? "" };

    case "UnlabeledEvent":
      return { type: "unlabeled", actor: who, createdAt: at, label: e.label?.name ?? "" };

    case "AssignedEvent":
      return { type: "assigned", actor: who, createdAt: at, assignee: e.assignee?.login ?? "" };

    case "UnassignedEvent":
      return { type: "unassigned", actor: who, createdAt: at, assignee: e.assignee?.login ?? "" };

    case "RenamedTitleEvent":
      return {
        type: "renamed",
        actor: who,
        createdAt: at,
        from: e.previousTitle ?? "",
        to: e.currentTitle ?? "",
      };

    default:
      return null;
  }
}

/** Re-read one thread, for after posting a comment. Looks in the closed lists too, because
    closing something from the portal is exactly when it stops being in the open one. */
export async function fetchThread(repo: string, number: number, kind: "issue" | "pr") {
  const [owner, name] = repo.split("/");
  const { stdout } = await run(
    "gh",
    [
      "api",
      "graphql",
      "-f",
      `query=${THREAD_QUERY}`,
      "-F",
      `owner=${owner}`,
      "-F",
      `name=${name}`,
      "-F",
      `number=${number}`,
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );
  const n = JSON.parse(stdout)?.data?.repository?.issueOrPullRequest;
  if (!n) throw new Error(`${repo}#${number} was not found in ${repo}`);
  const item = shape(n, repo, "", kind);
  if (kind === "pr") {
    item.draft = n.isDraft;
    item.checks = rollup(n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state);
    item.mergeable = n.mergeable;
    if (n.reviewDecision) item.reviewDecision = n.reviewDecision;
  }
  return item;
}

function rollup(state?: string): InboxItem["checks"] {
  if (!state) return "none";
  if (/SUCCESS/i.test(state)) return "passing";
  if (/FAILURE|ERROR/i.test(state)) return "failing";
  return "pending";
}

function short(e: unknown): string {
  // A failed `gh` says "Command failed: gh api graphql -f query=…"; what went wrong is on stderr.
  const stderr = (e as { stderr?: string })?.stderr;
  if (stderr) return tidy(String(stderr));
  const msg = e instanceof Error ? e.message : String(e);
  const line = msg.split("\n").find((l) => l.trim() && !/^\s*$/.test(l)) ?? msg;
  return line.length > 200 ? line.slice(0, 199) + "…" : line;
}
