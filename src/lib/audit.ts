import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PromptView } from "./prompt.js";
import type { Workspace } from "./workspace.js";

/**
 * What is wrong with a prompt, mechanically.
 *
 * Nothing here judges prose. Every check is something a machine can be sure about — a stub
 * nobody filled in, a placeholder that never resolved, the same sentence in two layers, a path
 * the prompt names that is not there. Anything softer would be an opinion dressed as a
 * finding, and a linter you stop believing is worse than no linter.
 *
 * The point of each one is that it comes with a `want`: the sentence you hand to your own AI,
 * with the whole prompt attached, to get a fix proposed. Knowing there is a problem is the
 * hard part; writing the paragraph is not.
 */
export interface AuditFinding {
  id: string;
  level: "error" | "warning" | "note";
  title: string;
  detail: string;
  /** Which file to open. Empty when the finding is about the composed whole. */
  path?: string;
  /** The instruction that goes into the amend brief when someone asks for a fix. */
  want: string;
}

/** Read in full on every run, forever. Past this, the cost is worth a look. */
const LONG_WORDS = 3500;
/** A sentence repeated across layers, if it is at least this long, is duplication not idiom. */
const ECHO_CHARS = 60;

export function auditPrompt(ws: Workspace, view: PromptView, roots: string[]): AuditFinding[] {
  const out: AuditFinding[] = [];
  const text = (rel: string) => {
    const full = join(ws.root, rel);
    return existsSync(full) ? readFileSync(full, "utf8") : "";
  };

  /* --- the stub nobody answered ---
     `roster init` writes org/business.md as questions, and every prompt is composed on top of
     it. Leaving it is the single most expensive thing you can do to an agent, and it is
     invisible: the run works, the output is just generic. */
  for (const layer of [...view.layers, ...view.runtime]) {
    if (layer.missing) continue;
    const body = text(layer.path);
    if (isStub(body)) {
      out.push({
        id: "stub",
        level: "error",
        title: `${base(layer.path)} is still the scaffold`,
        detail:
          `${layer.path} is the template roster wrote, not something anyone has answered. ` +
          `Every run is composed on top of it.`,
        path: layer.path,
        want: `\`${layer.path}\` is still the scaffold that roster generated. Interview me and write it properly.`,
      });
    }
  }

  /* --- a placeholder that never resolved ---
     `{{staff.product.repo}}` is null for a staff member who contributes to no other repo. An
     unresolved token in the composed text is an instruction that reads as literal braces. */
  const unresolved = [
    ...new Set(view.composed.match(/\{\{[^}\n]{1,60}\}\}|%%[A-Z_]{2,}%%/g) ?? []),
  ];
  if (unresolved.length) {
    out.push({
      id: "unresolved",
      level: "error",
      title: `${unresolved.length} placeholder${unresolved.length === 1 ? "" : "s"} never resolved`,
      detail: `The composed prompt still contains ${unresolved.slice(0, 4).join(", ")}. The agent reads those literally.`,
      want:
        `The composed prompt still contains unresolved placeholders: ${unresolved.join(", ")}. ` +
        `Find which layer emits them and either give them a value or make them conditional.`,
    });
  }

  /* --- the same sentence twice ---
     The layers are inherited, so a rule written into a charter that org/ already states is
     invisible duplication: nobody reading either file can see it. */
  const echoes = duplicated(view, text);
  if (echoes.length) {
    out.push({
      id: "echo",
      level: "warning",
      title: `${echoes.length} line${echoes.length === 1 ? "" : "s"} said in more than one layer`,
      detail: echoes
        .slice(0, 3)
        .map((e) => `"${e.line.slice(0, 70)}…" is in ${e.where.join(" and ")}`)
        .join("; "),
      want:
        `These lines appear in more than one layer of the prompt, so the same rule is stated ` +
        `twice on every run:\n\n` +
        echoes.map((e) => `- "${e.line}"\n  in ${e.where.join(" and ")}`).join("\n") +
        `\n\nDecide which layer each one belongs in and remove it from the others.`,
    });
  }

  /* --- what it costs --- */
  const words = view.composed.split(/\s+/).filter(Boolean).length;
  if (words > LONG_WORDS) {
    out.push({
      id: "long",
      level: "warning",
      title: `${words.toLocaleString()} words, read in full on every run`,
      detail:
        `Past about ${LONG_WORDS.toLocaleString()} words a prompt is usually carrying ` +
        `paragraphs nobody has re-read since they were written. This is paid on every run.`,
      want:
        `This prompt is ${words.toLocaleString()} words and is read in full on every run. ` +
        `Find what can go: anything restated, anything that was true once, anything an agent ` +
        `would do anyway. Show me the cuts, not a rewrite.`,
    });
  }

  /* --- a path it names that is not there ---
     Prompts tell agents to read specific files. A brain reorganises and the instruction rots
     silently, because a missing file is a quiet no-op inside a run nobody watches.

     Resolved against every repo in the workspace, because that is what the prompt writes paths
     relative to: `org/voice.md` means the ops repo and `src/config/blog.ts` means the product.
     The first version of this check used the workspace root alone and reported seven files
     that were all there, which is the failure mode that makes people stop reading a linter. */
  const bases = [ws.root, ...roots.map((r) => join(ws.root, r))];
  for (const rel of namedPaths(view.composed)) {
    if (bases.some((b) => existsSync(join(b, rel)))) continue;
    out.push({
      id: "dangling",
      level: "warning",
      title: `the prompt names ${rel}, which is not there`,
      detail: `An instruction to read a file that does not exist is a quiet no-op inside the run.`,
      want:
        `The prompt tells the agent to read \`${rel}\`, which does not exist in the workspace. ` +
        `Find where it is named and either fix the path or drop the instruction.`,
    });
  }

  /* --- an empty layer --- */
  for (const layer of view.layers) {
    if (layer.missing || text(layer.path).trim()) continue;
    out.push({
      id: "empty",
      level: "note",
      title: `${base(layer.path)} is empty`,
      detail: `${layer.path} is included by the prompt and contributes nothing.`,
      path: layer.path,
      want: `\`${layer.path}\` is included in the prompt and is empty. Either fill it in or remove the include.`,
    });
  }

  const order = { error: 0, warning: 1, note: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

/**
 * A file roster generated and nobody has answered.
 *
 * Detected by the questions rather than by length: a stub is a list of prompts to the human,
 * and a real one answers them. A short business.md that says something true is fine.
 */
function isStub(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed) return true;
  const lines = trimmed.split("\n").filter((l) => l.trim());
  const questions = lines.filter((l) => /\?\s*$/.test(l) || /^[-*]\s.*\?/.test(l)).length;
  const marked = /<!--\s*(todo|fill|replace|written by)/i.test(trimmed);
  return marked || (questions >= 3 && questions / lines.length > 0.3);
}

/** Lines that carry the same instruction in two different layers. */
function duplicated(view: PromptView, read: (rel: string) => string) {
  const seen = new Map<string, string[]>();
  for (const layer of [...view.layers, ...view.runtime]) {
    if (layer.missing) continue;
    for (const raw of read(layer.path).split("\n")) {
      const line = raw.trim().replace(/^[-*\d.\s]+/, "");
      if (line.length < ECHO_CHARS || line.startsWith("{{") || line.startsWith("#")) continue;
      const where = seen.get(line) ?? [];
      if (!where.includes(layer.path)) where.push(layer.path);
      seen.set(line, where);
    }
  }
  return [...seen.entries()]
    .filter(([, where]) => where.length > 1)
    .map(([line, where]) => ({ line, where }));
}

/**
 * Workspace paths the prompt tells the agent to read.
 *
 * Only backticked paths with a slash and an extension, which is how these prompts write them.
 * Anything looser matches prose and reports files nobody claimed existed.
 */
function namedPaths(composed: string): string[] {
  const found = new Set<string>();
  for (const m of composed.matchAll(/`([\w.-]+\/[\w./-]+\.\w{1,5})`/g)) {
    const path = m[1];
    if (!path || path.startsWith("http") || path.includes("..") || path.includes("*")) continue;
    found.add(path);
  }
  return [...found];
}

const base = (path: string) => path.split("/").pop() ?? path;
