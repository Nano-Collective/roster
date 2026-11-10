// @ts-expect-error: the portal page's own module, plain JS with no types, shared so Claude's
// brief puts every item where Home does.
import { sortHome } from "../../templates/portal/js/homesort.js";
import type { StaffExport } from "../lib/export.js";
import type { InboxItem } from "../lib/inbox.js";
import type { RunRow } from "../lib/runs.js";
import { type Actor, handlePortal, type Portal } from "./handler.js";

/**
 * The portal as an MCP server, so you can talk to your staff from Claude: the morning's reports,
 * what needs you, answering it, and asking a staff member for something.
 *
 * Streamable HTTP, answered as plain JSON: every tool here is one request and one answer, so
 * there is nothing to stream. Each tool is a route the portal page already uses, called with
 * the person's own GitHub token, so what Claude can see and do is exactly what they can on
 * Home, minus merging, hiring and changing the org, which stay deliberate.
 */

const PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26"];

const BRAIN_FILES = ["STATE.md", "CHARTER.md", "memory/INDEX.md", "log/decisions.md", "staff.yaml"];

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, boolean>;
}

const staffArg = {
  type: "string",
  description: "Who: their handle (cto) or role name (Chief Technology Officer).",
};

export const TOOLS: Tool[] = [
  {
    name: "brief",
    title: "Morning brief",
    description:
      "Each staff member's report of where things stand, what needs you (asks to rule on, reviews, chores " +
      "and pull requests to merge), your requests and what they closed today. Start here.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
  },
  {
    name: "read_thread",
    title: "Read a thread",
    description:
      "One issue or pull request in full: its body and every reply. Read an ask before answering it.",
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string", description: "owner/name, as the brief gives it" },
        number: { type: "integer" },
        kind: { type: "string", enum: ["issue", "pr"], default: "issue" },
      },
      required: ["repo", "number"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "reply",
    title: "Reply",
    description:
      "Reply on an issue or pull request as the person, the way a comment on GitHub would. Set " +
      "close to close it with the reply. A reply that should wake the staff member must " +
      "@mention them; answering an ask on their own tracker does not need it.",
    inputSchema: {
      type: "object",
      properties: {
        repo: { type: "string" },
        number: { type: "integer" },
        text: { type: "string" },
        close: { type: "boolean", default: false },
      },
      required: ["repo", "number", "text"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "ask_staff",
    title: "Ask a staff member",
    description:
      "Ask a staff member to do something. Opens an issue on their tracker with their @mention, " +
      "which starts them in about a minute; they reply on it.",
    inputSchema: {
      type: "object",
      properties: { staff: staffArg, request: { type: "string" } },
      required: ["staff", "request"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "ask_for_report",
    title: "Ask for a report",
    description:
      "Ask a staff member to bring their report up to date now. It is the body of their status " +
      "issue, rewritten in a few minutes: where their priorities stand, what is on you, what next.",
    inputSchema: {
      type: "object",
      properties: { staff: staffArg },
      required: ["staff"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "list_issues",
    title: "List open issues",
    description:
      "Open issues and pull requests, newest activity first. Narrow it to one staff member's " +
      "tracker, one repo, issues or pull requests, or a label. For what needs you, use brief.",
    inputSchema: {
      type: "object",
      properties: {
        staff: { ...staffArg, description: `${staffArg.description} Their tracker only.` },
        repo: { type: "string", description: "a repo in the org: name or owner/name" },
        kind: { type: "string", enum: ["issue", "pr"] },
        label: { type: "string" },
        limit: { type: "integer", default: 30, maximum: 100 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "run",
    title: "Run a staff member now",
    description:
      "Start a staff member's session now, as their schedule would, or one of their routines. " +
      "It is a paid run. To ask them for something in particular, use ask_staff instead.",
    inputSchema: {
      type: "object",
      properties: {
        staff: staffArg,
        routine: { type: "string", description: "a routine's id; leave out for their daily round" },
      },
      required: ["staff"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "runs",
    title: "Recent runs",
    description:
      "Recent runs, newest first: what started each one, whether it passed, how long it took, " +
      "what it cost, and a link to its log.",
    inputSchema: {
      type: "object",
      properties: {
        staff: { ...staffArg, description: `${staffArg.description} Everyone if left out.` },
        limit: { type: "integer", default: 10, maximum: 50 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "read_brain",
    title: "Read a staff member's brain",
    description:
      "A file from a staff member's repository. STATE.md is their handover between runs, " +
      "CHARTER.md who they are, memory/INDEX.md what they know, log/decisions.md why.",
    inputSchema: {
      type: "object",
      properties: {
        staff: staffArg,
        file: { type: "string", enum: BRAIN_FILES, default: "STATE.md" },
      },
      required: ["staff"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
];

type RpcId = string | number | null;

const rpc = (id: RpcId, result: unknown) => Response.json({ jsonrpc: "2.0", id, result });
const rpcError = (id: RpcId, code: number, message: string, status = 200) =>
  Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { status });

/** One MCP request, from someone the Worker has already signed in. */
export async function handleMcp(
  req: Request,
  portal: Portal,
  actor: Actor,
  name: string,
): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("POST only", { status: 405, headers: { allow: "POST" } });
  }
  const msg = (await req.json().catch(() => null)) as Record<string, any> | null;
  if (!msg || Array.isArray(msg) || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return rpcError(null, -32600, "one JSON-RPC 2.0 request per POST", 400);
  }
  // A notification or a response: nothing to answer.
  if (msg.id === undefined) return new Response(null, { status: 202 });
  const id = msg.id as RpcId;

  switch (msg.method) {
    case "initialize": {
      const asked = String(msg.params?.protocolVersion ?? "");
      return rpc(id, {
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: {} },
        serverInfo: { name: "roster", title: `${name} on Roster`, version: "1" },
        instructions:
          `${name}'s staff are AI agents that work on GitHub. Start with brief. ` +
          "Read a thread before replying to it. Everything is posted as the person signed in.",
      });
    }
    case "ping":
      return rpc(id, {});
    case "tools/list":
      return rpc(id, { tools: TOOLS });
    case "tools/call": {
      const tool = String(msg.params?.name ?? "");
      if (!TOOLS.some((t) => t.name === tool))
        return rpcError(id, -32602, `no tool called ${tool}`);
      try {
        const text = await callTool(tool, msg.params?.arguments ?? {}, portal, actor);
        return rpc(id, { content: [{ type: "text", text }] });
      } catch (err) {
        return rpc(id, {
          content: [{ type: "text", text: String((err as Error)?.message ?? err) }],
          isError: true,
        });
      }
    }
    default:
      return rpcError(id, -32601, `${msg.method} is not supported`);
  }
}

/** A portal route, as the page would call it, with the person's own token. */
async function route<T>(portal: Portal, actor: Actor, path: string, body?: unknown): Promise<T> {
  const init: RequestInit = body
    ? {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      }
    : {};
  const res = await handlePortal(new Request(`https://roster.invalid${path}`, init), portal, actor);
  if (!res) throw new Error(`${path} is not a portal route`);
  const type = res.headers.get("content-type") ?? "";
  const data = type.includes("json") ? await res.json() : await res.text();
  if (!res.ok) throw new Error((data as any)?.error ?? `${path} answered ${res.status}`);
  return data as T;
}

interface OrgData {
  staff: StaffExport[];
  humans: Array<{ github?: string; marker?: string }>;
  human?: { github?: string; marker?: string };
}

function staffOf(org: OrgData, who: unknown): StaffExport {
  const w = String(who ?? "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "");
  const s = org.staff.find(
    (x) => x.handle.toLowerCase() === w || x.name.toLowerCase() === w || x.dir.toLowerCase() === w,
  );
  if (!s) {
    const known = org.staff.map((x) => `${x.handle} (${x.name})`).join(", ");
    throw new Error(`no staff member "${who}". The staff are: ${known}`);
  }
  return s;
}

export async function callTool(
  tool: string,
  args: Record<string, any>,
  portal: Portal,
  actor: Actor,
): Promise<string> {
  const org = await route<OrgData>(portal, actor, "/api/org");

  if (tool === "brief") {
    const inbox = await route<{ items: InboxItem[] }>(portal, actor, "/api/inbox");
    const humans = org.humans?.length ? org.humans : org.human?.github ? [org.human] : [];
    return briefText(sortHome(inbox.items ?? [], org.staff, humans, []));
  }

  if (tool === "read_thread") {
    const kind = args.kind === "pr" ? "pr" : "issue";
    const q = new URLSearchParams({ repo: String(args.repo), number: String(args.number), kind });
    return threadText(await route<InboxItem>(portal, actor, `/api/thread?${q}`));
  }

  if (tool === "reply") {
    const text = String(args.text ?? "").trim();
    if (!text) throw new Error("text is empty");
    const action = args.close ? "close" : "comment";
    const r = await route<{ url?: string }>(portal, actor, "/api/act", {
      action,
      repo: String(args.repo),
      number: Number(args.number),
      body: text,
    });
    return `${args.close ? "Replied and closed" : "Replied"}: ${r.url ?? `${args.repo}#${args.number}`}`;
  }

  if (tool === "list_issues") {
    const inbox = await route<{ items: InboxItem[] }>(portal, actor, "/api/inbox");
    const tracker = args.staff ? staffOf(org, args.staff).brain : null;
    if (args.staff && !tracker) throw new Error(`${args.staff} has no tracker`);
    return listText(inbox.items ?? [], {
      repo: tracker ?? (args.repo ? String(args.repo) : undefined),
      kind: args.kind,
      label: args.label ? String(args.label) : undefined,
      limit: clamp(args.limit, 30, 100),
    });
  }

  if (tool === "runs") {
    const handle = args.staff ? staffOf(org, args.staff).handle : null;
    const data = await route<{ staff: Array<{ handle: string; name: string; runs: RunRow[] }> }>(
      portal,
      actor,
      "/api/runs",
    );
    const rows = data.staff
      .filter((x) => !handle || x.handle === handle)
      .flatMap((x) => x.runs.map((run) => ({ who: x.name, run })));
    return runsText(rows, clamp(args.limit, 10, 50));
  }

  const s = staffOf(org, args.staff);
  const mention = s.mention ?? `@${s.handle}`;

  if (tool === "ask_staff") {
    const said = String(args.request ?? "").trim();
    if (!said || !s.brain)
      throw new Error(s.brain ? "request is empty" : `${s.name} has no tracker`);
    const line = said.split("\n").find((l) => l.trim()) ?? said;
    const r = await route<{ url?: string }>(portal, actor, "/api/act", {
      action: "create",
      repo: s.brain,
      title: line.length > 90 ? `${line.slice(0, 89).trimEnd()}…` : line,
      body: `${mention} ${said}`,
    });
    return `Asked ${s.name}: ${r.url}. They start in about a minute and reply there.`;
  }

  if (tool === "ask_for_report") {
    if (!s.brain || !s.statusIssue) throw new Error(`${s.name} has no status issue`);
    const r = await route<{ url?: string }>(portal, actor, "/api/act", {
      action: "comment",
      repo: s.brain,
      number: s.statusIssue,
      body: `${mention} Report, please.`,
    });
    return `Asked ${s.name} for a report: ${r.url}. They update the issue's body in a few minutes.`;
  }

  if (tool === "run") {
    const routine = args.routine ? String(args.routine) : undefined;
    const r = await route<{ url?: string }>(portal, actor, "/api/run/start", {
      staff: s.handle,
      routine,
    });
    return `Started ${s.name}${routine ? `'s ${routine} routine` : ""}: ${r.url}`;
  }

  if (tool === "read_brain") {
    const file = String(args.file ?? "STATE.md");
    if (!BRAIN_FILES.includes(file)) throw new Error(`file is one of ${BRAIN_FILES.join(", ")}`);
    const q = new URLSearchParams({ path: `${s.dir}/${file}` });
    try {
      return await route<string>(portal, actor, `/api/file?${q}`);
    } catch {
      throw new Error(`${s.name} has no ${file}`);
    }
  }

  throw new Error(`no tool called ${tool}`);
}

const ref = (i: InboxItem) => `${i.repo}#${i.number}`;

function clamp(v: unknown, fallback: number, max: number): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
}

/** Open issues and pull requests as lines, with the filters list_issues takes. */
export function listText(
  items: InboxItem[],
  f: { repo?: string; kind?: string; label?: string; limit: number },
): string {
  const repo = f.repo?.toLowerCase();
  const label = f.label?.toLowerCase();
  const open = items
    .filter((i) => i.state === "OPEN")
    .filter(
      (i) => !repo || [i.repo.toLowerCase(), i.repo.split("/")[1]?.toLowerCase()].includes(repo),
    )
    .filter((i) => !f.kind || i.kind === f.kind)
    .filter((i) => !label || i.labels.some((l) => l.toLowerCase() === label))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (!open.length) return "Nothing open matches.";
  const shown = open.slice(0, f.limit);
  const out = shown.map((i) => {
    const bits = [i.kind === "pr" ? (i.draft ? "draft PR" : "PR") : "issue", `by ${i.author}`];
    if (i.labels.length) bits.push(i.labels.join(", "));
    if (i.kind === "pr" && i.checks && i.checks !== "none") bits.push(`checks ${i.checks}`);
    return `- ${ref(i)} "${i.title}" (${bits.join(" · ")}, updated ${i.updatedAt.slice(0, 10)})`;
  });
  if (open.length > shown.length) out.push(`…and ${open.length - shown.length} more.`);
  return out.join("\n");
}

/** Runs as lines, newest first. */
export function runsText(rows: Array<{ who: string; run: RunRow }>, limit: number): string {
  if (!rows.length) return "No runs yet.";
  const sorted = [...rows].sort((a, b) => b.run.createdAt.localeCompare(a.run.createdAt));
  return sorted
    .slice(0, limit)
    .map(({ who, run }) => {
      const how = run.status === "completed" ? (run.conclusion ?? "done") : run.status;
      const bits = [run.kind, how, `${run.minutes} min`];
      if (run.record?.cost_usd != null) bits.push(`$${run.record.cost_usd.toFixed(2)}`);
      const at = run.createdAt.slice(0, 16).replace("T", " ");
      return `- ${who}, ${at} UTC: ${bits.join(" · ")} ${run.url}`;
    })
    .join("\n");
}

/** The brief as text Claude can read back to someone: the same places Home puts things. */
export function briefText(h: any): string {
  const out: string[] = [];
  if (h.reports.length) {
    out.push("Reports, from each staff member's status issue:");
    for (const r of h.reports) {
      // The body opens with when it was updated; the issue's own time moves with any comment.
      out.push(`- ${r.staff.name} (${ref(r.item)}):`);
      for (const l of String(r.body).split("\n")) if (l.trim()) out.push(`  ${l}`);
    }
  } else out.push("No reports yet.");

  out.push("", `Needs you (${h.needs.length}), oldest first:`);
  if (!h.needs.length) out.push("- Nothing needs you.");
  for (const e of h.needs) {
    const i: InboxItem = e.item;
    let line = `- [${e.kind}] ${ref(i)} "${i.title}"`;
    if (i.due) line += ` (default on ${i.due.date}: ${i.due.action})`;
    if (e.kind === "merge") {
      const bits = [
        i.checks && i.checks !== "none" ? `checks ${i.checks}` : "",
        i.mergeable === "CONFLICTING" ? "conflicts" : "",
        i.reviewDecision === "REVIEW_REQUIRED" ? "needs your approval" : "",
      ].filter(Boolean);
      if (bits.length) line += ` (${bits.join(", ")})`;
    }
    out.push(line);
  }

  if (h.requests.length) {
    out.push("", "Your requests:");
    for (const e of h.requests) out.push(`- ${ref(e.item)} "${e.item.title}": ${e.status}`);
  }
  if (h.closedToday.length) {
    out.push("", "Closed today by staff:");
    for (const e of h.closedToday)
      out.push(`- ${ref(e.item)} "${e.item.title}": ${e.reason ?? ""}`);
  }
  return out.join("\n");
}

function threadText(i: InboxItem): string {
  const out = [
    `${ref(i)} (${i.kind}, ${String(i.state).toLowerCase()}): ${i.title}`,
    `by ${i.author}, ${i.createdAt.slice(0, 10)}${i.labels.length ? ` · labels: ${i.labels.join(", ")}` : ""}`,
    "",
    i.body || "(no description)",
  ];
  for (const c of i.comments ?? []) {
    out.push("", `--- ${c.author}, ${c.createdAt.slice(0, 16).replace("T", " ")} UTC`, c.body);
  }
  return out.join("\n");
}
