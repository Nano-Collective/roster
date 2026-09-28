import { planCredential, writeCredential } from "../lib/credential.js";
import { ghReady } from "../lib/gh.js";
import { AGENTS } from "../lib/setup.js";
import { findWorkspace, loadComposer, readOrg } from "../lib/workspace.js";
import { agentTokenEnv, type OrgYaml } from "./hire.js";

export const credentialHelp = `
roster credential [--repo-secrets] [--apply]

  Store your coding agent's credential where every staff member's run can read it, once.

  By default that is one organisation secret shared with each brain repo, and \`roster hire\`
  adds each new brain to it, so hiring never asks for the credential again. Where an org
  secret would not arrive it uses a secret on each brain instead, and the plan says why: on
  GitHub Free an org secret does not reach a private repo, and only an org owner can set one.

  The value is read from standard input, or typed at a hidden prompt, and handed to gh on its
  standard input. It never appears on a command line and is never written to disk.

    claude setup-token                  Claude Code: prints a long-lived token to paste
    roster credential --apply

  Nothing happens without --apply. On its own this prints the plan: the secret's name, where
  it would go, and why.

  --repo-secrets   a secret on each brain repo, even where an org secret would work
  --apply          read the credential and store it
  --ops <dir>      ops repo directory (default: found by walking up)
`;

export async function credentialCommand(argv: string[]): Promise<number> {
  const opts = parseFlags(argv);
  const ws = findWorkspace(opts.ops);
  const { parseYaml } = await loadComposer(ws.opsDir);
  const org = readOrg(ws.opsDir, parseYaml) as OrgYaml;

  const ready = await ghReady();
  if (!ready.ok) {
    process.stderr.write(`roster: ${ready.error}\n`);
    return 1;
  }

  const name = agentTokenEnv(org);
  const brains = (org.staff ?? []).map((s) => `${org.org}/${s.dir ?? s.handle}`);
  const plan = await planCredential(org.org, name, brains, { repoSecrets: opts.repoSecrets });

  process.stdout.write(`\n  roster credential — ${name}\n\n`);
  if (!brains.length) {
    process.stdout.write(
      `  There are no staff yet, so nothing would read it. Hire someone first:\n` +
        `    roster hire <handle> --apply\n\n`,
    );
    return opts.apply ? 1 : 0;
  }
  process.stdout.write(
    plan.mode === "org"
      ? `    + org secret ${name} in ${org.org}, shared with:\n`
      : `    + repo secret ${name} on each of:\n`,
  );
  for (const b of brains) process.stdout.write(`        ${b}\n`);
  process.stdout.write(`    because ${plan.reason}\n`);
  if (plan.mode === "org") {
    process.stdout.write(
      `    If GitHub refuses the org secret, it goes on each repo instead and says why.\n`,
    );
  }
  process.stdout.write(`\n  Where to get one: ${howTo(org)}\n\n`);

  if (!opts.apply) {
    process.stdout.write("  Nothing was stored. Re-run with --apply.\n\n");
    return 0;
  }

  const value = await readSecret(`  Paste the credential (it is not shown): `);
  try {
    const done = await writeCredential(plan, value);
    if (done.fellBack) process.stdout.write(`  the org secret was refused: ${done.fellBack}\n`);
    process.stdout.write(
      done.mode === "org"
        ? `  stored ${name} once for ${org.org}, shared with ${done.repos.length} brains\n\n`
        : `  stored ${name} on ${done.repos.join(", ")}\n\n`,
    );
    return 0;
  } catch (err) {
    process.stderr.write(`roster: ${(err as Error).message}\n`);
    return 1;
  }
}

/** The line setup shows beside the paste box, so the terminal and the page say the same. */
function howTo(org: OrgYaml): string {
  const asked = (org as any).agent;
  const id = typeof asked === "string" ? asked : (asked?.id ?? "claude-code-action");
  return (
    AGENTS.find((a) => a.id === id)?.howTo ??
    "whatever your agent's provider issues; see docs/agents.md"
  );
}

/**
 * Standard input when it is piped, a prompt that does not echo when it is a terminal.
 *
 * Echoing a token to the screen puts it in scrollback and in anything recording the session,
 * which is most of what keeping it off argv was for.
 */
function readSecret(prompt: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    return new Promise((resolve, reject) => {
      let buf = "";
      stdin.setEncoding("utf8");
      stdin.on("data", (c) => {
        buf += c;
      });
      stdin.on("end", () => resolve(buf.trim()));
      stdin.on("error", reject);
    });
  }
  process.stdout.write(prompt);
  return new Promise((resolve, reject) => {
    let buf = "";
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    const done = (err?: Error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off("data", onData);
      process.stdout.write("\n");
      if (err) reject(err);
      else resolve(buf.trim());
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return done();
        if (ch === "\u0003") return done(new Error("cancelled"));
        if (ch === "\u007f" || ch === "\b") buf = buf.slice(0, -1);
        else buf += ch;
      }
    };
    stdin.on("data", onData);
  });
}

interface Flags {
  ops?: string;
  repoSecrets?: boolean;
  apply?: boolean;
}

function parseFlags(argv: string[]): Flags {
  const out: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--apply") out.apply = true;
    else if (flag === "--repo-secrets") out.repoSecrets = true;
    else if (flag === "--ops") {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${flag} needs a value`);
      out.ops = value;
    } else throw new Error(`unknown flag ${flag}`);
  }
  return out;
}
