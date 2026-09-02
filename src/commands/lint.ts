import { join } from "node:path";
import { findWorkspace, loadComposer, readOrg } from "../lib/workspace.js";
import { parseMemory, lintMemory, type LintProblem } from "../lib/memory.js";

export const lintHelp = `
roster lint [handle]

  Check every staff member's memory against the grammar the portal and the agents both
  rely on. With no handle, checks everyone.

  --ops <dir>    ops repo directory (default: found by walking up)
  --quiet        print only problems
`;

export async function lintCommand(argv: string[]): Promise<number> {
  const handle = argv[0] && !argv[0].startsWith("-") ? argv[0] : undefined;
  const opts = parseFlags(argv.slice(handle ? 1 : 0));

  const ws = findWorkspace(opts.ops);
  const { parseYaml } = await loadComposer(ws.opsDir);
  const org = readOrg(ws.opsDir, parseYaml);

  const staff = (org.staff ?? []).filter((s) => !handle || s.handle === handle);
  if (staff.length === 0) {
    process.stderr.write(`roster: no staff member "${handle}" in org.yaml\n`);
    return 2;
  }

  let errors = 0;
  let warnings = 0;

  for (const s of staff) {
    const dir = join(ws.root, s.dir ?? s.handle, "memory");
    let problems: LintProblem[];
    let factCount = 0;
    try {
      const doc = parseMemory(dir);
      factCount = doc.facts.length;
      problems = lintMemory(doc, dir);
    } catch (err) {
      process.stdout.write(`\n  ${s.name}  ✗ ${err instanceof Error ? err.message : String(err)}\n`);
      errors++;
      continue;
    }

    const errs = problems.filter((p) => p.level === "error");
    const warns = problems.filter((p) => p.level === "warning");
    errors += errs.length;
    warnings += warns.length;

    if (opts.quiet && problems.length === 0) continue;

    const badge = errs.length ? "✗" : warns.length ? "!" : "✓";
    process.stdout.write(`\n  ${badge} ${s.name}  ${factCount} facts\n`);
    for (const p of problems) {
      const where = p.line ? `INDEX.md:${p.line}` : "notes/";
      process.stdout.write(`      ${p.level === "error" ? "error " : "warn  "} ${where.padEnd(15)} ${p.message}\n`);
      process.stdout.write(`      ${" ".repeat(6)} ${" ".repeat(15)} (${p.rule})\n`);
    }
  }

  process.stdout.write(
    `\n  ${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}\n\n`,
  );
  return errors > 0 ? 1 : 0;
}

function parseFlags(argv: string[]) {
  const out: { ops?: string; quiet?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--quiet") out.quiet = true;
    else if (argv[i] === "--ops") out.ops = argv[++i];
    else throw new Error(`unknown flag ${argv[i]}`);
  }
  return out;
}
