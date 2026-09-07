import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { amendBrief } from "../lib/amend.js";
import { promptView } from "../lib/prompt.js";
import { briefTemplateDir, orgTokens, specFromManifest, tokensFor } from "../lib/render.js";
import { findWorkspace, loadComposer, readOrg } from "../lib/workspace.js";

export const briefHelp = `
roster brief <kind> [handle]

  Print a self-contained brief for authoring one of the files the agents run on. Paste it
  into whatever you use, or pipe it.

  These are the only files anybody writes by hand. org/operating.md, org/voice.md and
  org/guardrails.md ship written; a charter and org/business.md cannot, because they are the
  half that is about you.

    discover        write org/business.md, which every prompt is composed on top of
    charter <who>   write a staff member's CHARTER.md
    voice           revise org/voice.md, the house style every surface inherits
    amend <who>     change what a staff member is told, with the whole prompt attached

  \`amend\` is the long one. It carries the composed prompt and every file it is assembled
  from, so the agent you paste it into does not have to ask for any of them. Say what you
  want with --want, or fill in the placeholder at the top before you send it.

  Examples:
    roster brief amend cto --want "stop opening decision issues for anything reversible"
    roster brief discover
    roster brief charter cto
    roster brief charter cto | pbcopy
    roster brief voice > /tmp/brief.md

  Claude Code users get the same three as /discover, /voice and /charter, generated from
  these briefs by \`roster init\` and \`roster hire\`. There is nothing in them that is
  specific to any agent.

  --kind <k>      for amend: daily | mention | pr-mention  (default: daily)
  --want <text>   for amend: what you want changed
  --ops <dir>     ops repo directory (default: found by walking up)
`;

/** A brief about one staff member needs to know which. The org-level ones do not. */
export const NEEDS_STAFF = new Set(["charter", "amend"]);

export async function briefCommand(argv: string[]): Promise<number> {
  const kind = argv[0];
  const kinds = available();

  if (!kind || kind.startsWith("-")) {
    process.stderr.write(briefHelp);
    return 2;
  }
  if (!kinds.includes(kind)) {
    process.stderr.write(`roster: no brief called "${kind}". There is: ${kinds.join(", ")}\n`);
    return 2;
  }

  const handle = argv[1] && !argv[1].startsWith("-") ? argv[1] : undefined;
  const opts = parseFlags(argv.slice(handle ? 2 : 1));
  const ws = findWorkspace(opts.ops);
  const { parseYaml } = await loadComposer(ws.opsDir);
  const org = readOrg(ws.opsDir, parseYaml);

  if (NEEDS_STAFF.has(kind) && !handle) {
    const known = (org.staff ?? []).map((s) => s.handle).join(", ") || "nobody yet";
    process.stderr.write(
      `roster: brief ${kind} needs a staff handle. org.yaml knows: ${known}\n` +
        `  roster brief ${kind} <handle>\n`,
    );
    return 2;
  }

  const tokens = handle ? staffTokens(ws, org, handle, parseYaml) : orgTokens(spec(org, ws));

  /* `amend` is the one brief that carries state. Someone changing a prompt does not know
     which of eight files to open, which is the whole difficulty, so the brief brings them. */
  if (kind === "amend") {
    const { compose } = await loadComposer(ws.opsDir);
    const entry = (org.staff ?? []).find((s) => s.handle === handle)!;
    const view = promptView(
      ws,
      compose,
      handle!,
      join(ws.root, entry.dir ?? entry.handle),
      opts.kind ?? "daily",
    );
    process.stdout.write(amendBrief(ws, view, tokens, opts.want ?? ""));
    return 0;
  }

  const text = readFileSync(join(briefTemplateDir(), `${kind}.md`), "utf8");
  process.stdout.write(renderBrief(text, tokens, `briefs/${kind}.md`));
  return 0;
}

/** The briefs render with the same tokens the scaffold does, so they never disagree with it. */
function staffTokens(
  ws: ReturnType<typeof findWorkspace>,
  org: ReturnType<typeof readOrg>,
  handle: string,
  parseYaml: (t: string, f?: string) => Record<string, unknown>,
) {
  const entry = (org.staff ?? []).find((s) => s.handle === handle);
  if (!entry) {
    const known = (org.staff ?? []).map((s) => s.handle).join(", ") || "nobody yet";
    throw new Error(`unknown staff handle "${handle}". org.yaml knows: ${known}`);
  }
  const dir = entry.dir ?? entry.handle;
  const manifestPath = join(ws.root, dir, "staff.yaml");
  if (!existsSync(manifestPath)) throw new Error(`no staff.yaml at ${manifestPath}`);
  const manifest = parseYaml(readFileSync(manifestPath, "utf8"), `${dir}/staff.yaml`);
  return tokensFor(spec(org, ws), specFromManifest(manifest as Record<string, any>, dir));
}

function spec(org: ReturnType<typeof readOrg>, ws: ReturnType<typeof findWorkspace>) {
  const human = (org.human ?? {}) as Record<string, string>;
  return {
    org: org.org,
    name: org.name,
    opsRepo: `${org.org}/${ws.opsName}`,
    opsDirName: ws.opsName,
    human: human.name ?? human.github ?? "the human",
    humanMarker: human.marker ?? human.github ?? "human",
  };
}

/**
 * A brief is prose for a person to hand to an agent, so an unfilled token is a wrong
 * instruction rather than a broken file. `render` throws on those, which is right for a
 * workflow and too strict here: a brief that mentions a token the org does not have should
 * still print, with the token's name showing so it is obvious what to fill in.
 */
function renderBrief(text: string, tokens: Record<string, string>, where: string): string {
  const unknown = new Set<string>();
  const out = text.replace(/%%([A-Z_]+)%%/g, (m, name: string) => {
    if (tokens[name] === undefined) {
      unknown.add(name);
      return m;
    }
    return tokens[name]!;
  });
  if (unknown.size) {
    process.stderr.write(
      `roster: ${where} mentions ${[...unknown].map((u) => `%%${u}%%`).join(", ")}, ` +
        `which this org has no value for. Left as written.\n`,
    );
  }
  return out;
}

export function available(): string[] {
  return readdirSync(briefTemplateDir())
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""))
    .sort();
}

function parseFlags(argv: string[]) {
  const out: { ops?: string; kind?: string; want?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[++i];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    if (flag === "--ops") out.ops = value;
    else if (flag === "--kind") out.kind = value;
    else if (flag === "--want") out.want = value;
    else throw new Error(`unknown flag ${flag}`);
  }
  return out;
}
