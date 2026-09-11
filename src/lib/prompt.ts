import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { AuditFinding } from "./audit.js";
import type { Workspace } from "./workspace.js";

export const KINDS = ["daily", "mention"] as const;

export interface Layer {
  /** As the include names it: `org/voice.md`, or `staff:prompts/work.md`. */
  rel: string;
  /** Workspace-relative, which is what /api/file and /api/save both take. */
  path: string;
  /** Which repo it came out of, for the commit message and the confirm dialog. */
  repo: string;
  bytes: number;
  /** `{{>? …}}` renders empty when absent, which is how a role opts out of a fragment. */
  optional: boolean;
  missing: boolean;
  editable: boolean;
}

export interface PromptView {
  staff: string;
  kind: string;
  composed: string;
  /** Text that ends up inside the prompt, in the order the includes pull it in. */
  layers: Layer[];
  /** Files the prompt tells the agent to go and read. Not inlined; named. */
  runtime: Layer[];
  /** What is mechanically wrong with it. Each one carries the fix to hand to an AI. */
  problems?: AuditFinding[];
}

/**
 * What a staff member is actually sent, and what it was made of.
 *
 * The layer list is walked out of the includes rather than written down here. A hardcoded
 * list would be a second description of the composition, and the first thing to go stale
 * when somebody adds a fragment.
 */
export function promptView(
  ws: Workspace,
  compose: (o: { opsDir: string; brainsDir: string; staff: string; kind: string }) => string,
  staffHandle: string,
  brainDir: string,
  kind: string,
): PromptView {
  // A mention prompt is written for the comment that woke it, so previewing one needs
  // stand-in context. Obviously-fake values, so nobody mistakes a preview for a real run.
  const had = process.env.ROSTER_CONTEXT;
  if (kind !== "daily" && !had) {
    process.env.ROSTER_CONTEXT = JSON.stringify({
      issue_number: "0",
      comment_id: "0",
      pr_number: "0",
      repo: "<owner>/<repo>",
      actor: "<actor>",
    });
  }
  try {
    const composed = compose({
      opsDir: ws.opsDir,
      brainsDir: ws.root,
      staff: staffHandle,
      kind,
    });
    const entry = join(ws.opsDir, "prompts", `${kind}.md`);
    const layers: Layer[] = [describe(ws, brainDir, `prompts/${kind}.md`, false)];
    walk(ws, brainDir, entry, layers, new Set([resolve(entry)]));
    return {
      staff: staffHandle,
      kind,
      composed,
      layers,
      runtime: runtimeReads(ws, brainDir),
    };
  } finally {
    if (!had) delete process.env.ROSTER_CONTEXT;
  }
}

const INCLUDE = /\{\{>(\??)\s*([^}\s]+)\s*\}\}/g;

/** Follow `{{> …}}` and `{{>? …}}` from one file, depth first, in source order. */
function walk(ws: Workspace, brainDir: string, file: string, out: Layer[], seen: Set<string>) {
  if (!existsSync(file)) return;
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(INCLUDE)) {
    const rel = m[2]!;
    const layer = describe(ws, brainDir, rel, m[1] === "?");
    const full = resolve(ws.root, layer.path);
    if (seen.has(full)) continue;
    seen.add(full);
    out.push(layer);
    walk(ws, brainDir, full, out, seen);
  }
}

/* "staff:foo.md" resolves inside the staff member's own brain repo, which is how a role
   overrides or extends an org fragment without forking it. Everything else is the ops repo. */
function describe(ws: Workspace, brainDir: string, rel: string, optional: boolean): Layer {
  const inBrain = rel.startsWith("staff:");
  const base = inBrain ? brainDir : ws.opsDir;
  const full = join(base, inBrain ? rel.slice(6) : rel);
  const missing = !existsSync(full);
  return {
    rel,
    path: relative(ws.root, full),
    repo: inBrain ? relative(ws.root, brainDir) : ws.opsName,
    bytes: missing ? 0 : statSync(full).size,
    optional,
    missing,
    editable: !missing,
  };
}

/**
 * The three files the prompt names rather than contains.
 *
 * Worth saying out loud, because it is easy to read `AGENT-ORG-PLAN.md` and think the
 * charter is pasted into every run. It is not: the prompt tells the agent to open it, so it
 * costs nothing until the agent reads it, and editing it changes behaviour without changing
 * a single byte of the composed prompt.
 */
function runtimeReads(ws: Workspace, brainDir: string): Layer[] {
  const named: Array<[string, string]> = [
    [brainDir, "CHARTER.md"],
    [brainDir, "memory/INDEX.md"],
    [ws.opsDir, "org/business.md"],
  ];
  return named.map(([base, rel]) => {
    const full = join(base, rel);
    const missing = !existsSync(full);
    return {
      rel,
      path: relative(ws.root, full),
      repo: relative(ws.root, base),
      bytes: missing ? 0 : statSync(full).size,
      optional: false,
      missing,
      // memory/INDEX.md is the agent's own working memory; a human editing it by hand here
      // would be writing over what the next run is about to rewrite.
      editable: !missing && rel !== "memory/INDEX.md",
    };
  });
}

/**
 * Every file the portal is allowed to write.
 *
 * An allowlist rather than "anything under the workspace": this endpoint commits and pushes,
 * and the set of files a person edits to change how their agents behave is small and
 * nameable. `staff.yaml`, `.github/workflows/` and `memory/INDEX.md` are deliberately not in
 * it — the first two break composition when they are wrong, and the third is the agent's.
 *
 * `org.yaml` is the exception: it belongs to the person, not the agent, so it is writable, and
 * `validateOrgYaml` runs before anything is written.
 */
export function isWritable(ws: Workspace, rel: string, brainDirs: string[]): boolean {
  const full = resolve(ws.root, rel);
  if (!full.startsWith(resolve(ws.root) + "/")) return false;
  const opsRel = relative(resolve(ws.opsDir), full);
  if (!opsRel.startsWith("..")) {
    // org.yaml is writable but validated before it lands: it is the one file here that stops
    // every prompt composing when it is wrong, rather than just reading oddly.
    return (
      /^org\/[\w.-]+\.md$/.test(opsRel) ||
      /^prompts\/[\w.-]+\.md$/.test(opsRel) ||
      opsRel === "org.yaml"
    );
  }
  for (const dir of brainDirs) {
    const brainRel = relative(resolve(ws.root, dir), full);
    if (brainRel.startsWith("..")) continue;
    return brainRel === "CHARTER.md" || /^prompts\/[\w.-]+\.md$/.test(brainRel);
  }
  return false;
}

export interface SaveResult {
  path: string;
  repo: string;
  committed: boolean;
  pushed: boolean;
  sha?: string;
  note?: string;
}

/**
 * Write a file, commit just that file, and push.
 *
 * `commit -- <path>` rather than `commit -a`, so an unrelated edit sitting in the working
 * tree is not swept into a commit nobody asked for. A push that fails is reported rather
 * than thrown: the edit is on disk and committed, and that is the part that is hard to redo.
 */
export function saveFile(ws: Workspace, rel: string, text: string, message: string): SaveResult {
  const full = resolve(ws.root, rel);
  const repoDir = repoRootOf(full);
  const repo = relative(ws.root, repoDir) || ".";
  const before = existsSync(full) ? readFileSync(full, "utf8") : null;
  if (before === text)
    return { path: rel, repo, committed: false, pushed: false, note: "no change" };

  writeFileSync(full, text);
  const git = (args: string[]) =>
    execFileSync("git", ["-C", repoDir, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

  try {
    git(["add", "--", full]);
    git(["commit", "-m", message, "--", full]);
  } catch (err) {
    // Put the file back. A half-applied edit is worse than a failed one.
    if (before !== null) writeFileSync(full, before);
    throw new Error(`commit failed: ${short(err)}`);
  }

  const sha = git(["rev-parse", "--short", "HEAD"]).trim();
  try {
    git(["push"]);
  } catch (err) {
    return { path: rel, repo, committed: true, pushed: false, sha, note: short(err) };
  }
  return { path: rel, repo, committed: true, pushed: true, sha };
}

function repoRootOf(file: string): string {
  return execFileSync("git", ["-C", dirname(file), "rev-parse", "--show-toplevel"], {
    encoding: "utf8",
  }).trim();
}

function short(e: unknown): string {
  const msg = e instanceof Error ? (e as any).stderr?.toString() || e.message : String(e);
  const line = msg.split("\n").find((l: string) => l.trim()) ?? msg;
  return line.length > 200 ? line.slice(0, 199) + "…" : line;
}

/**
 * A shape check on org.yaml, before it is allowed to land.
 *
 * Not a schema. It catches the two ways an edit here is expensive: YAML the tenant's own
 * parser cannot read, and a file that parses but has lost the keys every prompt composes
 * against. Everything else is the person's business.
 */
export function validateOrgYaml(
  text: string,
  parseYaml: (t: string, f?: string) => Record<string, unknown>,
): string | null {
  let doc: Record<string, unknown>;
  try {
    doc = parseYaml(text, "org.yaml");
  } catch (err) {
    return `that is not YAML compose.mjs can read: ${(err as Error).message}`;
  }
  if (!doc || typeof doc !== "object") return "org.yaml has to be a mapping";
  for (const key of ["org", "name"]) {
    if (!doc[key] || typeof doc[key] !== "string") {
      return `org.yaml needs a "${key}", and every prompt is composed against it`;
    }
  }
  for (const key of ["staff", "repos", "humans"]) {
    if (doc[key] !== undefined && !Array.isArray(doc[key])) return `"${key}" has to be a list`;
  }
  for (const s of (doc.staff as Array<Record<string, unknown>>) ?? []) {
    if (!s?.handle) return "every staff entry needs a handle";
  }
  /* A human with no login cannot wake anybody: the mention callers gate on it. Refused here
     rather than warned about later, because the failure it causes is silence. */
  for (const h of (doc.humans as Array<Record<string, unknown>>) ?? []) {
    if (!h?.github) return "every entry in humans needs a github login";
  }
  return null;
}
