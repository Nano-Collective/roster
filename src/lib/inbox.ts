import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface Comment {
  author: string;
  createdAt: string;
  body: string;
}

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
  /** Kept because a count of replies is worth having without walking the timeline. */
  comments: Comment[];
  events: TimelineEvent[];
}

/* The inline fragments are the same text in both unions, so they are written once. They
   cannot be a named GraphQL fragment: an issue's timeline is `IssueTimelineItems` and a pull
   request's is `PullRequestTimelineItems`, and a fragment is bound to one type. */
const TIMELINE_COMMON = `
  __typename
  ... on IssueComment { author { login } createdAt body url }
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
const QUERY = `
query($owner:String!, $name:String!) {
  repository(owner:$owner, name:$name) {
    issues(states:OPEN, first:60, orderBy:{field:UPDATED_AT, direction:DESC}) {
      nodes {
        number title body url state createdAt updatedAt
        author { login }
        labels(first:12) { nodes { name } }
        assignees(first:8) { nodes { login } }
        timelineItems(last:80, itemTypes:${ISSUE_TYPES}) { nodes { ${TIMELINE_COMMON} } }
      }
    }
    pullRequests(states:OPEN, first:60, orderBy:{field:UPDATED_AT, direction:DESC}) {
      nodes {
        number title body url state createdAt updatedAt isDraft
        author { login }
        labels(first:12) { nodes { name } }
        assignees(first:8) { nodes { login } }
        commits(last:1) { nodes { commit { statusCheckRollup { state } } } }
        timelineItems(last:80, itemTypes:${PR_TYPES}) {
          nodes { ${TIMELINE_COMMON} ${TIMELINE_PR} }
        }
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
          items.push(item);
        }
      } catch (e) {
        errors.push(`${full}: ${short(e)}`);
      }
    }),
  );

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
    body: n.body ?? "",
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
    events,
  };
}

/** One raw timeline node, flattened. Anything unrecognised is dropped rather than guessed at. */
function event(e: any): TimelineEvent | null {
  const who = e.actor?.login ?? e.author?.login ?? "";
  const at = e.createdAt;

  switch (e.__typename) {
    case "IssueComment":
      return { type: "comment", actor: who, createdAt: at, body: e.body ?? "", url: e.url };

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

/** Re-read one thread, for after posting a comment. */
export async function fetchThread(repo: string, number: number, kind: "issue" | "pr") {
  const [owner, name] = repo.split("/");
  const data = await query(owner!, name!);
  const nodes = kind === "pr" ? data?.pullRequests?.nodes : data?.issues?.nodes;
  const found = (nodes ?? []).find((n: any) => n.number === number);
  if (!found) throw new Error(`${repo}#${number} is not open`);
  return shape(found, repo, "", kind);
}

function rollup(state?: string): InboxItem["checks"] {
  if (!state) return "none";
  if (/SUCCESS/i.test(state)) return "passing";
  if (/FAILURE|ERROR/i.test(state)) return "failing";
  return "pending";
}

function short(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const line = msg.split("\n").find((l) => l.trim() && !/^\s*$/.test(l)) ?? msg;
  return line.length > 200 ? line.slice(0, 199) + "…" : line;
}
