import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { merge3 } from "../lib/merge.js";
import {
  brainTemplateDir,
  type OrgSpec,
  renderTree,
  specFromManifest,
  tokensFor,
} from "../lib/render.js";
import {
  classify,
  classifyBrain,
  opsTemplateDir,
  type TemplateClass,
  templateFiles,
} from "../lib/templates.js";
import { findWorkspace, loadComposer, readOrg, type Workspace } from "../lib/workspace.js";

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

  Brain repos are covered too, but only their caller workflows. Everything else \`hire\` writes
  — the charter, the memory index, the decisions log, the manifest — belongs to the staff
  member from the moment it is created, and a working agent rewrites it beyond recognition.
  Those are reported if they go missing and otherwise left alone.

  A caller is regenerated wholesale rather than merged. It is derived entirely from the
  manifest and the template, so there is no third version to reconcile: what looks like a
  local edit is either a template change that has not arrived, or something that should have
  been a manifest change. The diff is printed either way, so nothing goes quietly.
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
  const { parseYaml } = await loadComposer(ws.opsDir);
  const tplDir = opsTemplateDir();
  const seedDir = join(ws.opsDir, ".roster", "seed");

  if (opts.baseline) {
    return writeBaseline(ws.opsDir, seedDir, tplDir, opts.baseline);
  }

  const plans = planAll(tplDir, seedDir, ws.opsDir);
  const brains = planBrains(ws, parseYaml);

  report(ws, plans, opts);
  reportBrains(brains, opts);

  const blocked = plans.filter(
    (p) => p.verdict === "conflict" || p.verdict === "no-base" || p.verdict === "edited-managed",
  );
  const pending = plans.filter((p) => p.next !== undefined);

  const brainWork = brains.flatMap((b) => b.files.filter((f) => f.verdict !== "same"));

  if (opts.check) {
    return pending.length || blocked.length || brainWork.length ? 1 : 0;
  }
  if (!opts.apply) {
    if (pending.length || blocked.length || brainWork.length) {
      process.stdout.write("  Nothing was written. Re-run with --apply.\n\n");
    }
    return 0;
  }

  const code = apply(ws.opsDir, seedDir, tplDir, plans);
  applyBrains(brains);
  return code;
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
      rel,
      kind,
      verdict: "no-base",
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
      ? {
          rel,
          kind,
          verdict: "edited-managed",
          note: "edited here, but the framework owns it — move your change upstream",
        }
      : { rel, kind, verdict: "local", note: "your own version; the framework has not changed it" };
  }
  if (base === current) {
    return { rel, kind, verdict: "updated", note: "updated from the framework", next: incoming };
  }

  const { text, conflicts } = merge3(current, base, incoming);
  if (conflicts === 0) {
    return {
      rel,
      kind,
      verdict: kind === "managed" ? "edited-managed" : "merged",
      note:
        kind === "managed"
          ? "merged, but this is a framework file — move your change upstream"
          : "merged with your changes",
      next: text,
    };
  }
  return {
    rel,
    kind,
    verdict: "conflict",
    conflicts,
    rejected: text,
    note: `${conflicts} conflict${conflicts === 1 ? "" : "s"}`,
  };
}

const GLYPH: Record<Verdict, string> = {
  same: "✓",
  added: "+",
  updated: "↑",
  local: "=",
  merged: "~",
  conflict: "✗",
  "no-base": "?",
  "edited-managed": "!",
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
    if (p.verdict === "no-base") {
      left++;
      continue;
    }
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
 * `playpip`, whose ops repo predates all of this.
 */
function writeBaseline(opsDir: string, seedDir: string, tplDir: string, ref: string): number {
  const framework = join(tplDir, "..", "..");
  let files: string[];
  try {
    files = execFileSync(
      "git",
      ["-C", framework, "ls-tree", "-r", "--name-only", `${ref}:templates/ops`],
      {
        encoding: "utf8",
      },
    )
      .split("\n")
      .filter(Boolean);
  } catch {
    process.stderr.write(`roster: cannot read templates/ops at "${ref}" in ${framework}\n`);
    return 2;
  }

  rmSync(seedDir, { recursive: true, force: true });
  for (const rel of files) {
    const text = execFileSync("git", ["-C", framework, "show", `${ref}:templates/ops/${rel}`], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
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
    return execFileSync(
      "git",
      ["-C", join(opsTemplateDir(), "..", ".."), "rev-parse", "--short", "HEAD"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
  } catch {
    return "unknown";
  }
}

interface Flags {
  apply?: boolean;
  check?: boolean;
  ops?: string;
  baseline?: string;
  verbose?: boolean;
}

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

/* ------------------------------ brain repos ------------------------------ */

export interface BrainFile {
  rel: string;
  kind: "generated" | "scaffold";
  verdict: "same" | "regenerate" | "missing";
  /** What --apply would write. Absent for a scaffold file, which is never rewritten. */
  next?: string;
  diff?: string;
}

export interface BrainPlan {
  handle: string;
  dir: string;
  root: string;
  files: BrainFile[];
  problem?: string;
}

type ParseYaml = (t: string, f?: string) => Record<string, unknown>;

/**
 * What every staff member's generated files should look like today.
 *
 * The spec comes from each staff member's own manifest, never from org.yaml's defaults. That
 * is the whole trick: the tenant's values appear identically in what is on disk and in what is
 * rendered, so they cancel, and only a template change shows up. Read the defaults instead and
 * the CTO's deliberate 90-minute ceiling would read as drift to be reverted.
 */
export function planBrains(ws: Workspace, parseYaml: ParseYaml): BrainPlan[] {
  const org = readOrg(ws.opsDir, parseYaml) as any;
  const orgSpec: OrgSpec = {
    org: org.org,
    name: org.name,
    opsRepo: `${org.org}/${ws.opsName}`,
    opsDirName: ws.opsName,
    human: org.human?.github ?? "",
    humanMarker: org.human?.marker ?? "human",
  };

  const out: BrainPlan[] = [];
  for (const entry of org.staff ?? []) {
    const dir = entry.dir ?? entry.handle;
    const root = join(ws.root, dir);
    const base: BrainPlan = { handle: entry.handle, dir, root, files: [] };

    const manifestPath = join(root, "staff.yaml");
    if (!existsSync(manifestPath)) {
      out.push({ ...base, problem: existsSync(root) ? "no staff.yaml" : "not checked out here" });
      continue;
    }

    let want: Map<string, string>;
    try {
      const spec = specFromManifest(
        parseYaml(readFileSync(manifestPath, "utf8"), "staff.yaml") as any,
        dir,
      );
      want = renderTree(brainTemplateDir(), tokensFor(orgSpec, spec));
    } catch (err) {
      out.push({
        ...base,
        problem: `cannot render: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`,
      });
      continue;
    }

    for (const [rel, text] of want) {
      const kind = classifyBrain(rel);
      const live = join(root, rel);
      if (!existsSync(live)) {
        /* Written, whichever class it is. A file the framework has and the tenant does not is
           almost always one the framework has just introduced — the /charter command reaching
           staff hired before it existed. Adding it back cannot destroy anything, and the
           alternative is that no scaffold improvement ever reaches an existing staff member.
           The cost is that deleting one is not permanent, which for a README is a papercut. */
        base.files.push({ rel, kind, verdict: "missing", next: text });
        continue;
      }
      if (kind === "scaffold") continue; // theirs from the moment it was written
      const have = readFileSync(live, "utf8");
      base.files.push(
        have === text
          ? { rel, kind, verdict: "same" }
          : { rel, kind, verdict: "regenerate", next: text, diff: unified(have, text) },
      );
    }
    out.push(base);
  }
  return out;
}

/** A short unified diff, so a regeneration is never a silent overwrite. */
function unified(before: string, after: string): string {
  const dir = mkdtempSync(join(tmpdir(), "roster-diff-"));
  try {
    writeFileSync(join(dir, "a"), before);
    writeFileSync(join(dir, "b"), after);
    try {
      execFileSync(
        "diff",
        ["-u", "--label", "yours", "--label", "generated", join(dir, "a"), join(dir, "b")],
        { encoding: "utf8" },
      );
      return "";
    } catch (err) {
      const out = String((err as { stdout?: string }).stdout ?? "");
      return out.split("\n").slice(2).join("\n").trimEnd();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function reportBrains(brains: BrainPlan[], opts: Flags) {
  for (const b of brains) {
    const interesting = b.files.filter((f) => f.verdict !== "same");
    if (!interesting.length && !b.problem && !opts.verbose) continue;

    process.stdout.write(`  ${b.handle} — ${b.dir}\n`);
    if (b.problem) {
      process.stdout.write(`    ? ${b.problem}\n\n`);
      continue;
    }
    for (const f of b.files) {
      if (f.verdict === "same") {
        if (opts.verbose) process.stdout.write(`    ✓ ${f.rel}  up to date\n`);
        continue;
      }
      if (f.verdict === "missing") {
        process.stdout.write(`    + ${f.rel}  new in the framework\n`);
        continue;
      }
      process.stdout.write(`    ↑ ${f.rel}  differs from the template\n`);
      if (f.diff) {
        for (const line of f.diff.split("\n")) process.stdout.write(`        ${line}\n`);
      }
    }
    process.stdout.write("\n");
  }
}

function applyBrains(brains: BrainPlan[]) {
  let wrote = 0;
  for (const b of brains) {
    for (const f of b.files) {
      if (f.next === undefined) continue;
      const dest = join(b.root, f.rel);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, f.next);
      wrote++;
    }
  }
  if (wrote) {
    process.stdout.write(`  regenerated ${wrote} caller workflow${wrote === 1 ? "" : "s"}\n`);
    process.stdout.write(`  (in the brain repos — commit and push them; App tokens cannot)\n\n`);
  }
}
