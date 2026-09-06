#!/usr/bin/env node
import { promptCommand, promptHelp } from "./commands/prompt.js";
import { lintCommand, lintHelp } from "./commands/lint.js";
import { portalCommand, portalHelp } from "./commands/portal.js";
import { exportCommand, exportHelp } from "./commands/export.js";
import { upgradeCommand, upgradeHelp } from "./commands/upgrade.js";
import { doctorCommand, doctorHelp } from "./commands/doctor.js";

const HELP = `
roster — an agent-run org, powered by GitHub

  roster prompt <handle>    compose the runtime prompt for a staff member
  roster lint [handle]      check memory against the grammar
  roster doctor [handle]    check the org is actually wired up
  roster upgrade            carry framework changes into this tenant
  roster portal             browse every brain, locally
  roster export             the whole org as one JSON
  roster help [command]

Not built yet: init, hire.
`;

const COMMANDS: Record<string, (argv: string[]) => Promise<number>> = {
  prompt: promptCommand,
  lint: lintCommand,
  upgrade: upgradeCommand,
  doctor: doctorCommand,
  portal: portalCommand,
  export: exportCommand,
};

const HELPS: Record<string, string> = {
  prompt: promptHelp, lint: lintHelp, upgrade: upgradeHelp, doctor: doctorHelp,
  portal: portalHelp, export: exportHelp,
};

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    const topic = rest[0];
    process.stdout.write(topic && HELPS[topic] ? HELPS[topic] : HELP);
    return 0;
  }

  const run = COMMANDS[command];
  if (!run) {
    process.stderr.write(`roster: unknown command "${command}"\n${HELP}`);
    return 2;
  }
  return run(rest);
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    process.stderr.write(`roster: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
