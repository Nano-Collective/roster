import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ghReady } from "../lib/gh.js";
import { specFromManifest } from "../lib/render.js";
import { dailyWorkflow, dispatch, findDispatched, follow } from "../lib/runonce.js";
import { findWorkspace, loadComposer, readOrg } from "../lib/workspace.js";

export const runHelp = `
roster run <handle> [--no-wait] [--apply]

  Start one daily run for a staff member now, and follow it to the end.

  A workflow that has never run has proved nothing: not that the App is installed on the right
  repos, not that the secrets are where the callers look, not that the ops repo is callable.
  So the last step of setting anybody up is one run, watched. When it finishes this prints the
  outcome, where it failed if it did, and the log's link, and \`roster doctor\` counts a
  success as proof from then on.

  It is a real run: it spends what a scheduled one would, and the agent does a day's work.
  Nothing happens without --apply. On its own this prints what it would start.

  --no-wait    start it and print the link, without following it
  --apply      start the run
  --ops <dir>  ops repo directory (default: found by walking up)
`;

export async function runCommand(argv: string[]): Promise<number> {
  const handle = argv[0];
  if (!handle || handle.startsWith("-")) {
    process.stderr.write("roster: run needs a staff handle, e.g. `roster run cto`\n");
    return 2;
  }
  const opts = parseFlags(argv.slice(1));
  const ws = findWorkspace(opts.ops);
  const { parseYaml } = await loadComposer(ws.opsDir);
  const org = readOrg(ws.opsDir, parseYaml) as any;
  const entry = (org.staff ?? []).find((s: any) => s.handle === handle);
  if (!entry) {
    process.stderr.write(`roster: no staff member "${handle}" in org.yaml\n`);
    return 2;
  }
  const dir = entry.dir ?? entry.handle;
  const manifestPath = join(ws.root, dir, "staff.yaml");
  if (!existsSync(manifestPath)) {
    process.stderr.write(`roster: ${dir}/staff.yaml is missing\n`);
    return 2;
  }
  const spec = specFromManifest(
    parseYaml(readFileSync(manifestPath, "utf8"), "staff.yaml") as any,
    dir,
  );
  const workflow = dailyWorkflow(handle);

  process.stdout.write(
    `\n  roster run — ${spec.name} (${handle})\n\n` +
      `    starts      ${workflow} on ${spec.brain}, now rather than at its schedule\n` +
      `    spends      what a scheduled run does, up to ${spec.timeout} minutes\n` +
      (opts.noWait ? "" : `    then        follows it and reports how it ended\n`) +
      "\n",
  );
  if (!opts.apply) {
    process.stdout.write("  Nothing was started. Re-run with --apply.\n\n");
    return 0;
  }

  const ready = await ghReady();
  if (!ready.ok) {
    process.stderr.write(`roster: ${ready.error}\n`);
    return 1;
  }

  const since = Date.now();
  const started = await dispatch(spec.brain, workflow);
  if (!started.ok) {
    process.stderr.write(`roster: could not start ${workflow}: ${started.error}\n`);
    return 1;
  }
  const run = await findDispatched(spec.brain, workflow, since);
  if (!run) {
    process.stdout.write(
      `  started, but the run did not appear in time. Watch it at\n` +
        `    https://github.com/${spec.brain}/actions/workflows/${workflow}\n\n`,
    );
    return 0;
  }
  process.stdout.write(`  started: ${run.url}\n`);
  if (opts.noWait) {
    process.stdout.write("\n");
    return 0;
  }

  const outcome = await follow(spec.brain, run.databaseId, {
    timeoutMs: (spec.timeout + 15) * 60_000,
    onChange: (status) =>
      process.stdout.write(`  ${new Date().toISOString().slice(11, 19)}  ${status}\n`),
  });
  if (!outcome) {
    process.stdout.write(`  still going after the ceiling. The log: ${run.url}\n\n`);
    return 1;
  }
  if (outcome.conclusion === "success") {
    process.stdout.write(
      `\n  It worked. The App, its grant, the secrets and the callers are all proven,\n` +
        `  and roster doctor ${handle} now says so. The log: ${outcome.url}\n\n`,
    );
    return 0;
  }
  process.stdout.write(
    `\n  It ended ${outcome.conclusion || "without a conclusion"}.\n` +
      outcome.failedAt.map((f) => `    failed at  ${f}\n`).join("") +
      `  The log: ${outcome.url}\n` +
      `  docs/troubleshooting.md has what each failure usually means.\n\n`,
  );
  return 1;
}

interface Flags {
  ops?: string;
  noWait?: boolean;
  apply?: boolean;
}

function parseFlags(argv: string[]): Flags {
  const out: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--apply") out.apply = true;
    else if (flag === "--no-wait") out.noWait = true;
    else if (flag === "--ops") {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${flag} needs a value`);
      out.ops = value;
    } else throw new Error(`unknown flag ${flag}`);
  }
  return out;
}
