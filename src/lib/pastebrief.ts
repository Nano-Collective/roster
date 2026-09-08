import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BEGIN, END, type PasteTarget } from "./paste.js";
import { briefTemplateDir } from "./render.js";
import type { Workspace } from "./workspace.js";

/**
 * A brief written for a chat window rather than for a coding agent.
 *
 * The briefs in `templates/briefs/` are written for something standing in the workspace: they
 * say "write `org/business.md`" because the thing reading them can. Paste one into ChatGPT and
 * it can do neither half — it cannot read the files it is told to consider, and it has nowhere
 * to put the answer.
 *
 * So paste mode does two things to the same template. It **carries the state**, inlining every
 * file the brief refers to, and it **asks for the answer in an envelope** that can be turned
 * back into a file. Long on purpose: one paste into a large-context model beats six rounds of
 * it asking for files it will never be given.
 */

export interface PasteBrief {
  kind: string;
  /** The whole thing, ready to copy. */
  text: string;
  /** What the answer is allowed to write, and what it currently holds. */
  targets: PasteTarget[];
}

/** Which files each brief writes, and which it only needs to have read. */
const WRITES: Record<string, (ctx: Ctx) => string[]> = {
  discover: (c) => [`${c.opsName}/org/business.md`],
  voice: (c) => [`${c.opsName}/org/voice.md`],
  charter: (c) => [`${c.dir}/CHARTER.md`],
};

const READS: Record<string, (ctx: Ctx) => string[]> = {
  discover: (c) => [
    `${c.opsName}/org/operating.md`,
    `${c.opsName}/org/voice.md`,
    `${c.opsName}/org/guardrails.md`,
  ],
  voice: (c) => [`${c.opsName}/org/business.md`, `${c.opsName}/org/guardrails.md`],
  /* A charter is the difference between this staff member and everyone else, so the peers'
     charters are the most useful thing in the room: without them the model writes a second
     copy of whoever it was shown. */
  charter: (c) => [
    `${c.opsName}/org/business.md`,
    `${c.opsName}/org/operating.md`,
    `${c.opsName}/org/voice.md`,
    `${c.opsName}/org/guardrails.md`,
    ...c.peers.map((p) => `${p}/CHARTER.md`),
  ],
};

export function pasteable(kind: string): boolean {
  return kind in WRITES;
}

interface Ctx {
  opsName: string;
  dir: string;
  peers: string[];
}

export function pasteBrief(
  ws: Workspace,
  kind: string,
  rendered: string,
  ctx: { dir?: string; peers?: string[] },
): PasteBrief {
  if (!pasteable(kind)) throw new Error(`there is no paste-mode brief for "${kind}"`);
  const c: Ctx = { opsName: ws.opsName, dir: ctx.dir ?? "", peers: ctx.peers ?? [] };

  const writes = WRITES[kind]!(c);
  const reads = READS[kind]!(c).filter((rel) => !writes.includes(rel));
  const targets: PasteTarget[] = writes.map((rel) => ({ path: rel, before: read(ws, rel) }));

  const parts = [rendered.trimEnd(), "", "---", "", head(writes)];

  /* Where the brief says "read x", the file is here instead. This is the half that makes a
     chat window as useful as an agent standing in the repo. */
  parts.push("", "## The files this refers to", "");
  parts.push(
    "You cannot open anything, so everything the brief mentions is below. Do not ask for files;",
    "if something you want is genuinely not here, say what and why, and work without it.",
    "",
  );
  for (const rel of reads) parts.push(...fileBlock(ws, rel, "read this, do not rewrite it"));

  parts.push("## What you are writing", "");
  for (const rel of targets) {
    parts.push(...fileBlock(ws, rel.path, rel.before.trim() ? "replace this" : "currently empty"));
  }

  parts.push(...tail(writes));
  return { kind, text: `${parts.join("\n").replace(/\n{3,}/g, "\n\n")}\n`, targets };
}

/** Said before the files, because a model that has started writing has stopped reading. */
function head(writes: string[]): string {
  return [
    "## How to answer",
    "",
    "**You are talking to a person, not to a filesystem.** You cannot read or write anything.",
    "Everything you need is in this message, and your answer comes back by being pasted into a",
    "tool that turns it into " + (writes.length === 1 ? "a file" : "files") + ".",
    "",
    "**Interview first.** Ask one question at a time and wait. Do not produce the file in your",
    "first reply, and do not present a form. When you have enough, say so and write it.",
  ].join("\n");
}

/** And again after them, because this is the part that decides whether the answer is usable. */
function tail(writes: string[]): string[] {
  const example = writes
    .map((rel) => `${BEGIN(rel)}\n...the whole file, exactly as it should be saved...\n${END}`)
    .join("\n\n");
  return [
    "---",
    "",
    "## How to hand it back",
    "",
    "When the interview is done and you are writing the final version, wrap it like this:",
    "",
    "```",
    example,
    "```",
    "",
    `**Rules**, because the answer is parsed rather than read:`,
    "",
    "- The sentinel lines go on their own lines, spelled exactly as above.",
    "- Between them goes the **whole file**, exactly as it should be saved. No fences around it,",
    "  no commentary inside it, no summary of what you changed.",
    "- Anything you want to say to the person goes **outside** the block. That part is ignored by",
    "  the tool and read by them, so it is the right place for what you were unsure about.",
    `- Write only ${writes.join(" and ")}. Nothing else.`,
    "",
    "Nothing is saved automatically. They will see a diff and decide.",
  ];
}

function fileBlock(ws: Workspace, rel: string, note: string): string[] {
  const body = read(ws, rel);
  if (!body.trim()) return [`### \`${rel}\``, "", `*Empty or absent (${note}).*`, ""];
  return [`### \`${rel}\``, "", `*${note}*`, "", fence(body), ""];
}

function read(ws: Workspace, rel: string): string {
  const full = join(ws.root, rel);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
}

/** Long enough that a fence inside the content cannot close it. Same trick as `lib/amend.ts`. */
function fence(text: string): string {
  const longest = (text.match(/`{3,}/g) ?? []).reduce((n, m) => Math.max(n, m.length), 2);
  const bars = "`".repeat(longest + 1);
  return `${bars}\n${text.trimEnd()}\n${bars}`;
}

/** The brief templates, by name, so the portal does not reimplement the lookup. */
export function briefTemplate(kind: string): string {
  const path = join(briefTemplateDir(), `${kind}.md`);
  if (!existsSync(path)) throw new Error(`no brief template for "${kind}"`);
  return readFileSync(path, "utf8");
}
