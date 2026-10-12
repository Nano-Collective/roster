import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { commitAndPush } from "../lib/commit.js";
import { findWorkspace, loadComposer, readOrg } from "../lib/workspace.js";
import { readSecret } from "./credential.js";

export const deployHelp = `
roster portal deploy [--domain <host>] [--apply]

  Put this org's portal on the web, on Cloudflare Workers, behind Sign in with GitHub.

  It is the same portal \`roster portal\` serves on your machine, reading the org from GitHub.
  Only the people in org.yaml's humans: can sign in, and each acts as themselves. Setting up,
  hiring and doctor stay on your machine.

  The first time, it walks you through the one thing only you can do: creating a GitHub OAuth
  App for the portal, a form with three fields. Then it writes portal/wrangler.jsonc and a
  workflow into the ops repo, stores the App's secret and a session key on the Worker, and
  deploys. After that the workflow redeploys every morning, so roster updates arrive by
  themselves; it needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID as ops repo secrets.

  Needs a Cloudflare account, and wrangler signed in (\`npx wrangler login\`) or
  CLOUDFLARE_API_TOKEN set. Nothing happens without --apply.

  --domain <host>  where it lives, e.g. roster.example.com, on a zone in your Cloudflare account
  --account <id>   the Cloudflare account that zone is on, pinned so a deploy never lands on
                   another account the login happens to see
  --apply          do it
  --ci             no questions: deploy what portal/wrangler.jsonc already says (the workflow)
  --ops <dir>      ops repo directory (default: found by walking up)
`;

const CONFIG = "portal/wrangler.jsonc";
const WORKFLOW = ".github/workflows/portal.yaml";
const WRANGLER = "wrangler@4";

interface Flags {
  domain?: string;
  account?: string;
  apply?: boolean;
  ci?: boolean;
  ops?: string;
}

export async function deployCommand(argv: string[]): Promise<number> {
  const opts = parseFlags(argv);
  const ws = findWorkspace(opts.ops);
  const { parseYaml } = await loadComposer(ws.opsDir);
  const org = readOrg(ws.opsDir, parseYaml);
  const configPath = join(ws.opsDir, CONFIG);
  const exists = existsSync(configPath);

  let config: WorkerConfig;
  if (exists) {
    config = parseJsonc(readFileSync(configPath, "utf8")) as WorkerConfig;
    if (opts.domain && opts.domain !== domainOf(config)) {
      config.routes = [{ pattern: opts.domain, custom_domain: true }];
    }
  } else {
    if (!opts.domain) {
      process.stderr.write(
        "roster: the first deploy needs --domain, e.g. --domain roster.example.com\n",
      );
      return 2;
    }
    config = newConfig(org.org, ws.opsName, opts.domain);
  }
  if (opts.account) config.account_id = opts.account;
  // Added to configs written before it existed, so the sign-in page says "Pip", not "playpip".
  if (!config.vars.ROSTER_NAME) config.vars.ROSTER_NAME = String(org.name ?? org.org);
  const domain = domainOf(config);

  process.stdout.write(
    `\n  roster portal deploy — ${org.name ?? org.org}\n\n` +
      `    serves      https://${domain}, on the Worker "${config.name}"\n` +
      (config.account_id ? `    account     ${config.account_id}\n` : "") +
      `    signs in    the humans in org.yaml, with GitHub\n` +
      (exists ? "" : `    writes      ${ws.opsName}/${CONFIG} and ${ws.opsName}/${WORKFLOW}\n`) +
      (config.vars.GITHUB_CLIENT_ID
        ? ""
        : "    asks for    the portal's GitHub OAuth App (a three-field form)\n") +
      `    deploys     with ${WRANGLER}, as whoever wrangler is signed in as\n\n`,
  );
  if (!opts.apply) {
    process.stdout.write("  Nothing was deployed. Re-run with --apply.\n\n");
    return 0;
  }

  const bundle = workerBundle();
  if (!bundle) {
    process.stderr.write("roster: this copy of roster has no portal Worker. Run `pnpm build`.\n");
    return 1;
  }

  const secrets: Record<string, string> = {};
  if (!config.vars.GITHUB_CLIENT_ID) {
    if (opts.ci) {
      process.stderr.write(
        `roster: ${CONFIG} has no GITHUB_CLIENT_ID. Deploy once by hand first.\n`,
      );
      return 1;
    }
    const app = await oauthApp(org.org, domain);
    if (!app) return 1;
    config.vars.GITHUB_CLIENT_ID = app.id;
    secrets.GITHUB_CLIENT_SECRET = app.secret;
    secrets.SESSION_KEY = randomBytes(32).toString("base64");
  }

  /* The tenant's config plus where this copy of roster keeps the Worker, in a file of its own:
     the paths are this machine's, and do not belong in a committed config. */
  const tmp = mkdtempSync(join(tmpdir(), "roster-deploy-"));
  try {
    const full = {
      ...config,
      main: bundle.main,
      assets: { ...config.assets, directory: bundle.assets },
    };
    writeFileSync(join(tmp, "wrangler.json"), JSON.stringify(full, null, 2));

    process.stdout.write("  deploying…\n");
    if ((await wrangler(["deploy", "--config", join(tmp, "wrangler.json")])) !== 0) {
      process.stderr.write("roster: wrangler could not deploy. Its own message is above.\n");
      return 1;
    }
    if (Object.keys(secrets).length) {
      const file = join(tmp, "secrets.json");
      writeFileSync(file, JSON.stringify(secrets), { mode: 0o600 });
      process.stdout.write("  storing the App's secret and a session key on the Worker…\n");
      if (
        (await wrangler(["secret", "bulk", file, "--config", join(tmp, "wrangler.json")])) !== 0
      ) {
        process.stderr.write("roster: the secrets were not stored. Run this again.\n");
        return 1;
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  if (!opts.ci) {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, renderConfig(config));
    const workflow = join(ws.opsDir, WORKFLOW);
    if (!existsSync(workflow)) {
      mkdirSync(dirname(workflow), { recursive: true });
      writeFileSync(workflow, WORKFLOW_TEXT);
    }
    const done = commitAndPush(ws.opsDir, [CONFIG, WORKFLOW], "roster: the hosted portal");
    if (done.note && !done.committed) process.stdout.write(`  ${done.note}\n`);
    else if (!done.pushed) process.stdout.write(`  committed, not pushed: ${done.note}\n`);
  }

  process.stdout.write(
    `\n  Live at https://${domain}. It can take a minute for the certificate.\n` +
      (opts.ci
        ? "\n"
        : `\n  To redeploy by itself every morning, add two secrets to ${org.org}/${ws.opsName}:\n` +
          '    CLOUDFLARE_API_TOKEN   a token with the "Edit Cloudflare Workers" template\n' +
          "    CLOUDFLARE_ACCOUNT_ID  from the Workers page of the dashboard\n\n"),
  );
  return 0;
}

/** The first time: the OAuth App only a person can create, and its two values. */
async function oauthApp(
  org: string,
  domain: string,
): Promise<{ id: string; secret: string } | null> {
  process.stdout.write(
    "\n  The portal signs people in with a GitHub OAuth App, which only you can create.\n" +
      `  Open https://github.com/organizations/${org}/settings/applications/new and fill in:\n\n` +
      `    Application name           ${org} roster\n` +
      `    Homepage URL               https://${domain}\n` +
      `    Authorization callback URL https://${domain}/auth/callback\n\n` +
      "  Register it, then press Generate a new client secret.\n\n",
  );
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const id = (await rl.question("  Client ID: ")).trim();
  rl.close();
  const secret = await readSecret("  Client secret (it is not shown): ");
  if (!id || !secret) {
    process.stderr.write("roster: both are needed. Nothing was deployed.\n");
    return null;
  }
  return { id, secret };
}

interface WorkerConfig {
  name: string;
  compatibility_date: string;
  compatibility_flags: string[];
  routes: Array<{ pattern: string; custom_domain: boolean }>;
  vars: Record<string, string>;
  assets: { binding: string; run_worker_first: boolean };
  [k: string]: unknown;
}

function newConfig(org: string, opsName: string, domain: string): WorkerConfig {
  return {
    name: `${org.toLowerCase().replace(/[^a-z0-9-]/g, "-")}-roster-portal`,
    compatibility_date: "2026-10-01",
    compatibility_flags: ["nodejs_compat"],
    routes: [{ pattern: domain, custom_domain: true }],
    vars: { ROSTER_ORG: org, ROSTER_OPS_REPO: opsName, GITHUB_CLIENT_ID: "" },
    assets: { binding: "ASSETS", run_worker_first: true },
  };
}

function domainOf(config: WorkerConfig): string {
  return config.routes?.[0]?.pattern ?? "";
}

function renderConfig(config: WorkerConfig): string {
  return (
    "// The hosted portal, deployed by `roster portal deploy` and by .github/workflows/portal.yaml.\n" +
    "// The client ID is public; the App's secret and the session key are Worker secrets.\n" +
    `${JSON.stringify(config, null, 2)}\n`
  );
}

/** JSON with // comments, which is what wrangler's own configs are. */
function parseJsonc(text: string): unknown {
  return JSON.parse(text.replace(/^\s*\/\/.*$/gm, ""));
}

/** The built Worker inside this copy of roster: dist/worker beside dist/cli.js. */
function workerBundle(): { main: string; assets: string } | null {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const dist of [here, join(here, "..", "..", "dist")]) {
    const main = join(dist, "worker", "index.js");
    if (existsSync(main)) return { main, assets: join(dist, "worker", "assets") };
  }
  return null;
}

function wrangler(args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("npx", ["--yes", WRANGLER, ...args], { stdio: "inherit" });
    child.on("close", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

const WORKFLOW_TEXT = `# Redeploys the hosted portal: when its config changes, every morning so roster updates
# arrive by themselves, and by hand. Written by \`roster portal deploy\`.
#
# Needs two repository secrets: CLOUDFLARE_API_TOKEN (the "Edit Cloudflare Workers" template)
# and CLOUDFLARE_ACCOUNT_ID.
name: portal

on:
  push:
    branches: [main]
    paths: ["portal/**", ".github/workflows/portal.yaml"]
  schedule:
    - cron: "17 5 * * *"
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: portal
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    env:
      CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: \${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
    steps:
      # Without the secrets there is nothing to deploy with. That is a choice, not a failure:
      # the portal that is up stays up, and only stops updating itself.
      - name: Check for the Cloudflare secrets
        id: ready
        run: |
          if [ -z "$CLOUDFLARE_API_TOKEN" ] || [ -z "$CLOUDFLARE_ACCOUNT_ID" ]; then
            echo "::notice::Not deploying: add CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID to this repo's secrets."
            echo "go=false" >> "$GITHUB_OUTPUT"
          else
            echo "go=true" >> "$GITHUB_OUTPUT"
          fi
      - if: steps.ready.outputs.go == 'true'
        uses: actions/checkout@v4
      - if: steps.ready.outputs.go == 'true'
        uses: actions/setup-node@v4
        with:
          node-version: 22
      - if: steps.ready.outputs.go == 'true'
        run: npx --yes @nanocollective/roster@latest portal deploy --ci --apply
`;

function parseFlags(argv: string[]): Flags {
  const out: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--apply") out.apply = true;
    else if (flag === "--ci") out.ci = true;
    else if (flag === "--domain") out.domain = argv[++i];
    else if (flag === "--account") out.account = argv[++i];
    else if (flag === "--ops") out.ops = argv[++i];
    else throw new Error(`unknown flag ${flag}`);
  }
  return out;
}
