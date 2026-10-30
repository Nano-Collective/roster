import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { api, ghJson } from "../lib/gh.js";
import { saveFile } from "../lib/prompt.js";
import { specFromManifest } from "../lib/render.js";
import { joinTenant, orgHasTenant, setupStatus } from "../lib/setup.js";
import { looksUnwritten } from "../lib/stub.js";
import { loadComposer, readOrg, tryWorkspace } from "../lib/workspace.js";
import { agentTokenEnv, insertUnder, type OrgYaml } from "./hire.js";

export const setupHelp = `
roster setup [--json] [--join <org>] [--add-repo <name>]

  Where setup has got to, and the one thing to do next. Every step is read from GitHub and
  from disk each time, so it can be run as often as you like and never disagrees with the
  world.

  This is what the SKILL.md install follows: an AI coding agent runs \`roster setup --json\`,
  does the next step, and runs it again. Each step says who it is for. "agent" steps are
  commands to run; "human" steps are a page to open or a command only you can run, and say
  exactly which.

  --json            the steps as JSON, for an agent
  --join <org>      check out an org that already runs roster, here
  --add-repo <name> add a repo in the org to org.yaml as a product the staff work on
  --dir <path>      where the workspace is, or would be (default: here)
`;

export type Who = "agent" | "human";

export interface Step {
  id: string;
  done: boolean;
  who: Who;
  title: string;
  /** What to do, in a sentence an agent can relay as it stands. */
  do: string;
  command?: string;
  /** The agent asks the person before it runs this, because it decides something or costs money. */
  confirm?: boolean;
}

export interface StaffFacts {
  handle: string;
  dir: string;
  charter: boolean;
  /** null when GitHub could not say. */
  app: boolean | null;
  ran: boolean | null;
}

export interface Facts {
  gh: { ok: boolean; login?: string; error?: string };
  /** Orgs this gh can see, and whether each already runs roster. Only read with no tenant here. */
  orgs: Array<{ login: string; tenant: boolean }>;
  tenant: null | {
    org: string;
    products: string[];
    business: boolean;
    priorities: boolean;
    staff: StaffFacts[];
    credential: boolean | null;
    tokenEnv: string;
  };
}

/**
 * The steps, in order, from what is true now. Pure, so the order is tested rather than hoped.
 *
 * Nothing after a step that is not done is offered as next: an agent following this does one
 * thing at a time, which is the only way the person can follow along.
 */
export function steps(f: Facts): Step[] {
  const out: Step[] = [];
  out.push({
    id: "gh",
    done: f.gh.ok,
    who: "human",
    title: f.gh.ok ? `GitHub CLI signed in as ${f.gh.login}` : "Sign in to the GitHub CLI",
    do: "Roster does everything through your own gh. Run this in your terminal and follow its prompts.",
    command: "gh auth login --scopes admin:org,workflow",
  });
  if (!f.gh.ok) return out;

  if (!f.tenant) {
    const running = f.orgs.filter((o) => o.tenant);
    if (running.length) {
      out.push({
        id: "join",
        done: false,
        who: "agent",
        title: `Check out ${running.map((o) => o.login).join(" or ")}, which already runs roster`,
        do: "Ask whether to join one of these or set up a new organisation. To join, check it out here. For a new one, run `roster init --org <org> --apply` instead.",
        command: `roster setup --join ${running[0]!.login}`,
        confirm: true,
      });
      return out;
    }
    if (!f.orgs.length) {
      out.push({
        id: "org",
        done: false,
        who: "human",
        title: "Create a GitHub organisation",
        do: "Your staff live in an organisation of their own. GitHub has no API for making one, so make it on this page (the free plan works), then say when it is done.",
        command: "https://github.com/account/organizations/new",
      });
      return out;
    }
    out.push({
      id: "init",
      done: false,
      who: "agent",
      title: "Set up roster in an organisation",
      do: `Ask which organisation to use (${f.orgs.map((o) => o.login).join(", ")}) and which coding agent the staff run on (claude-code-action, codex or nanocoder), then create it.`,
      command: "roster init --org <org> --agent <agent> --apply",
      confirm: true,
    });
    return out;
  }

  const t = f.tenant;
  out.push({ id: "init", done: true, who: "agent", title: `roster runs in ${t.org}`, do: "" });
  out.push({
    id: "products",
    done: t.products.length > 0,
    who: "agent",
    title: t.products.length
      ? `Staff work on ${t.products.join(", ")}`
      : "Choose the repos your staff work on",
    do: "List the org's repos with `gh repo list <org>`, ask which ones the staff should work on, and add each.",
    command: "roster setup --add-repo <name>",
    confirm: true,
  });
  out.push({
    id: "business",
    done: t.business,
    who: "agent",
    title: "Describe the business",
    do: "Print the brief and follow it: interview the person with its questions, in its words, use what you already know about their project, write org/business.md, show it to them, then commit and push the ops repo.",
    command: "roster brief discover",
  });
  out.push({
    id: "priorities",
    done: t.priorities,
    who: "agent",
    title: "Set this month's priorities",
    do: "Print the brief and follow it the same way, writing org/priorities.md.",
    command: "roster brief priorities",
  });
  out.push({
    id: "hire",
    done: t.staff.length > 0,
    who: "agent",
    title: t.staff.length
      ? `Hired ${t.staff.map((s) => s.handle).join(", ")}`
      : "Hire your first staff member",
    do: "Ask what role they need first (a CTO is the usual start). Show them the plan, then hire.",
    command: "roster hire <handle> --name <role name> --apply",
    confirm: true,
  });

  for (const s of t.staff) {
    out.push({
      id: `charter.${s.handle}`,
      done: s.charter,
      who: "agent",
      title: `Write ${s.handle}'s charter`,
      do: `Print the brief and follow it, writing ${s.dir}/CHARTER.md, then commit and push that repo.`,
      command: `roster brief charter ${s.handle}`,
    });
    out.push({
      id: `app.${s.handle}`,
      done: s.app === true,
      who: "agent",
      title: `Create and install ${s.handle}'s GitHub App`,
      do: "Run the command in the background. It prints a link: give it to the person to confirm on GitHub. Then it prints an install link with the right repos ticked: give them that too, and wait for it to finish.",
      command: `roster app ${s.handle} --no-open --apply`,
    });
  }

  out.push({
    id: "credential",
    done: t.credential === true,
    who: "human",
    title: "Store the coding agent's credential",
    do: `Staff run on your agent account, stored as the ${t.tokenEnv} secret. Never ask for it in chat. Ask the person to run these in their own terminal, then say when it is done.`,
    command:
      t.tokenEnv === "CLAUDE_CODE_OAUTH_TOKEN"
        ? "claude setup-token   # then: roster credential --apply, and paste it"
        : "roster credential --apply   # paste the key at the hidden prompt",
  });

  for (const s of t.staff) {
    out.push({
      id: `run.${s.handle}`,
      done: s.ran === true,
      who: "agent",
      title: `${s.handle}'s first run`,
      do: "A real run does a day's work and costs what one does, so ask before starting it. It is the only proof the App is installed and the secrets are right.",
      command: `roster run ${s.handle} --apply`,
      confirm: true,
    });
  }
  return out;
}

export async function setupCommand(argv: string[]): Promise<number> {
  const opts = parseFlags(argv);
  const dir = resolve(opts.dir ?? process.cwd());

  if (opts.join) {
    const cloned = await joinTenant(dir, opts.join);
    process.stdout.write(`  checked out ${cloned.length ? cloned.join(", ") : "nothing new"}\n`);
    return 0;
  }
  if (opts.addRepo) return addRepo(dir, opts.addRepo);

  const list = steps(await facts(dir));
  const next = list.find((s) => !s.done) ?? null;
  if (opts.json) {
    process.stdout.write(
      `${JSON.stringify({ ready: !next, next, steps: list, portal: "roster" }, null, 2)}\n`,
    );
    return 0;
  }

  process.stdout.write("\n");
  for (const s of list) process.stdout.write(`  ${s.done ? "✓" : "·"} ${s.title}\n`);
  if (!next) {
    process.stdout.write("\n  Setup is done. `roster` opens the portal.\n\n");
    return 0;
  }
  process.stdout.write(`\n  Next${next.who === "human" ? ", for you" : ""}: ${next.do}\n`);
  if (next.command) process.stdout.write(`    ${next.command}\n`);
  process.stdout.write("\n");
  return 0;
}

async function facts(dir: string): Promise<Facts> {
  const status = await setupStatus(dir);
  const gh = status.gh;
  const ws = tryWorkspace(dir);
  if (!gh.ok || !ws) {
    const orgs = gh.ok
      ? await Promise.all(
          status.orgs.slice(0, 30).map(async (login) => ({
            login,
            tenant: (await orgHasTenant(login)).exists,
          })),
        )
      : [];
    return { gh, orgs, tenant: null };
  }

  const { parseYaml } = await loadComposer(ws.opsDir);
  const org = readOrg(ws.opsDir, parseYaml) as OrgYaml & ReturnType<typeof readOrg>;
  const left = status.tenant.left ?? [];
  const tokenEnv = agentTokenEnv(org);

  const staff = await Promise.all(
    (org.staff ?? []).map(async (p): Promise<StaffFacts> => {
      const dirName = p.dir ?? p.handle;
      const root = join(ws.root, dirName);
      const charterPath = join(root, "CHARTER.md");
      const charter = existsSync(charterPath) && !looksUnwritten(readFileSync(charterPath, "utf8"));
      const manifestPath = join(root, "staff.yaml");
      const prefix = existsSync(manifestPath)
        ? specFromManifest(parseYaml(readFileSync(manifestPath, "utf8"), "staff.yaml"), dirName)
            .secretPrefix
        : p.handle.toUpperCase();
      const repo = `${org.org}/${dirName}`;
      const [secrets, runs] = await Promise.all([
        api<{ secrets: Array<{ name: string }> }>(`repos/${repo}/actions/secrets`),
        ghJson<unknown[]>([
          "run",
          "list",
          "--repo",
          repo,
          "--status",
          "success",
          "--limit",
          "1",
          "--json",
          "databaseId",
        ]),
      ]);
      return {
        handle: p.handle,
        dir: dirName,
        charter,
        app: secrets.ok ? secrets.data!.secrets.some((s) => s.name === `${prefix}_APP_ID`) : null,
        ran: runs.ok ? (runs.data ?? []).length > 0 : null,
      };
    }),
  );

  return {
    gh,
    orgs: [],
    tenant: {
      org: org.org,
      products: status.tenant.products ?? [],
      business: !left.includes("business"),
      priorities: !left.includes("priorities"),
      staff,
      credential: staff.length ? await hasCredential(org.org, staff[0]!.dir, tokenEnv) : null,
      tokenEnv,
    },
  };
}

/** On the brain itself, or an org secret shared with it: Actions reads `secrets.X` from either. */
async function hasCredential(org: string, dir: string, name: string): Promise<boolean | null> {
  const [own, shared] = await Promise.all([
    api<{ secrets: Array<{ name: string }> }>(`repos/${org}/${dir}/actions/secrets`),
    api<{ secrets: Array<{ name: string }> }>(`repos/${org}/${dir}/actions/organization-secrets`),
  ]);
  if (!own.ok && !shared.ok) return null;
  return [own, shared].some((r) => r.ok && r.data!.secrets.some((s) => s.name === name));
}

/** The same line the setup screen's repo picker writes, so the two cannot drift. */
async function addRepo(dir: string, name: string): Promise<number> {
  const ws = tryWorkspace(dir);
  if (!ws) {
    process.stderr.write("roster: no roster workspace here. `roster setup` says what is next.\n");
    return 2;
  }
  if (!/^[\w.-]+$/.test(name)) {
    process.stderr.write(`roster: "${name}" is not a repo name\n`);
    return 2;
  }
  const path = join(ws.opsDir, "org.yaml");
  const text = readFileSync(path, "utf8");
  if (new RegExp(`name: ${name}[,\\s}]`).test(text)) {
    process.stdout.write(`  ${name} is already in org.yaml\n`);
    return 0;
  }
  const { parseYaml } = await loadComposer(ws.opsDir);
  const org = readOrg(ws.opsDir, parseYaml).org;
  const info = await api<{ visibility: string }>(`repos/${org}/${name}`);
  if (!info.ok) {
    process.stderr.write(`roster: cannot see ${org}/${name}: ${info.error}\n`);
    return 1;
  }
  const visibility = String(info.data!.visibility ?? "private").toLowerCase();
  const line = `  - { name: ${name}, visibility: ${visibility}, role: product }`;
  const saved = saveFile(
    ws,
    `${ws.opsName}/org.yaml`,
    insertUnder(text, "repos", line),
    `setup: org.yaml lists ${name}`,
  );
  process.stdout.write(
    `  added ${name} as a product${saved.pushed ? ", committed and pushed" : `, committed; push failed: ${saved.note}`}\n`,
  );
  return 0;
}

interface Flags {
  json?: boolean;
  join?: string;
  addRepo?: string;
  dir?: string;
}

function parseFlags(argv: string[]): Flags {
  const out: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") out.json = true;
    else if (a === "--join") out.join = argv[++i];
    else if (a === "--add-repo") out.addRepo = argv[++i];
    else if (a === "--dir") out.dir = argv[++i];
  }
  return out;
}
