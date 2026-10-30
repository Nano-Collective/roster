import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { commitAndPush } from "../lib/commit.js";
import { humanLogins } from "../lib/humans.js";
import { type OrgSpec, toolsOf } from "../lib/render.js";
import { planSchedule, readSchedule, type Schedule } from "../lib/routineplan.js";
import { describeCron, routineId, validCron } from "../lib/routines.js";
import { findWorkspace, loadComposer, readOrg } from "../lib/workspace.js";

export const routineHelp = `
roster routine <handle>                          list their daily round and routines
roster routine <handle> add --name <n> --at <cron> --do <text> [--apply]
roster routine <handle> remove <id> [--apply]
roster routine <handle> daily <cron> [--apply]
roster routine <handle> run <id>

  Routines are the times a staff member wakes beyond the daily round, each with its own job:
  "every Monday at 09:00, plan the week", "on the 1st, write the month's report". The time
  goes in staff.yaml, what to do in routines/<id>.md, and both are compiled into the daily
  caller's schedule, so a routine costs nothing between runs.

  Times are five-field cron, in UTC: "0 9 * * 1" is Mondays at 09:00. The portal's Routines
  screen writes the same files with a picker.

  Nothing changes without --apply. With it, the brain repo is committed and pushed as you.

  --name <text>     what the routine is called
  --at <cron>       when it runs, UTC
  --do <text>       what to do, in your words. --do-file <path> reads it from a file.
  --apply           write, commit and push
  --ops <dir>       ops repo directory (default: found by walking up)
`;

export async function routineCommand(argv: string[]): Promise<number> {
  const [handle, action = "list", ...rest] = argv.filter((a, i) => !(i === 0 && a.startsWith("-")));
  if (!handle || handle.startsWith("-")) {
    process.stderr.write(routineHelp);
    return 2;
  }
  const opts = parseFlags(rest);
  const ws = findWorkspace(opts.ops);
  const { parseYaml } = await loadComposer(ws.opsDir);
  const org = readOrg(ws.opsDir, parseYaml) as any;
  const entry = (org.staff ?? []).find((s: any) => s.handle === handle);
  if (!entry) {
    process.stderr.write(`roster: no staff member "${handle}" in org.yaml\n`);
    return 2;
  }
  const dir = entry.dir ?? entry.handle;
  const root = join(ws.root, dir);
  const manifestPath = join(root, "staff.yaml");
  if (!existsSync(manifestPath)) {
    process.stderr.write(`roster: ${dir}/ is not checked out here\n`);
    return 1;
  }
  const manifestText = readFileSync(manifestPath, "utf8");
  const current = (rel: string) =>
    existsSync(join(root, rel)) ? readFileSync(join(root, rel), "utf8") : undefined;
  const now = readSchedule(parseYaml(manifestText, "staff.yaml"), current);

  if (action === "list") {
    process.stdout.write(`\n  ${handle}\n\n  ${describeCron(now.daily)}   daily round\n`);
    for (const r of now.routines) {
      process.stdout.write(`  ${describeCron(r.schedule)}   ${r.title} (${r.id})\n`);
    }
    if (!now.routines.length) process.stdout.write("  no routines yet\n");
    process.stdout.write("\n");
    return 0;
  }

  if (action === "run") {
    const id = opts.positional[0];
    if (!id || !now.routines.some((r) => r.id === id)) {
      process.stderr.write(`roster: ${handle} has no routine "${id ?? ""}"\n`);
      return 2;
    }
    execFileSync(
      "gh",
      ["workflow", "run", `${handle}-daily.yaml`, "-R", `${org.org}/${dir}`, "-f", `routine=${id}`],
      { stdio: "inherit" },
    );
    process.stdout.write(
      `  started ${id}. It shows in the portal and in ${dir}'s Actions as "${handle} routine ${id}".\n`,
    );
    return 0;
  }

  let next: Schedule;
  let message: string;
  if (action === "add") {
    const body = opts.doFile ? readFileSync(opts.doFile, "utf8") : opts.do;
    if (!opts.name || !opts.at || !body) {
      process.stderr.write("roster: add needs --name, --at and --do (or --do-file)\n");
      return 2;
    }
    const id = routineId(
      opts.name,
      now.routines.map((r) => r.id),
    );
    next = {
      ...now,
      routines: [...now.routines, { id, title: opts.name, body, schedule: opts.at }],
    };
    message = `routines: ${opts.name}, ${describeCron(opts.at)}`;
  } else if (action === "remove") {
    const id = opts.positional[0];
    if (!id || !now.routines.some((r) => r.id === id)) {
      process.stderr.write(`roster: ${handle} has no routine "${id ?? ""}"\n`);
      return 2;
    }
    next = { ...now, routines: now.routines.filter((r) => r.id !== id) };
    message = `routines: remove ${id}`;
  } else if (action === "daily") {
    const cron = opts.positional[0];
    if (!cron || !validCron(cron)) {
      process.stderr.write(`roster: daily needs a cron, e.g. "0 8 * * 1-5"\n`);
      return 2;
    }
    next = { ...now, daily: cron };
    message = `routines: daily round ${describeCron(cron)}`;
  } else {
    process.stderr.write(routineHelp);
    return 2;
  }

  const session = readFileSync(join(ws.opsDir, ".github", "workflows", "session.yaml"), "utf8");
  const plan = planSchedule({
    manifest: manifestText,
    parseYaml,
    dir,
    org: orgSpecOf(org, ws.opsName),
    next,
    current,
    session,
  });
  if (plan.errors.length) {
    for (const e of plan.errors) process.stderr.write(`roster: ${e}\n`);
    return 1;
  }

  process.stdout.write(`\n  ${message}\n\n`);
  for (const c of plan.changes) {
    process.stdout.write(
      `    ${c.text === null ? "delete" : existsSync(join(root, c.path)) ? "update" : "create"}  ${dir}/${c.path}\n`,
    );
  }
  if (!opts.apply) {
    process.stdout.write("\n  Nothing was written. Re-run with --apply.\n\n");
    return 0;
  }
  for (const c of plan.changes) {
    const full = join(root, c.path);
    if (c.text === null) rmSync(full, { force: true });
    else {
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, c.text);
    }
  }
  const done = commitAndPush(
    root,
    plan.changes.map((c) => c.path),
    message,
  );
  process.stdout.write(
    done.pushed
      ? `\n  committed and pushed ${dir} (${done.sha})\n\n`
      : `\n  ${done.committed ? `committed ${done.sha}; push failed: ` : "not committed: "}${done.note}\n\n`,
  );
  return done.committed || done.note === "nothing to commit" ? 0 : 1;
}

/** The same org half `upgrade` renders callers with, so a routine edit is not drift to it. */
export function orgSpecOf(org: any, opsName: string): OrgSpec {
  return {
    org: org.org,
    name: org.name,
    opsRepo: `${org.org}/${opsName}`,
    opsDirName: opsName,
    human: "",
    humanMarker: "human",
    humanLogins: humanLogins(org),
    allowedTools: toolsOf(org),
  };
}

interface Flags {
  name?: string;
  at?: string;
  do?: string;
  doFile?: string;
  apply?: boolean;
  ops?: string;
  positional: string[];
}

function parseFlags(argv: string[]): Flags {
  const out: Flags = { positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--name") out.name = argv[++i];
    else if (a === "--at") out.at = argv[++i];
    else if (a === "--do") out.do = argv[++i];
    else if (a === "--do-file") out.doFile = argv[++i];
    else if (a === "--apply") out.apply = true;
    else if (a === "--ops") out.ops = argv[++i];
    else out.positional.push(a);
  }
  return out;
}
