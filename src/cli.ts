#!/usr/bin/env node
import { promptCommand, promptHelp } from "./commands/prompt.js";

const HELP = `
roster — an agent-run org, powered by GitHub

  roster prompt <handle>    compose the runtime prompt for a staff member
  roster help [command]

Not built yet: init, hire, doctor, lint, portal, export, upgrade.
`;

const COMMANDS: Record<string, (argv: string[]) => Promise<number>> = {
  prompt: promptCommand,
};

const HELPS: Record<string, string> = { prompt: promptHelp };

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
