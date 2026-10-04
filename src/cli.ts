#!/usr/bin/env node
import { appCommand, appHelp } from "./commands/app.js";
import { briefCommand, briefHelp } from "./commands/brief.js";
import { credentialCommand, credentialHelp } from "./commands/credential.js";
import { doctorCommand, doctorHelp } from "./commands/doctor.js";
import { exportCommand, exportHelp } from "./commands/export.js";
import { fixCommand, fixHelp } from "./commands/fix.js";
import { hireCommand, hireHelp } from "./commands/hire.js";
import { initCommand, initHelp } from "./commands/init.js";
import { lintCommand, lintHelp } from "./commands/lint.js";
import { portalCommand, portalHelp } from "./commands/portal.js";
import { promptCommand, promptHelp } from "./commands/prompt.js";
import { retireCommand, retireHelp } from "./commands/retire.js";
import { runCommand, runHelp } from "./commands/run.js";
import { upgradeCommand, upgradeHelp } from "./commands/upgrade.js";
import { bin, rewriteOutput } from "./lib/bin.js";

const HELP = `
roster — an agent-run org, powered by GitHub

  roster                    open the portal. With no org here, it sets one up.
  roster init --org <org>   stand up a new tenant
  roster brief <kind>       a brief for authoring a charter, business.md or the voice
  roster prompt <handle>    compose the runtime prompt for a staff member
  roster lint [handle]      check memory against the grammar
  roster doctor [handle]    check the org is actually wired up
  roster fix                every finding, as one brief for your coding agent
  roster hire <handle>      scaffold a new staff member
  roster app <handle>       create their GitHub App and set its secrets
  roster credential         store the agent's credential, once for the org
  roster run <handle>       start one daily run now, and follow it to the end
  roster retire <handle>    stop a staff member, keeping their repo and their memory
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
  fix: fixCommand,
  hire: hireCommand,
  app: appCommand,
  credential: credentialCommand,
  run: runCommand,
  retire: retireCommand,
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
  fix: fixHelp,
  hire: hireHelp,
  app: appHelp,
  credential: credentialHelp,
  run: runHelp,
  retire: retireHelp,
  portal: portalHelp,
  export: exportHelp,
};

async function main(argv: string[]): Promise<number> {
  const raw = rewriteOutput();
  const [command, ...rest] = argv;

  /* No arguments opens the portal, which is the setup screen when there is no tenant here and
     the portal proper when there is. `npx @nanocollective/roster` is the whole first run, and
     a help page is a worse answer to it than the thing itself. */
  if (!command) return portalCommand([]);

  const asksHelp = command === "help" || command === "--help" || command === "-h";

  /* Flags with no command are the portal's, for the same reason: `roster --no-open` is the
     bare command with an option, not an unknown command called "--no-open". */
  if (command.startsWith("-") && !asksHelp) return portalCommand(argv);

  if (asksHelp) {
    const topic = rest[0];
    if (!topic || !HELPS[topic]) {
      const name = bin();
      if (name !== "roster") {
        raw(
          `\n  Run these as ${name} <command>, or install it: npm install -g @nanocollective/roster\n`,
        );
      }
      raw(HELP);
      return 0;
    }
    process.stdout.write(HELPS[topic]);
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
