#!/usr/bin/env node
import { appCommand, appHelp } from "./commands/app.js";
import { briefCommand, briefHelp } from "./commands/brief.js";
import { doctorCommand, doctorHelp } from "./commands/doctor.js";
import { exportCommand, exportHelp } from "./commands/export.js";
import { hireCommand, hireHelp } from "./commands/hire.js";
import { initCommand, initHelp } from "./commands/init.js";
import { lintCommand, lintHelp } from "./commands/lint.js";
import { portalCommand, portalHelp } from "./commands/portal.js";
import { promptCommand, promptHelp } from "./commands/prompt.js";
import { upgradeCommand, upgradeHelp } from "./commands/upgrade.js";

const HELP = `
roster — an agent-run org, powered by GitHub

  roster init --org <org>   stand up a new tenant
  roster brief <kind>       a brief for authoring a charter, business.md or the voice
  roster prompt <handle>    compose the runtime prompt for a staff member
  roster lint [handle]      check memory against the grammar
  roster doctor [handle]    check the org is actually wired up
  roster hire <handle>      scaffold a new staff member
  roster app <handle>       create their GitHub App and set its secrets
  roster upgrade            carry framework changes into this tenant
  roster portal             browse every brain, locally
  roster export             the whole org as one JSON
  roster help [command]

`;

const COMMANDS: Record<string, (argv: string[]) => Promise<number>> = {
  init: initCommand,
  brief: briefCommand,
  prompt: promptCommand,
  lint: lintCommand,
  upgrade: upgradeCommand,
  doctor: doctorCommand,
  hire: hireCommand,
  app: appCommand,
  portal: portalCommand,
  export: exportCommand,
};

const HELPS: Record<string, string> = {
  init: initHelp,
  brief: briefHelp,
  prompt: promptHelp,
  lint: lintHelp,
  upgrade: upgradeHelp,
  doctor: doctorHelp,
  hire: hireHelp,
  app: appHelp,
  portal: portalHelp,
  export: exportHelp,
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
