import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface InboxItem {
  repo: string;
  /** brain | product | ops — which part of the org this work belongs to. */
  role: string;
  kind: "issue" | "pr";
  number: number;
  title: string;
  labels: string[];
  assignees: string[];
  author: string;
  updatedAt: string;
  url: string;
  draft?: boolean;
  checks?: "passing" | "failing" | "pending" | "none";
}

export interface Thread {
  title: string;
  body: string;
  author: string;
  createdAt: string;
  url: string;
  state: string;
  comments: Array<{ author: string; createdAt: string; body: string }>;
}

/**
 * Everything open across the org, from the local `gh`.
 *
 * The portal runs on the human's own machine, so it borrows the CLI they are already
 * signed in as rather than asking for a token. That also means the inbox shows exactly
 * what they would see on github.com, including private repos.
 */
export async function fetchInbox(repos: Array<{ name: string; owner: string; role: string }>): Promise<{
  items: InboxItem[];
  errors: string[];
}> {
  const items: InboxItem[] = [];
  const errors: string[] = [];

  const jobs = repos.flatMap((r) => {
    const full = `${r.owner}/${r.name}`;
    return [
      gh(["issue", "list", "--repo", full, "--state", "open", "--limit", "60",
          "--json", "number,title,labels,assignees,author,updatedAt,url"])
        .then((rows) => {
          for (const i of rows) {
            items.push({
              repo: full, role: r.role, kind: "issue", number: i.number, title: i.title,
              labels: (i.labels ?? []).map((l: any) => l.name),
              assignees: (i.assignees ?? []).map((a: any) => a.login),
              author: i.author?.login ?? "", updatedAt: i.updatedAt, url: i.url,
            });
          }
        })
        .catch((e) => errors.push(`${full} issues: ${short(e)}`)),

      gh(["pr", "list", "--repo", full, "--state", "open", "--limit", "60",
          "--json", "number,title,labels,author,updatedAt,url,isDraft,statusCheckRollup"])
        .then((rows) => {
          for (const p of rows) {
            items.push({
              repo: full, role: r.role, kind: "pr", number: p.number, title: p.title,
              labels: (p.labels ?? []).map((l: any) => l.name),
              assignees: [], author: p.author?.login ?? "", updatedAt: p.updatedAt,
              url: p.url, draft: p.isDraft, checks: rollup(p.statusCheckRollup),
            });
          }
        })
        .catch((e) => errors.push(`${full} PRs: ${short(e)}`)),
    ];
  });

  await Promise.all(jobs);
  items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return { items, errors };
}

export async function fetchThread(repo: string, number: number, kind: "issue" | "pr"): Promise<Thread> {
  const [main] = await Promise.all([
    gh([kind, "view", String(number), "--repo", repo, "--json", "title,body,author,createdAt,url,state"], false),
  ]);
  // `gh issue view --comments` renders text rather than JSON, so the API is the reliable route.
  const comments = await gh(["api", `repos/${repo}/issues/${number}/comments`,
                             "--jq", '[.[] | {author: .user.login, createdAt: .created_at, body: .body}]'])
    .catch(() => []);
  return {
    title: main.title, body: main.body ?? "", author: main.author?.login ?? "",
    createdAt: main.createdAt, url: main.url, state: main.state,
    comments: Array.isArray(comments) ? comments : [],
  };
}

async function gh(args: string[], array = true): Promise<any> {
  const { stdout } = await run("gh", args, { maxBuffer: 12 * 1024 * 1024 });
  const parsed = JSON.parse(stdout || (array ? "[]" : "{}"));
  return parsed;
}

function rollup(checks: any[]): InboxItem["checks"] {
  if (!checks?.length) return "none";
  const states = checks.map((c) => c.conclusion || c.state || "").map(String);
  if (states.some((s) => /FAIL|ERROR|TIMED_OUT/i.test(s))) return "failing";
  if (states.some((s) => /PENDING|IN_PROGRESS|QUEUED/i.test(s) || s === "")) return "pending";
  return "passing";
}

function short(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const line = msg.split("\n").find((l) => l.trim()) ?? msg;
  return line.length > 160 ? line.slice(0, 159) + "…" : line;
}
