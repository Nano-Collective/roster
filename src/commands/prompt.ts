import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractLivePrompt } from "../lib/livePrompt.js";
import { findWorkspace, loadComposer, readOrg } from "../lib/workspace.js";

export const promptHelp = `
roster prompt <handle> [options]

  Compose the runtime prompt for one staff member and print it. This is exactly what the
  agent is sent — the CLI imports the tenant's own compose.mjs, so there is no second
  implementation to drift.

  --kind <k>       daily | mention                     (default: daily)
  --diff <file>    diff the composed prompt against the prompt: block in a workflow file
  --stat           with --diff, print a summary instead of the full diff
  --ops <dir>      ops repo directory (default: found by walking up)
`;

export async function promptCommand(argv: string[]): Promise<number> {
  const handle = argv[0];
  if (!handle || handle.startsWith("-")) {
    process.stderr.write(promptHelp);
    return 2;
  }
  const opts = parseFlags(argv.slice(1));
  const ws = findWorkspace(opts.ops);
  const { compose, parseYaml } = await loadComposer(ws.opsDir);
  const org = readOrg(ws.opsDir, parseYaml);
  const kind = opts.kind ?? "daily";

  // A mention prompt is written for the comment that woke it, so previewing one needs
  // stand-in context. Obviously-fake values, so nobody mistakes a preview for a real run.
  if (kind !== "daily" && !process.env.ROSTER_CONTEXT) {
    process.env.ROSTER_CONTEXT = JSON.stringify({
      issue_number: "0",
      comment_id: "0",
      pr_number: "0",
      repo: `${org.org}/<repo>`,
      actor: "<actor>",
    });
  }

  const composed = compose({ opsDir: ws.opsDir, brainsDir: ws.root, staff: handle, kind });

  if (!opts.diff) {
    process.stdout.write(composed);
    return 0;
  }

  const live = extractLivePrompt(join(ws.root, opts.diff));
  const dir = mkdtempSync(join(tmpdir(), "roster-diff-"));
  const a = join(dir, "live.md");
  const b = join(dir, "composed.md");
  writeFileSync(a, normalise(live));
  writeFileSync(b, normalise(composed));

  const entry = org.staff?.find((s) => s.handle === handle);
  process.stdout.write(`\n  ${entry?.name ?? handle} · ${kind}\n`);
  process.stdout.write(`  live:     ${opts.diff}\n`);
  process.stdout.write(`  composed: ${ws.opsName}/prompts/${kind}.md\n\n`);

  const args = ["diff", "--no-index", "--color=always"];
  if (opts.stat) args.push("--stat");
  else args.push("--unified=2");
  args.push(a, b);

  try {
    execFileSync("git", args, { stdio: "inherit" });
    process.stdout.write("  identical\n\n");
    return 0;
  } catch {
    // git diff exits 1 when files differ, which is the normal case here.
    process.stdout.write("\n  Every difference above must be deliberate before cutting over.\n\n");
    return 1;
  }
}

/**
 * Whitespace-only differences are noise for this comparison: the live prompt was
 * hand-wrapped inside YAML, the composed one is wrapped in markdown files.
 */
function normalise(text: string): string {
  return (
    text
      .split("\n")
      .map((l) => l.replace(/\s+$/, ""))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim() + "\n"
  );
}

function parseFlags(argv: string[]) {
  const out: { kind?: string; diff?: string; ops?: string; stat?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--stat") {
      out.stat = true;
      continue;
    }
    const value = argv[++i];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flag === "--kind") out.kind = value;
    else if (flag === "--diff") out.diff = value;
    else if (flag === "--ops") out.ops = value;
    else throw new Error(`unknown flag ${flag}`);
  }
  return out;
}
