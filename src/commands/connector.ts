import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { commitAndPush } from "../lib/commit.js";
import {
  CATALOGUE,
  checkKey,
  declared,
  deleteSecret,
  secretsOn,
  setConnector,
  storeSecret,
  wrongValue,
} from "../lib/connectors.js";
import { localGitHub } from "../lib/localtoken.js";
import { findWorkspace, loadComposer, readOrg } from "../lib/workspace.js";
import { readSecret } from "./credential.js";

export const connectorHelp = `
roster connector [list]
roster connector add <name> [--staff <handles>] [--read-only] [--set <field=value>] [--apply]
roster connector remove <name> [--apply]

  Give staff an outside service to use in their runs, such as Sentry, Linear or Stripe.

  list     the services roster knows, and the ones this org has, with whose they are and
           whether their keys are stored
  add      add one, or change who has it. With --apply it asks for the key, checks it with the
           service, stores it as a GitHub secret every brain can read, and commits org.yaml
  remove   take one away, and delete its keys

  The key is typed at a prompt that does not echo, or read from standard input. It never goes
  on a command line or in org.yaml.

  --staff <handles>    who gets it, comma separated (default: the catalogue's suggestion)
  --read-only          hold it to reading, for everybody who has it
  --set <field=value>  a setting the service needs, such as --set project_ref=abc123
  --url <url>          a service roster does not know: its MCP server's URL
  --command <line>     or the command that starts it
  --secret <NAME>      a key that service needs, by the name it is given (repeatable)
  --keep-key           change who has it without asking for the key again
  --apply              do it
  --ops <dir>          ops repo directory (default: found by walking up)
`;

export async function connectorCommand(argv: string[]): Promise<number> {
  const [sub = "list", id, ...rest] = argv[0]?.startsWith("-") ? ["list", ...argv] : argv;
  const opts = parseFlags(id?.startsWith("-") ? [id, ...rest] : rest);
  const name = id?.startsWith("-") ? undefined : id;
  try {
    if (sub === "list") return await list(opts);
    if (!name) throw new Error(`roster connector ${sub} needs a name. See roster connector list`);
    if (sub === "add") return await add(name, opts);
    if (sub === "remove") return await remove(name, opts);
    throw new Error(`unknown subcommand ${sub}. One of: list, add, remove`);
  } catch (err) {
    process.stderr.write(`roster: ${(err as Error).message}\n`);
    return 1;
  }
}

async function load(opts: Flags) {
  const ws = findWorkspace(opts.ops);
  const { parseYaml } = await loadComposer(ws.opsDir);
  const org = readOrg(ws.opsDir, parseYaml) as {
    org: string;
    staff?: Array<{ handle: string; dir?: string }>;
    connectors?: Record<string, Record<string, unknown>>;
  };
  const file = join(ws.opsDir, "org.yaml");
  const brains = (org.staff ?? []).map((s) => `${org.org}/${s.dir ?? s.handle}`);
  return { ws, org, file, text: readFileSync(file, "utf8"), brains };
}

async function list(opts: Flags): Promise<number> {
  const { org, brains } = await load(opts);
  const have = declared(org);
  const out: string[] = ["", "  Connected"];
  if (!have.length) out.push("    none yet");

  const gh = await localGitHub();
  const stored = gh.ok ? await secretsOn(gh.gh, brains) : null;
  for (const c of have) {
    const keys = c.secrets.map((s) => s.name);
    let status = "";
    if (c.problem) status = c.problem;
    else if (c.auth === "oauth") status = `signs in through ${c.portal}`;
    else if (stored) {
      const where = [...stored.values()].filter((s): s is Set<string> => s !== null);
      status = !where.length
        ? "keys unreadable with your token"
        : keys.every((k) => where.every((s) => s.has(k)))
          ? "key stored"
          : `key missing: ${keys.join(", ")}`;
    }
    out.push(
      `    ${c.name.padEnd(26)} ${(c.staff.join(", ") || "nobody").padEnd(16)} ${status}` +
        (c.readOnly ? " (read only)" : ""),
    );
  }

  out.push("", "  Available");
  for (const [cid, e] of Object.entries(CATALOGUE)) {
    if (have.some((c) => c.catalogue === cid)) continue;
    out.push(`    ${cid.padEnd(12)} ${e.name.padEnd(26)} ${e.summary}`);
  }
  out.push("", "  roster connector add <name> to add one.", "");
  process.stdout.write(out.join("\n") + "\n");
  return 0;
}

async function add(id: string, opts: Flags): Promise<number> {
  const { ws, org, file, text, brains } = await load(opts);
  const known = CATALOGUE[id];
  const existing = (org.connectors ?? {})[id];
  if (!known && !existing && !opts.url && !opts.command) {
    throw new Error(
      `roster does not know "${id}". Pick one from roster connector list, or give --url or --command`,
    );
  }
  if (known?.auth === "oauth") {
    throw new Error(`${known.name} signs in with a browser. Add it from the hosted portal's Connectors page`);
  }

  const handles = new Set((org.staff ?? []).map((s) => s.handle));
  const staff =
    opts.staff ??
    (existing?.staff as string[] | undefined) ??
    (known?.suggest ?? []).filter((h) => handles.has(h));
  const unknown = staff.filter((h) => !handles.has(h));
  if (unknown.length) throw new Error(`no staff member ${unknown.join(", ")} in org.yaml`);
  if (!staff.length) throw new Error("nobody would have it. Say who with --staff cto,cmo");

  const entry: Record<string, unknown> = { staff };
  if (opts.readOnly) entry.read_only = true;
  if (opts.url) entry.url = opts.url;
  if (opts.command) entry.command = opts.command;
  if (opts.secrets.length) entry.secrets = opts.secrets;
  Object.assign(entry, opts.set);

  const next = setConnector(text, org, id, entry);
  const after = declared({ ...org, connectors: { ...(org.connectors ?? {}), [id]: { ...(existing ?? {}), ...entry } } }).find(
    (c) => c.id === id,
  )!;
  if (after.problem) throw new Error(after.problem);

  process.stdout.write(`\n  roster connector add ${id}\n\n`);
  process.stdout.write(`    ${after.name} for ${staff.join(", ")}${opts.readOnly ? ", read only" : ""}\n`);
  if (!opts.keepKey) {
    for (const s of after.secrets) process.stdout.write(`    + secret ${s.name} on ${brains.length} brain repos\n`);
  }
  process.stdout.write(`    ~ org.yaml, committed and pushed\n\n`);
  if (known) {
    for (const step of known.steps) process.stdout.write(`    ${step}\n`);
    if (known.link) process.stdout.write(`    ${known.link}\n`);
    process.stdout.write("\n");
  }
  if (!opts.apply) {
    process.stdout.write("  Nothing was changed. Re-run with --apply.\n\n");
    return 0;
  }

  const gh = await localGitHub();
  if (!gh.ok) throw new Error(gh.error);

  if (!opts.keepKey && after.secrets.length) {
    const values: Record<string, string> = { ...after.settings };
    for (const s of after.secrets) {
      values[s.field] = await readSecret(`  ${s.label} (it is not shown): `);
    }
    const wrong = wrongValue(after.catalogue ?? "", values);
    if (wrong) throw new Error(wrong);
    if (after.catalogue) {
      const checked = await checkKey(after.catalogue, values);
      if (checked.state === "rejected") throw new Error(`${checked.note} Nothing was stored.`);
      process.stdout.write(`  ${checked.state === "ok" ? "The key works." : checked.note}\n`);
    }
    for (const s of after.secrets) {
      const done = await storeSecret(gh.gh, org.org, s.name, values[s.field]!, brains);
      if (done.fellBack) process.stdout.write(`  the org secret was refused: ${done.fellBack}\n`);
      process.stdout.write(
        done.mode === "org"
          ? `  stored ${s.name} once for ${org.org}\n`
          : `  stored ${s.name} on ${done.repos.join(", ")}\n`,
      );
    }
  }

  writeFileSync(file, next);
  report(commitAndPush(ws.opsDir, ["org.yaml"], `roster: connect ${after.name}`));
  return 0;
}

async function remove(id: string, opts: Flags): Promise<number> {
  const { ws, org, file, text, brains } = await load(opts);
  const c = declared(org).find((x) => x.id === id);
  if (!c) throw new Error(`org.yaml has no connector "${id}"`);
  process.stdout.write(`\n  roster connector remove ${id}\n\n`);
  process.stdout.write(`    - ${c.name}, from ${c.staff.join(", ") || "nobody"}\n`);
  for (const s of c.secrets) process.stdout.write(`    - secret ${s.name}\n`);
  process.stdout.write(`    ~ org.yaml, committed and pushed\n\n`);
  if (!opts.apply) {
    process.stdout.write("  Nothing was changed. Re-run with --apply.\n\n");
    return 0;
  }
  const gh = await localGitHub();
  if (!gh.ok) throw new Error(gh.error);
  for (const s of c.secrets) await deleteSecret(gh.gh, org.org, s.name, brains);
  writeFileSync(file, setConnector(text, org, id, null));
  report(commitAndPush(ws.opsDir, ["org.yaml"], `roster: disconnect ${c.name}`));
  return 0;
}

function report(done: ReturnType<typeof commitAndPush>) {
  process.stdout.write(
    done.pushed
      ? `  committed and pushed org.yaml (${done.sha})\n\n`
      : done.committed
        ? `  committed org.yaml but could not push: ${done.note}. Push it yourself.\n\n`
        : `  org.yaml left uncommitted: ${done.note}\n\n`,
  );
}

interface Flags {
  ops?: string;
  apply?: boolean;
  staff?: string[];
  readOnly?: boolean;
  keepKey?: boolean;
  url?: string;
  command?: string;
  secrets: string[];
  set: Record<string, string>;
}

function parseFlags(argv: string[]): Flags {
  const out: Flags = { secrets: [], set: {} };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${flag} needs a value`);
      return v;
    };
    if (flag === "--apply") out.apply = true;
    else if (flag === "--read-only") out.readOnly = true;
    else if (flag === "--keep-key") out.keepKey = true;
    else if (flag === "--ops") out.ops = value();
    else if (flag === "--staff") out.staff = value().split(",").map((s) => s.trim()).filter(Boolean);
    else if (flag === "--url") out.url = value();
    else if (flag === "--command") out.command = value();
    else if (flag === "--secret") out.secrets.push(value());
    else if (flag === "--set") {
      const [k, ...v] = value().split("=");
      if (!k || !v.length) throw new Error("--set takes field=value");
      out.set[k] = v.join("=");
    } else throw new Error(`unknown flag ${flag}`);
  }
  return out;
}
