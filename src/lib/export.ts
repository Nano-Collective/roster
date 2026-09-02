import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { parseMemory, lintMemory, type Fact, type Link, type LintProblem } from "./memory.js";
import type { Workspace } from "./workspace.js";

export interface Surface {
  path: string;
  render: string;
  files: FileEntry[];
}

export interface FileEntry {
  path: string;
  bytes: number;
  modified: string;
  ext: string;
}

export interface StaffExport {
  handle: string;
  name: string;
  dir: string;
  brain?: string;
  statusIssue?: number;
  schedule?: string;
  mention?: string;
  facts: Fact[];
  sections: string[];
  notes: string[];
  links: Link[];
  problems: LintProblem[];
  surfaces: Surface[];
  recentCommits: Commit[];
  factsChanged: FactChange[];
}

export interface Commit {
  sha: string;
  date: string;
  subject: string;
  author: string;
}

export interface FactChange {
  slug: string;
  change: "added" | "removed";
  sha: string;
  date: string;
}

export interface OrgExport {
  org: string;
  name: string;
  human: Record<string, unknown>;
  generatedAt: string;
  staff: StaffExport[];
}

/** Files that are noise in a brain browser: git internals, dependencies, build output. */
const SKIP = new Set([".git", "node_modules", ".next", "dist", "out", ".DS_Store"]);

export function buildExport(
  ws: Workspace,
  org: { org: string; name: string; human?: Record<string, unknown>; staff?: Array<Record<string, any>> },
  parseYaml: (t: string, f?: string) => Record<string, unknown>,
  opts: { since?: string } = {},
): OrgExport {
  const staff: StaffExport[] = [];

  for (const entry of org.staff ?? []) {
    const dir = entry.dir ?? entry.handle;
    const root = join(ws.root, dir);
    if (!existsSync(root)) continue;

    const manifest = readManifest(root, parseYaml);
    const memDir = join(root, "memory");
    const doc = existsSync(join(memDir, "INDEX.md"))
      ? parseMemory(memDir)
      : { facts: [], sections: [], notes: [], preamble: "", links: [] };

    staff.push({
      handle: entry.handle,
      name: entry.name ?? manifest.name ?? entry.handle,
      dir,
      brain: manifest.brain,
      statusIssue: manifest.status_issue,
      schedule: entry.schedule ?? manifest.schedule,
      mention: manifest.mention,
      facts: doc.facts,
      sections: doc.sections,
      notes: doc.notes,
      links: doc.links,
      problems: existsSync(join(memDir, "INDEX.md")) ? lintMemory(doc, memDir) : [],
      surfaces: readSurfaces(root, manifest.surfaces ?? []),
      recentCommits: gitLog(root, 25),
      factsChanged: factsChanged(root, opts.since ?? "14 days ago"),
    });
  }

  return {
    org: org.org,
    name: org.name,
    human: org.human ?? {},
    generatedAt: new Date().toISOString(),
    staff,
  };
}

function readManifest(root: string, parseYaml: (t: string, f?: string) => Record<string, unknown>) {
  const path = join(root, "staff.yaml");
  if (!existsSync(path)) return {} as Record<string, any>;
  try {
    return parseYaml(readFileSync(path, "utf8"), "staff.yaml") as Record<string, any>;
  } catch {
    // A broken manifest should not take the whole portal down; lint is where that gets reported.
    return {} as Record<string, any>;
  }
}

function readSurfaces(root: string, declared: Array<{ path: string; render: string }>): Surface[] {
  return declared
    .filter((s) => s?.path && existsSync(join(root, s.path)))
    .map((s) => ({
      path: s.path,
      render: s.render ?? "doc",
      files: walk(join(root, s.path), root),
    }));
}

function walk(dir: string, root: string, out: FileEntry[] = []): FileEntry[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, root, out);
    else {
      out.push({
        path: relative(root, full),
        bytes: st.size,
        modified: st.mtime.toISOString(),
        ext: name.includes(".") ? name.split(".").pop()!.toLowerCase() : "",
      });
    }
  }
  return out;
}

function git(root: string, args: string[]): string {
  try {
    return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

function gitLog(root: string, n: number): Commit[] {
  const out = git(root, ["log", `-${n}`, "--format=%H%x1f%aI%x1f%s%x1f%an"]);
  return out
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [sha, date, subject, author] = l.split("\x1f");
      return { sha: sha!.slice(0, 8), date: date!, subject: subject!, author: author! };
    });
}

/**
 * What the agent learned and forgot recently. This is the view nothing else surfaces:
 * a diff of the memory index, reduced to slugs appearing and disappearing.
 */
function factsChanged(root: string, since: string): FactChange[] {
  const log = git(root, ["log", `--since=${since}`, "--format=%H%x1f%aI", "--", "memory/INDEX.md"]);
  const changes: FactChange[] = [];
  const slug = /^([+-])- \*\*`([^`]+)`\*\*/;

  for (const line of log.split("\n").filter(Boolean)) {
    const [sha, date] = line.split("\x1f");
    const diff = git(root, ["show", "--format=", "--unified=0", sha!, "--", "memory/INDEX.md"]);
    for (const l of diff.split("\n")) {
      const m = l.match(slug);
      if (!m) continue;
      changes.push({
        slug: m[2]!,
        change: m[1] === "+" ? "added" : "removed",
        sha: sha!.slice(0, 8),
        date: date!,
      });
    }
  }

  // A fact edited in place shows as remove+add in the same commit; that is a change, not both.
  return changes.filter(
    (c, i) =>
      !changes.some((o, j) => j < i && o.slug === c.slug && o.sha === c.sha && o.change !== c.change),
  );
}
