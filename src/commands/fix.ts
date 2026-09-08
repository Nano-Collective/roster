import { auditPrompt } from "../lib/audit.js";
import { lintMemory, parseMemory } from "../lib/memory.js";
import { KINDS, promptView } from "../lib/prompt.js";
import { findWorkspace, loadComposer, readOrg, type Workspace } from "../lib/workspace.js";
import { collect } from "./doctor.js";

export const fixHelp = `
roster fix [--json] [--ops <dir>] [--offline]

  Every scanner's findings, turned into one brief you paste into a coding agent.

  roster has three of them — \`doctor\` for the wiring, the prompt audit for what an agent is
  actually told, and \`lint\` for the memory grammar — and each already carries the sentence
  that fixes its own finding. Nothing has ever assembled them.

  Two piles come out. What an agent standing in this workspace can do, and what only you can
  do: an org permission on a settings page, an App a human has to install, a credential roster
  cannot obtain. Handing the second pile to an agent gets you a plausible workaround, which is
  worse than getting nothing.

  Copy the first pile into Cursor, Claude Code, Copilot or anything else that can edit files
  here, then run \`roster doctor\` again. The ids should be gone.

  --json      the findings as data, rather than as a brief
  --offline   skip everything that needs the network
  --ops <dir> ops repo directory (default: found by walking up)
`;

export interface FixItem {
  id: string;
  scope: string;
  level: string;
  title: string;
  /** The sentence that fixes it, from whichever scanner produced it. */
  fix: string;
  /** Whether an agent editing files here can do it at all. */
  who: "agent" | "human";
  path?: string;
}

/**
 * Findings only a person can clear, and why.
 *
 * An agent given one of these does not fail cleanly. It invents a workaround — a second
 * workflow that does not need the permission, a token committed somewhere, a check disabled —
 * and every one of those is worse than the finding it was asked to fix.
 */
const HUMAN_ONLY: Record<string, string> = {
  "actions-access":
    "An organisation permission on a repository settings page. One human click, and it cannot be done with a token created for anything else.",
  secrets:
    "Your account's credential, and an App's private key. roster has no way to obtain either.",
  runs: "Only a run that finished proves the chain works. Trigger the daily workflow and read the log.",
  "runs.timeout": "A ceiling to raise in the manifest, then a decision about whether it was right.",
  "runs.cancelled": "Same: a judgement about the ceiling, not an edit.",
  repo: "Creating or renaming a repository. `roster hire` does this deliberately, not an agent.",
  "repo.visibility": "Changing a repository's visibility is a posture decision, not a fix.",
  "status-issue": "Pinning an issue is a click, and which issue is pinned is yours to decide.",
};

/** Findings whose fix is a file in the workspace, so an agent can simply do it. */
export function classifyFinding(id: string): "agent" | "human" {
  if (id in HUMAN_ONLY) return "human";
  // Anything under .github/workflows is out regardless: App tokens cannot push there, and an
  // agent that edits one produces a change that can never be applied by the thing that runs it.
  if (id.startsWith("callers")) return "human";
  return "agent";
}

export async function fixCommand(argv: string[]): Promise<number> {
  const opts = parseFlags(argv);
  const ws = findWorkspace(opts.ops);
  const items = await gather(ws, opts.offline === true);

  if (opts.json) {
    process.stdout.write(`${JSON.stringify({ items }, null, 2)}\n`);
    return 0;
  }
  process.stdout.write(fixBrief(ws, items));
  return 0;
}

/** Every scanner, in one list. */
export async function gather(ws: Workspace, offline: boolean): Promise<FixItem[]> {
  const items: FixItem[] = [];
  const report = await collect({ ops: ws.opsDir, offline });
  if (!report) return items;

  for (const f of report.findings) {
    if (f.level === "ok") continue;
    items.push({
      id: f.id,
      scope: f.scope,
      level: f.level,
      title: f.title,
      fix: f.fix ?? "",
      who: classifyFinding(f.id),
    });
  }

  const { compose, parseYaml } = await loadComposer(ws.opsDir);
  const org = readOrg(ws.opsDir, parseYaml);
  const roots = [
    ...(org.staff ?? []).map((s) => s.dir ?? s.handle),
    ...((org as { repos?: Array<{ name: string }> }).repos ?? []).map((r) => r.name),
  ];

  for (const entry of org.staff ?? []) {
    const dir = entry.dir ?? entry.handle;
    const brainDir = `${ws.root}/${dir}`;

    /* The prompt audit, once per run kind. Its `want` field is already phrased as an
       instruction — it was written for exactly this and has never been collected. */
    for (const kind of KINDS) {
      try {
        const view = promptView(ws, compose, entry.handle, brainDir, kind);
        for (const p of auditPrompt(ws, view, roots)) {
          if (items.some((i) => i.id === `audit.${p.id}` && i.path === p.path)) continue;
          items.push({
            id: `audit.${p.id}`,
            scope: entry.handle,
            level: p.level,
            title: p.title,
            fix: p.want,
            who: "agent",
            path: p.path,
          });
        }
      } catch {
        // A prompt that will not compose is already a doctor finding; no need to say it twice.
      }
    }

    try {
      const memDir = `${brainDir}/memory`;
      for (const p of lintMemory(parseMemory(memDir), memDir)) {
        items.push({
          id: `lint.${p.rule}`,
          scope: entry.handle,
          level: p.level,
          title: p.message,
          fix: `Correct it in ${dir}/memory/INDEX.md, in place.`,
          who: "agent",
          path: `${dir}/memory/INDEX.md`,
        });
      }
    } catch {
      // No memory index is a doctor finding too.
    }
  }

  return items;
}

/**
 * The brief itself.
 *
 * Ownership goes near the top, before any of the work: an agent that has started editing has
 * stopped reading, and the expensive mistake here is a fix applied to a generated file in the
 * tenant instead of upstream in the framework. That has already happened once, to
 * `session.yaml`, and nothing noticed for weeks.
 */
export function fixBrief(ws: Workspace, items: FixItem[]): string {
  const forAgent = items.filter((i) => i.who === "agent");
  const forHuman = items.filter((i) => i.who === "human");

  if (!items.length) {
    return `\nNothing to fix. \`roster doctor\` is clean.\n\n`;
  }

  const out: string[] = [
    `# Fix what roster is reporting`,
    "",
    `You are working in a roster workspace. ${count(forAgent.length, "thing")} below ${forAgent.length === 1 ? "is" : "are"} yours`,
    `to fix by editing files. ${count(forHuman.length, "other")} only a person can do; those are at the`,
    `bottom, for information, and you should not attempt them.`,
    "",
    "## Where you are",
    "",
    "The workspace holds the ops repo and every brain repo side by side:",
    "",
    `- \`${ws.opsName}/\` — the org layer and the machinery.`,
    "- one directory per staff member — their charter, memory, and declared surfaces.",
    "",
    "## What you must not edit",
    "",
    "**Some files here belong to the framework, not to this tenant.** A fix applied to one of",
    "them is reverted by the next `roster upgrade`, and the mistake is invisible until it is",
    "expensive. Do not touch:",
    "",
    `- \`${ws.opsName}/compose.mjs\`, \`agents.mjs\`, \`runner-plan.mjs\` — vendored from the framework.`,
    `- \`${ws.opsName}/.github/workflows/\` and any brain's \`.github/workflows/\` — generated, and`,
    "  GitHub App tokens cannot push changes there in any case.",
    `- \`${ws.opsName}/.roster/\` — the recorded merge base.`,
    "",
    "Everything else is the tenant's and is yours to edit: `org/*.md`, `prompts/*.md`,",
    "`org.yaml`, and each staff member's `CHARTER.md`, `memory/` and documents.",
    "",
    "If the right fix is in a file above, **say so and stop** rather than editing it. That is a",
    "change to the framework, not to this workspace.",
    "",
    "---",
    "",
    "## What to fix",
    "",
  ];

  if (!forAgent.length) {
    out.push("Nothing here is yours. Everything outstanding is in the list below.", "");
  }

  forAgent.forEach((item, n) => {
    out.push(`### ${n + 1}. ${item.title}`);
    out.push("");
    out.push(`- **where:** ${item.path ? `\`${item.path}\`` : item.scope}`);
    out.push(`- **id:** \`${item.id}\` (${item.level})`);
    if (item.fix) out.push(`- **what to do:** ${item.fix}`);
    out.push("");
  });

  out.push(
    "---",
    "",
    "## When you are done",
    "",
    "Run `roster doctor` and `roster lint`. Every id above should be gone. If one is not, say",
    "which and why rather than trying something else.",
    "",
    "Do not commit unless you are asked to.",
    "",
  );

  if (forHuman.length) {
    out.push(
      "---",
      "",
      "## Not yours — for information only",
      "",
      "These need a person. Do not attempt them, and do not work around them.",
      "",
    );
    for (const item of forHuman) {
      out.push(`- **${item.title}** (\`${item.id}\`) — ${HUMAN_ONLY[item.id] ?? item.fix}`);
    }
    out.push("");
  }

  return `${out.join("\n")}\n`;
}

/** "1 thing", "3 things". A brief that says "1 things" reads as generated, because it is. */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function parseFlags(argv: string[]) {
  const out: { ops?: string; json?: boolean; offline?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--json") {
      out.json = true;
      continue;
    }
    if (flag === "--offline") {
      out.offline = true;
      continue;
    }
    const value = argv[++i];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flag === "--ops") out.ops = value;
    else throw new Error(`unknown flag ${flag}`);
  }
  return out;
}
