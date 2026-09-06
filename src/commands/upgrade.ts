import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { findWorkspace } from "../lib/workspace.js";
import { merge3 } from "../lib/merge.js";
import { classify, opsTemplateDir, templateFiles, type TemplateClass } from "../lib/templates.js";

export const upgradeHelp = `
roster upgrade [--apply] [--check] [--baseline <git-ref>]

  Carry framework changes into this tenant's ops repo, keeping the tenant's own edits.

  A generated file has three versions: what the framework shipped when this tenant was
  seeded, what it ships now, and what the tenant has today. Upgrading is a three-way merge
  between them, so a tenant that has rewritten half of org/voice.md still gets the rest.

  The base lives in <ops>/.roster/seed/ and is written by --apply. A tenant seeded before
  that existed has no base; --baseline reconstructs one from the framework's git history.

  Nothing is written without --apply, and a conflict is never written into a live file:
  agents read these every morning, and conflict markers in org/voice.md would land in every
  prompt. Conflicts go to <file>.roster-merge for you to resolve by hand.

  --apply               write the result, and advance the recorded base
  --check               exit non-zero if anything is out of date (for CI)
  --baseline <git-ref>  one-time: record the base from the framework at this ref
  --ops <dir>           ops repo directory (default: found by walking up)

  Scope: the ops repo only. The brain-repo templates carry %%TOKENS%% that nothing fills
  until \`roster hire\` exists, so they are not compared here.
`;

type Verdict =
  | "same"
  | "added"
  | "updated"
  | "local"
  | "merged"
  | "conflict"
  | "no-base"
  | "edited-managed";

export interface FilePlan {
  rel: string;
  kind: TemplateClass;
  verdict: Verdict;
  note: string;
  /** What --apply would write. Absent when there is nothing to write. */
  next?: string;
  /** The merge result including markers, when it conflicted. */
  rejected?: string;
  conflicts?: number;
}

export async function upgradeCommand(argv: string[]): Promise<number> {
  const opts = parseFlags(argv);
  const ws = findWorkspace(opts.ops);
  const tplDir = opsTemplateDir();
  const seedDir = join(ws.opsDir, ".roster", "seed");

  if (opts.baseline) {
    return writeBaseline(ws.opsDir, seedDir, tplDir, opts.baseline);
  }

  const plans = planAll(tplDir, seedDir, ws.opsDir);

  report(ws, plans, opts);

  const blocked = plans.filter(
    (p) => p.verdict === "conflict" || p.verdict === "no-base" || p.verdict === "edited-managed",
  );
  const pending = plans.filter((p) => p.next !== undefined);

  if (opts.check) {
    return pending.length || blocked.length ? 1 : 0;
  }
  if (!opts.apply) {
    if (pending.length || blocked.length) {
      process.stdout.write("  Nothing was written. Re-run with --apply.\n\n");
    }
    return 0;
  }

  return apply(ws.opsDir, seedDir, tplDir, plans);
}

/** What an upgrade would do to every generated file, without doing any of it. */
export function planAll(tplDir: string, seedDir: string, opsDir: string): FilePlan[] {
  return templateFiles(tplDir).map((rel) => plan(rel, tplDir, seedDir, opsDir));
}

export function plan(rel: string, tplDir: string, seedDir: string, opsDir: string): FilePlan {
  const kind = classify(rel);
  const incoming = readFileSync(join(tplDir, rel), "utf8");
  const currentPath = join(opsDir, rel);
  const basePath = join(seedDir, rel);

  const has = (p: string) => existsSync(p);
  const current = has(currentPath) ? readFileSync(currentPath, "utf8") : null;
  const base = has(basePath) ? readFileSync(basePath, "utf8") : null;

  if (current === null) {
    return { rel, kind, verdict: "added", note: "new in the framework", next: incoming };
  }
  if (current === incoming) {
    return { rel, kind, verdict: "same", note: "up to date" };
  }
  if (base === null) {
    return {
      rel, kind, verdict: "no-base",
      note: "differs, and there is no recorded base to merge against",
    };
  }
  if (base === incoming) {
    /* The framework has not moved, so whatever the tenant did is theirs to keep — unless the
       framework owns the file. Then the edit is in the wrong place and is merely not broken
       *yet*: it survives only until the framework touches that file, at which point it is a
       conflict at best. Reported even though there is nothing to write, because being quiet
       here is how a fix gets applied to a tenant and silently lost later. */
    return kind === "managed"
      ? { rel, kind, verdict: "edited-managed",
          note: "edited here, but the framework owns it — move your change upstream" }
      : { rel, kind, verdict: "local", note: "your own version; the framework has not changed it" };
  }
  if (base === current) {
    return { rel, kind, verdict: "updated", note: "updated from the framework", next: incoming };
  }

  const { text, conflicts } = merge3(current, base, incoming);
  if (conflicts === 0) {
    return {
      rel, kind,
      verdict: kind === "managed" ? "edited-managed" : "merged",
      note: kind === "managed"
        ? "merged, but this is a framework file — move your change upstream"
        : "merged with your changes",
      next: text,
    };
  }
  return {
    rel, kind, verdict: "conflict", conflicts, rejected: text,
    note: `${conflicts} conflict${conflicts === 1 ? "" : "s"}`,
  };
}

const GLYPH: Record<Verdict, string> = {
  same: "✓", added: "+", updated: "↑", local: "=", merged: "~",
  conflict: "✗", "no-base": "?", "edited-managed": "!",
};

function report(ws: { opsName: string }, plans: FilePlan[], opts: Flags) {
  const width = Math.max(...plans.map((p) => p.rel.length)) + 2;
  process.stdout.write(`\n  roster upgrade — ${ws.opsName}\n\n`);
  for (const p of plans) {
    // Files that are already right are noise once there are more than a handful.
    if (p.verdict === "same" && !opts.verbose) continue;
    process.stdout.write(`    ${GLYPH[p.verdict]} ${p.rel.padEnd(width)}${p.note}\n`);
  }

  const n = (v: Verdict) => plans.filter((p) => p.verdict === v).length;
  const parts = [
    `${n("same")} up to date`,
    n("local") ? `${n("local")} yours` : "",
    n("added") ? `${n("added")} new` : "",
    n("updated") ? `${n("updated")} to update` : "",
    n("merged") ? `${n("merged")} to merge` : "",
    n("edited-managed") ? `${n("edited-managed")} framework file edited locally` : "",
    n("conflict") ? `${n("conflict")} conflicting` : "",
    n("no-base") ? `${n("no-base")} without a base` : "",
  ].filter(Boolean);
  process.stdout.write(`\n  ${parts.join(", ")}\n`);

  if (n("no-base")) {
    process.stdout.write(
      "\n  No base was recorded for some files, so they cannot be merged. Reconstruct one\n" +
      "  from the framework's history with:  roster upgrade --baseline <git-ref>\n",
    );
  }
  if (n("edited-managed")) {
    process.stdout.write(
      "\n  A framework file edited in the tenant will be merged on every upgrade until the\n" +
      "  change moves into the framework's own copy. That is how a fix gets quietly reverted.\n",
    );
  }
  process.stdout.write("\n");
}

export function apply(opsDir: string, seedDir: string, tplDir: string, plans: FilePlan[]): number {
  let wrote = 0;
  let left = 0;

  for (const p of plans) {
    if (p.verdict === "conflict") {
      // Deliberately not into the live file: an agent reads these every morning.
      const out = join(opsDir, p.rel + ".roster-merge");
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, p.rejected!);
      process.stdout.write(`    wrote ${p.rel}.roster-merge — resolve it, then re-run\n`);
      left++;
      continue;
    }
    if (p.verdict === "no-base") { left++; continue; }
    if (p.next === undefined) {
      // Nothing to write, but the base still advances when the framework has not moved.
      if (p.verdict === "same") seed(seedDir, tplDir, p.rel);
      continue;
    }
    const dest = join(opsDir, p.rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, p.next);
    // The base only advances for a file that actually reached the new template. Advancing it
    // for a conflicted file would throw away the only thing that can merge it next time.
    seed(seedDir, tplDir, p.rel);
    wrote++;
  }

  process.stdout.write(`\n  ${wrote} file${wrote === 1 ? "" : "s"} written`);
  process.stdout.write(left ? `, ${left} left for you\n\n` : "\n\n");
  if (!left) writeFileSync(join(opsDir, ".roster-version"), stamp() + "\n");
  return left ? 1 : 0;
}

function seed(seedDir: string, tplDir: string, rel: string) {
  const dest = join(seedDir, rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, readFileSync(join(tplDir, rel), "utf8"));
}

/**
 * Retrofit a base for a tenant seeded before one was recorded, by reading the framework's own
 * templates as they were at a given ref. This is the only way to get a real merge base for
 * `acme`, whose ops repo predates all of this.
 */
function writeBaseline(opsDir: string, seedDir: string, tplDir: string, ref: string): number {
  const framework = join(tplDir, "..", "..");
  let files: string[];
  try {
    files = execFileSync("git", ["-C", framework, "ls-tree", "-r", "--name-only", `${ref}:templates/ops`], {
      encoding: "utf8",
    }).split("\n").filter(Boolean);
  } catch {
    process.stderr.write(`roster: cannot read templates/ops at "${ref}" in ${framework}\n`);
    return 2;
  }

  rmSync(seedDir, { recursive: true, force: true });
  for (const rel of files) {
    const text = execFileSync("git", ["-C", framework, "show", `${ref}:templates/ops/${rel}`], {
      encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
    });
    const dest = join(seedDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, text);
  }
  writeFileSync(join(opsDir, ".roster-version"), `${ref}\n`);

  process.stdout.write(
    `\n  Recorded ${files.length} files as the base, from the framework at ${ref}.\n` +
    `  Written to ${join(opsDir, ".roster", "seed")} — commit it; it is what makes the next\n` +
    "  upgrade a merge rather than a copy.\n\n  Now run: roster upgrade\n\n",
  );
  return 0;
}

/** What the tenant was last upgraded to. A label for humans; .roster/seed is the truth. */
function stamp(): string {
  try {
    return execFileSync("git", ["-C", join(opsTemplateDir(), "..", ".."), "rev-parse", "--short", "HEAD"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

interface Flags { apply?: boolean; check?: boolean; ops?: string; baseline?: string; verbose?: boolean }

function parseFlags(argv: string[]): Flags {
  const out: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--apply") out.apply = true;
    else if (flag === "--check") out.check = true;
    else if (flag === "--verbose" || flag === "-v") out.verbose = true;
    else if (flag === "--ops") out.ops = argv[++i];
    else if (flag === "--baseline") out.baseline = argv[++i];
    else throw new Error(`unknown flag ${flag}`);
  }
  if (out.apply && out.check) throw new Error("--apply and --check do different jobs; pick one");
  return out;
}
