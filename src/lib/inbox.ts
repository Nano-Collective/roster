import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface Comment {
  author: string;
  createdAt: string;
  body: string;
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
  comments: Comment[];
}

/**
 * One GraphQL call per repo, bodies and comments included.
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
        comments(last:40) { nodes { author { login } createdAt body } }
      }
    }
    pullRequests(states:OPEN, first:60, orderBy:{field:UPDATED_AT, direction:DESC}) {
      nodes {
        number title body url state createdAt updatedAt isDraft
        author { login }
        labels(first:12) { nodes { name } }
        assignees(first:8) { nodes { login } }
        comments(last:40) { nodes { author { login } createdAt body } }
        commits(last:1) { nodes { commit { statusCheckRollup { state } } } }
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
        const { stdout } = await run(
          "gh",
          [
            "api",
            "graphql",
            "-f",
            `query=${QUERY}`,
            "-F",
            `owner=${r.owner}`,
            "-F",
            `name=${r.name}`,
          ],
          { maxBuffer: 48 * 1024 * 1024 },
        );
        const repo = JSON.parse(stdout)?.data?.repository;
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

function shape(n: any, repo: string, role: string, kind: "issue" | "pr"): InboxItem {
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
    comments: (n.comments?.nodes ?? []).map((c: any) => ({
      author: c.author?.login ?? "",
      createdAt: c.createdAt,
      body: c.body ?? "",
    })),
  };
}

/** Re-read one thread, for after posting a comment. */
export async function fetchThread(repo: string, number: number, kind: "issue" | "pr") {
  const [owner, name] = repo.split("/");
  const { stdout } = await run(
    "gh",
    ["api", "graphql", "-f", `query=${QUERY}`, "-F", `owner=${owner}`, "-F", `name=${name}`],
    { maxBuffer: 48 * 1024 * 1024 },
  );
  const data = JSON.parse(stdout)?.data?.repository;
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
