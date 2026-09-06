import { writeFileSync } from "node:fs";
import { buildExport } from "../lib/export.js";
import { findWorkspace, loadComposer, readOrg } from "../lib/workspace.js";

export const exportHelp = `
roster export [--out file.json]

  The whole org as one JSON: staff, manifests, parsed memory, the link graph, lint
  problems, declared surfaces with their files, and recent memory changes.

  Rendering is decoupled from parsing on purpose, so a hosted portal is a build step
  rather than a rewrite.

  --out <file>   write to a file instead of stdout
  --ops <dir>    ops repo directory (default: found by walking up)
`;

export async function exportCommand(argv: string[]): Promise<number> {
  let out: string | undefined;
  let ops: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const v = argv[++i];
    if (v === undefined) throw new Error(`${argv[i - 1]} needs a value`);
    if (argv[i - 1] === "--out") out = v;
    else if (argv[i - 1] === "--ops") ops = v;
    else throw new Error(`unknown flag ${argv[i - 1]}`);
  }

  const ws = findWorkspace(ops);
  const { parseYaml } = await loadComposer(ws.opsDir);
  const data = buildExport(ws, readOrg(ws.opsDir, parseYaml) as any, parseYaml);
  const json = JSON.stringify(data, null, 2);

  if (out) {
    writeFileSync(out, json + "\n");
    const facts = data.staff.reduce((n, s) => n + s.facts.length, 0);
    process.stdout.write(
      `  ${out}  ${data.staff.length} staff, ${facts} facts, ${Math.round(json.length / 1024)}kb\n`,
    );
  } else {
    process.stdout.write(json + "\n");
  }
  return 0;
}
