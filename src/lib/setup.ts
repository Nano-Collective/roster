import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ghJson, ghReady } from "./gh.js";
import { looksUnwritten } from "./stub.js";
import { templatesRoot } from "./templates.js";
import { tryWorkspace } from "./workspace.js";

/**
 * What the setup screen needs to know before it can ask you anything.
 *
 * Every field is read fresh. Setup cannot be finished in one sitting — creating a GitHub App,
 * granting it, and getting a first green run are all things that happen elsewhere and later —
 * so the page derives its state from the world rather than storing a step counter that would
 * disagree with it.
 */
export interface SetupStatus {
  /** Is there already a tenant where the portal was started. */
  tenant: {
    found: boolean;
    root?: string;
    opsDir?: string;
    org?: string;
    repos?: string[];
    /** What is still to do, so a step can say it is done without anybody pressing anything. */
    left?: Unfinished[];
  };
  gh: { ok: boolean; login?: string; error?: string };
  /** Organisations this `gh` can see, best effort. Empty is not an error. */
  orgs: string[];
  /** Where the portal was started, which is where a tenant would be created or checked out. */
  startedIn: string;
  agents: AgentPreset[];
}

export interface AgentPreset {
  id: string;
  label: string;
  /** The repo secret its credential goes in. Named here so setup can name it exactly. */
  tokenEnv: string;
  /** Where the credential comes from, in one line. docs/agents.md has the longer answer. */
  howTo: string;
}

/**
 * The runners that ship with a preset. A runner is three shell-level facts, so anything else
 * works by writing `install`, `run` and `token_env` into org.yaml by hand — which is a thing to
 * say on the page rather than a reason to make this list open-ended.
 */
export const AGENTS: AgentPreset[] = [
  {
    id: "claude-code-action",
    label: "Claude Code (GitHub Action)",
    tokenEnv: "CLAUDE_CODE_OAUTH_TOKEN",
    howTo:
      "run `claude setup-token` where Claude Code is signed in, and paste the long-lived token it prints. An Anthropic API key also works.",
  },
  {
    id: "claude",
    label: "Claude Code (CLI)",
    tokenEnv: "CLAUDE_CODE_OAUTH_TOKEN",
    howTo:
      "run `claude setup-token` where Claude Code is signed in, and paste the long-lived token it prints. An Anthropic API key also works.",
  },
  {
    id: "codex",
    label: "Codex",
    tokenEnv: "CODEX_API_KEY",
    howTo:
      "an API key from the OpenAI platform console. `codex login` is for interactive use and gives nothing a runner can hold.",
  },
  {
    id: "nanocoder",
    label: "Nanocoder",
    tokenEnv: "NANOCODER_API_KEY",
    howTo:
      "the API key of the provider named in agents.config.json. Nanocoder is a client, so the key is the provider's.",
  },
];

/**
 * Does this organisation already run roster.
 *
 * The difference between setting up a new org and joining one that exists is the whole
 * question a second person on a team asks, and getting it wrong means a second `roster-ops`
 * in an org that already had one. Cheap to ask, so it is asked before anything is offered.
 */
export async function orgHasTenant(org: string): Promise<{ exists: boolean; cloneUrl?: string }> {
  const found = await ghJson<{ name: string }>([
    "api",
    `repos/${org}/roster-ops`,
    "--jq",
    "{name: .name}",
  ]);
  return found.ok
    ? { exists: true, cloneUrl: `https://github.com/${org}/roster-ops.git` }
    : { exists: false };
}

export async function setupStatus(startedIn: string): Promise<SetupStatus> {
  const found = tryWorkspace(startedIn);
  const ready = await ghReady();

  let orgs: string[] = [];
  if (ready.ok) {
    /* Best effort on purpose. Someone whose token lacks `read:org` still has a usable setup —
       they type the name instead — and a hard failure here would stop them at step one. */
    const list = await ghJson<Array<{ login: string }>>([
      "api",
      "user/orgs?per_page=100",
      "--jq",
      "[.[] | {login}]",
    ]);
    if (list.ok) orgs = (list.data ?? []).map((o) => o.login).sort();
  }

  return {
    tenant: found
      ? {
          found: true,
          root: found.root,
          opsDir: found.opsDir,
          org: readOrgName(found.opsDir),
          repos: readBlockNames(found.opsDir, "repos", "name"),
          left: unfinished(found.opsDir, readBlockNames(found.opsDir, "staff", "handle").length),
        }
      : { found: false },
    gh: ready.ok
      ? { ok: true, login: ready.data?.login }
      : { ok: false, error: ready.error ?? "gh is not ready" },
    orgs,
    agents: AGENTS,
    startedIn,
  };
}

/**
 * The org's name without parsing it properly.
 *
 * Setup runs before a tenant exists, so the composer it would normally borrow may be the
 * framework's rather than this tenant's. One line of regex beats loading a second parser to
 * answer a question this small.
 */
function readOrgName(opsDir: string): string | undefined {
  const path = join(opsDir, "org.yaml");
  if (!existsSync(path)) return undefined;
  const m = /^org:\s*(\S+)\s*$/m.exec(readFileSync(path, "utf8"));
  return m?.[1];
}

/**
 * The repos org.yaml already lists, so the picker does not offer one that is there, and the
 * staff it names, so setup knows whether anybody has been hired.
 *
 * Read with a regex for the same reason the org name is: setup may be running on the
 * framework's composer rather than the tenant's, and this question is too small to load a
 * second parser for.
 */
function readBlockNames(opsDir: string, block: "repos" | "staff", key: string): string[] {
  const path = join(opsDir, "org.yaml");
  if (!existsSync(path)) return [];
  /* Walked line by line rather than matched, and scoped to the block `repos:` introduces. A
     staff entry opens with `handle:` today, so a looser pattern happens to work and would stop
     working the day somebody reorders the keys. */
  const names: string[] = [];
  const pattern = new RegExp(`\\b${key}:\\s*([\\w.-]+)`);
  let inside = false;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (new RegExp(`^${block}:\\s*$`).test(line)) {
      inside = true;
      continue;
    }
    if (inside && /^\S/.test(line)) break;
    if (!inside) continue;
    const m = pattern.exec(line);
    if (m) names.push(m[1]!);
  }
  return names;
}

/** A setup step that is only done when the world says so. */
export type Unfinished = "hire" | "business" | "priorities";

/**
 * What is still left once a tenant exists, off disk and cheap enough to ask on every page load.
 *
 * The setup screen used to be reachable only before there was a tenant, so reloading after
 * creating one landed on an empty Inbox with the rest of setup gone. This is what decides
 * whether the portal still offers it. Only the steps that can be read locally are here: the
 * Actions access and the credential need GitHub, and the Getting started screen asks for those
 * itself rather than slowing every load down.
 */
export function unfinished(opsDir: string, staffCount: number): Unfinished[] {
  const out: Unfinished[] = [];
  if (!staffCount) out.push("hire");
  for (const [id, rel] of [
    ["business", "org/business.md"],
    ["priorities", "org/priorities.md"],
  ] as const) {
    const path = join(opsDir, rel);
    if (!existsSync(path) || looksUnwritten(readFileSync(path, "utf8"))) out.push(id);
  }
  return out;
}

/** The framework's own composer, used only in the minutes before a tenant vendors its copy. */
export async function loadFrameworkComposer() {
  const path = join(templatesRoot(), "ops", "compose.mjs");
  return (await import(`file://${path}`)) as {
    compose(o: { opsDir: string; brainsDir: string; staff: string; kind: string }): string;
    parseYaml(text: string, file?: string): Record<string, unknown>;
  };
}

/**
 * Check out an org that already runs roster.
 *
 * The workspace layout — ops repo and every brain side by side — is what the CI runner
 * checks out, so a local copy in the same shape is the only one where the portal shows what
 * actually runs. Cloning one repo and leaving the brains to the person is how you end up
 * looking at a portal that reports half its staff as missing.
 */
export async function joinTenant(root: string, org: string): Promise<string[]> {
  mkdirSync(root, { recursive: true });
  const cloned: string[] = [];

  const opsDir = join(root, "roster-ops");
  if (!existsSync(opsDir)) {
    await clone(`https://github.com/${org}/roster-ops.git`, opsDir);
    cloned.push("roster-ops");
  }
  if (!existsSync(join(opsDir, "org.yaml"))) {
    throw new Error(`${org}/roster-ops has no org.yaml, so it is not a roster tenant`);
  }

  /* Read with the tenant's own composer: it is on disk now, and it is the parser its own
     workflows use. The regex readers above exist for the moments before this is true. */
  const { parseYaml } = await import(`file://${join(opsDir, "compose.mjs")}`).then(
    (m) => m as { parseYaml: (t: string, f?: string) => Record<string, unknown> },
  );
  const orgFile = parseYaml(readFileSync(join(opsDir, "org.yaml"), "utf8"), "org.yaml") as {
    staff?: Array<{ handle: string; dir?: string }>;
  };

  for (const person of orgFile.staff ?? []) {
    const dir = person.dir ?? person.handle;
    if (existsSync(join(root, dir))) continue;
    try {
      await clone(`https://github.com/${org}/${dir}.git`, join(root, dir));
      cloned.push(dir);
    } catch {
      /* A brain you cannot see is a permissions answer, not a failure of the join: the rest of
         the org is still worth having, and `doctor` reports the missing checkout by name. */
    }
  }
  return cloned;
}

function clone(url: string, into: string): Promise<void> {
  return new Promise((ok, fail) => {
    execFile("git", ["clone", "-q", url, into], (err) => (err ? fail(err) : ok()));
  });
}
