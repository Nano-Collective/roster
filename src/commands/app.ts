import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type AppSpec, type CreatedApp, createApp, setSecret } from "../lib/appmanifest.js";
import { api, ghReady } from "../lib/gh.js";
import { installTargets, preselectedInstall } from "../lib/install.js";
import { specFromManifest } from "../lib/render.js";
import { findWorkspace, loadComposer, readOrg } from "../lib/workspace.js";

export const appHelp = `
roster app <handle> [--public] [--port 4310] [--no-open] [--apply]

  Create the GitHub App a staff member runs as, and put its credentials into their repo.

  This is the step \`hire\` has always had to hand back to you. There is no API that creates an
  App: you POST a manifest to a settings page in a browser, a human confirms, and GitHub hands
  back a one-time code. So this serves the hand-off on localhost, opens it, catches the
  redirect, exchanges the code, and writes the id and the private key straight into the brain
  repo's secrets — the key is held in memory and never touches disk.

  What it still cannot do is install the App. Installing grants access to specific repos and
  GitHub asks a human to confirm them. The link it prints opens the install page with the org
  and every repo this staff member needs already ticked: its brain, its peers' trackers and
  the product repos. A first run is what proves the grant took: \`roster run <handle>\`.

  Nothing happens without --apply. On its own this prints the plan: the App's name, the
  secrets it would write, and the repos you will be asked to grant.

  <handle>      a staff member in org.yaml
  --public      create the shared public identity instead of this staff member's own
  --port <n>    the localhost port the hand-off listens on (default 4310)
  --no-open     print the URL rather than opening a browser
  --apply       actually create it
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
    process.stderr.write(
      `roster: ${dir}/staff.yaml is missing. Run \`roster hire ${handle}\` first.\n`,
    );
    return 2;
  }
  const spec = specFromManifest(
    parseYaml(readFileSync(manifestPath, "utf8"), "staff.yaml") as any,
    dir,
  );

  const scope = opts.public ? "public" : "private";
  const name = opts.public ? spec.publicApp : spec.app;
  const prefix = opts.public ? spec.publicSecretPrefix : spec.secretPrefix;
  if (!name) {
    process.stderr.write(`roster: staff.yaml declares no ${scope} app for ${handle}\n`);
    return 2;
  }

  // An App name is unique across GitHub, so a clash is the common failure and worth catching
  // before a browser is opened rather than after a form is submitted.
  const targets = installTargets(ws, org, parseYaml, handle, spec);
  const existing = await api<{ slug: string }>(`/apps/${name}`);
  if (existing.ok) {
    const install = await preselectedInstall(existing.data?.slug ?? name, org.org, targets);
    process.stderr.write(
      `roster: an App called "${name}" already exists.\n` +
        `  If it is yours, it only needs installing and its secrets setting:\n` +
        `    ${install.url}\n`,
    );
    return 1;
  }

  /* Every other command plans first, and this one should too: an App name is global and a
     created App cannot be renamed, so seeing the name before the browser opens is worth a
     second invocation. Everything above is a read. */
  if (!opts.apply) {
    process.stdout.write(
      `\n  roster app — ${name} (${scope}) for ${handle}\n\n` +
        `    creates     the GitHub App "${name}" in ${org.org}, confirmed by you in a browser\n` +
        `    writes      ${prefix}_APP_ID and ${prefix}_APP_PRIVATE_KEY to ${spec.brain}\n` +
        `    then links  to the install page with these already selected:\n` +
        targets.map((r) => `                  ${r}\n`).join("") +
        `\n  Nothing was created. Re-run with --apply.\n\n`,
    );
    return 0;
  }

  const appSpec: AppSpec = {
    name,
    org: org.org,
    scope,
    description: opts.public
      ? `Shared public identity for ${org.name}'s staff, managed by roster.`
      : `${spec.name} at ${org.name}. An agent-run staff member, managed by roster.`,
  };

  let created: CreatedApp;
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
     What can be done is arriving on the page with the right answer already ticked, because an
     install that covers only the brain looks finished and fails the first time a brief goes to
     a peer. */
  const install = await preselectedInstall(created.slug, org.org, targets);
  process.stdout.write(
    `\n  Now install it. GitHub asks you to confirm which repos it may reach:\n` +
      `    ${install.url}\n\n` +
      (install.preselected.length
        ? `  Already selected on that page:\n` +
          install.preselected.map((r) => `    ${r}\n`).join("")
        : "") +
      (install.missing.length
        ? `  Tick these yourself; their ids could not be read:\n` +
          install.missing.map((r) => `    ${r}\n`).join("")
        : "") +
      `\n  Then prove the grant took, with one run:\n` +
      `    roster run ${handle} --apply\n\n`,
  );
  return 0;
}

interface Flags {
  ops?: string;
  public?: boolean;
  port?: number;
  noOpen?: boolean;
  apply?: boolean;
}

function parseFlags(argv: string[]): Flags {
  const out: Flags = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--public") {
      out.public = true;
      continue;
    }
    if (flag === "--apply") {
      out.apply = true;
      continue;
    }
    if (flag === "--no-open") {
      out.noOpen = true;
      continue;
    }
    const value = argv[++i];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flag === "--ops") out.ops = value;
    else if (flag === "--port") out.port = Number(value);
    else throw new Error(`unknown flag ${flag}`);
  }
  return out;
}
