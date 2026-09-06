import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findWorkspace, loadComposer, readOrg } from "../lib/workspace.js";
import { specFromManifest } from "../lib/render.js";
import { createApp, setSecret, type AppSpec } from "../lib/appmanifest.js";
import { api, ghReady } from "../lib/gh.js";

export const appHelp = `
roster app <handle> [--public] [--port 4310] [--no-open]

  Create the GitHub App a staff member runs as, and put its credentials into their repo.

  This is the step \`hire\` has always had to hand back to you. There is no API that creates an
  App: you POST a manifest to a settings page in a browser, a human confirms, and GitHub hands
  back a one-time code. So this serves the hand-off on localhost, opens it, catches the
  redirect, exchanges the code, and writes the id and the private key straight into the brain
  repo's secrets — the key is held in memory and never touches disk.

  What it still cannot do is install the App. Installing grants access to specific repos and
  GitHub asks a human to choose them; the URL is printed and \`roster doctor\` tells you whether
  the grant actually took, which is the only reliable way to know.

  <handle>      a staff member in org.yaml
  --public      create the shared public identity instead of this staff member's own
  --port <n>    the localhost port the hand-off listens on (default 4310)
  --no-open     print the URL rather than opening a browser
`;

export async function appCommand(argv: string[]): Promise<number> {
  const handle = argv[0];
  if (!handle || handle.startsWith("-")) {
    process.stderr.write("roster: app needs a staff handle, e.g. `roster app cfo`\n");
    return 2;
  }
  const opts = parseFlags(argv.slice(1));

  const ready = await ghReady();
  if (!ready.ok) {
    process.stderr.write(`roster: ${ready.error}\n`);
    return 1;
  }

  const ws = findWorkspace(opts.ops);
  const { parseYaml } = await loadComposer(ws.opsDir);
  const org = readOrg(ws.opsDir, parseYaml) as any;

  const entry = (org.staff ?? []).find((s: any) => s.handle === handle);
  if (!entry) {
    process.stderr.write(`roster: no staff member "${handle}" in org.yaml\n`);
    return 2;
  }
  const dir = entry.dir ?? entry.handle;
  const manifestPath = join(ws.root, dir, "staff.yaml");
  if (!existsSync(manifestPath)) {
    process.stderr.write(`roster: ${dir}/staff.yaml is missing. Run \`roster hire ${handle}\` first.\n`);
    return 2;
  }
  const spec = specFromManifest(parseYaml(readFileSync(manifestPath, "utf8"), "staff.yaml") as any, dir);

  const scope = opts.public ? "public" : "private";
  const name = opts.public ? spec.publicApp : spec.app;
  const prefix = opts.public ? spec.publicSecretPrefix : spec.secretPrefix;
  if (!name) {
    process.stderr.write(`roster: staff.yaml declares no ${scope} app for ${handle}\n`);
    return 2;
  }

  // An App name is unique across GitHub, so a clash is the common failure and worth catching
  // before a browser is opened rather than after a form is submitted.
  const existing = await api<{ slug: string }>(`/apps/${name}`);
  if (existing.ok) {
    process.stderr.write(
      `roster: an App called "${name}" already exists.\n` +
      `  If it is yours, it only needs installing and its secrets setting:\n` +
      `    https://github.com/organizations/${org.org}/settings/apps/${name}/installations\n`,
    );
    return 1;
  }

  const appSpec: AppSpec = {
    name,
    org: org.org,
    scope,
    description: opts.public
      ? `Shared public identity for ${org.name}'s staff, managed by roster.`
      : `${spec.name} at ${org.name}. An agent-run staff member, managed by roster.`,
  };

  let created;
  try {
    created = await createApp(appSpec, { port: opts.port, noOpen: opts.noOpen });
  } catch (err) {
    process.stderr.write(`roster: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  process.stdout.write(`  created ${created.slug} (app id ${created.id})\n`);

  try {
    await setSecret(spec.brain, `${prefix}_APP_ID`, String(created.id));
    await setSecret(spec.brain, `${prefix}_APP_PRIVATE_KEY`, created.pem);
  } catch (err) {
    process.stderr.write(
      `roster: the App was created but its secrets were not written: ` +
      `${err instanceof Error ? err.message : String(err)}\n` +
      `  The private key is not recoverable from here. Generate a new one at\n` +
      `  ${created.html_url} and set ${prefix}_APP_PRIVATE_KEY on ${spec.brain} by hand.\n`,
    );
    return 1;
  }
  process.stdout.write(`  wrote ${prefix}_APP_ID and ${prefix}_APP_PRIVATE_KEY to ${spec.brain}\n`);

  /* Installing is a human choice about which repos to grant, so it cannot be done from here.
     Every tracker this staff member writes to has to be included, not just their own — the
     token is minted org-wide and a peer's board is where its briefs land. */
  const targets = [spec.brain, ...spec.worksIn, ...peerBrains(ws, org, parseYaml, handle)];
  process.stdout.write(
    `\n  Now install it. GitHub asks a human which repos to grant:\n` +
    `    ${created.html_url}/installations/new\n\n` +
    `  Grant it on:\n` +
    [...new Set(targets)].map((r) => `    ${r}\n`).join("") +
    `\n  Then check the grant actually took — a declaration is not a grant:\n` +
    `    roster doctor ${handle}\n\n`,
  );
  return 0;
}

/** The other staff members this one files work with, so the install covers their trackers too. */
function peerBrains(ws: ReturnType<typeof findWorkspace>, org: any,
                    parseYaml: (t: string, f?: string) => Record<string, unknown>, handle: string): string[] {
  const out: string[] = [];
  for (const s of org.staff ?? []) {
    if (s.handle === handle) continue;
    const p = join(ws.root, s.dir ?? s.handle, "staff.yaml");
    if (!existsSync(p)) continue;
    try {
      const m = parseYaml(readFileSync(p, "utf8"), "staff.yaml") as any;
      if (m.brain) out.push(String(m.brain));
    } catch { /* a manifest that will not parse is doctor's problem, not this command's */ }
  }
  return out;
}

interface Flags { ops?: string; public?: boolean; port?: number; noOpen?: boolean }

function parseFlags(argv: string[]): Flags {
  const out: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--public") { out.public = true; continue; }
    if (flag === "--no-open") { out.noOpen = true; continue; }
    const value = argv[++i];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flag === "--ops") out.ops = value;
    else if (flag === "--port") out.port = Number(value);
    else throw new Error(`unknown flag ${flag}`);
  }
  return out;
}
