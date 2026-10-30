import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { templatesRoot } from "../lib/templates.js";

export const skillHelp = `
roster skill install [--print]

  Save Roster's SKILL.md for every coding agent on this machine, so a future session knows how
  to set up and run Roster without being told. It is the same file served at
  https://roster.nanocollective.org/SKILL.md.

  It writes to each agent's user-level skills directory that exists: Claude Code
  (~/.claude/skills/roster) and Codex (~/.codex/skills/roster). Running it again replaces the
  file, which is how it is updated after a new version.

  --print   print the file instead
`;

/** Each agent's home, and where under it a user-level skill goes. */
const AGENT_HOMES = [
  { name: "Claude Code", home: ".claude", dir: join("skills", "roster") },
  { name: "Codex", home: ".codex", dir: join("skills", "roster") },
];

export function skillText(): string {
  return readFileSync(join(templatesRoot(), "skill", "SKILL.md"), "utf8");
}

export function installSkill(home = homedir(), text = skillText()): string[] {
  const done: string[] = [];
  for (const a of AGENT_HOMES) {
    if (!existsSync(join(home, a.home))) continue;
    const dir = join(home, a.home, a.dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), text);
    done.push(a.name);
  }
  return done;
}

export async function skillCommand(argv: string[]): Promise<number> {
  if (argv.includes("--print")) {
    process.stdout.write(skillText());
    return 0;
  }
  if (argv[0] !== "install") {
    process.stderr.write(skillHelp);
    return 2;
  }
  const done = installSkill();
  process.stdout.write(
    done.length
      ? `  saved the Roster skill for ${done.join(" and ")}\n`
      : "  no coding agent found (looked for ~/.claude and ~/.codex). `roster skill --print` prints the file.\n",
  );
  return 0;
}
