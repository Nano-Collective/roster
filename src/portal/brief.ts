import { join } from "node:path";
import { withExample } from "../commands/brief.js";
import { matchExample } from "../lib/examples.js";
import { staffHumans } from "../lib/humans.js";
import { briefTemplate, pasteable, pasteBrief } from "../lib/pastebrief.js";
import { orgTokens, specFromManifest, tokensFor, toolsOf } from "../lib/render.js";
import { readFileSync } from "../lib/vfs.js";
import { readOrg, type Workspace } from "../lib/workspace.js";

/**
 * The paste-mode brief for a kind, built once and used by both halves of the loop.
 *
 * `/api/paste` needs the exact same targets `/api/brief` promised, or a paste could name a file
 * the brief never offered. Building it from the same function is what makes that true rather
 * than merely intended.
 */
export function buildPasteBrief(
  ws: Workspace,
  parseYaml: (t: string, f?: string) => Record<string, unknown>,
  kind: string,
  handle: string,
  example?: string,
  about?: string,
) {
  if (!pasteable(kind)) throw new Error(`there is no paste-mode brief for "${kind}"`);
  const org = readOrg(ws.opsDir, parseYaml);
  const staff = org.staff ?? [];

  let dir = "";
  let tokens: Record<string, string>;
  if (kind === "charter") {
    const entry = staff.find((s) => s.handle === handle);
    if (!entry) {
      const known = staff.map((s) => s.handle).join(", ") || "nobody yet";
      throw new Error(`unknown staff handle "${handle}". org.yaml knows: ${known}`);
    }
    dir = entry.dir ?? entry.handle;
    const manifestPath = join(ws.root, dir, "staff.yaml");
    tokens = tokensFor(
      orgSpec(org as any, ws),
      specFromManifest(parseYaml(readFileSync(manifestPath, "utf8"), "staff.yaml") as any, dir),
    );
  } else {
    tokens = orgTokens(orgSpec(org as any, ws));
  }

  const peers = staff.map((s) => s.dir ?? s.handle).filter((d) => d !== dir);
  let rendered = renderBrief(briefTemplate(kind), tokens);
  const chosen =
    kind === "charter" ? (example ?? matchExample(handle, tokens.NAME ?? "") ?? "none") : undefined;
  if (chosen) rendered = withExample(rendered, handle, tokens.NAME ?? "", chosen);
  /* The sentence somebody typed when they hired a role none of the examples match. The only
     place it is kept is here, so the interview starts from it rather than from nothing. */
  if (kind === "charter" && about?.trim()) {
    rendered = `${rendered.trimEnd()}\n\n## What the owner said this role does\n\n${about.trim()}\n`;
  }
  return { ...pasteBrief(ws, kind, rendered, { dir, peers }), example: chosen };
}

/**
 * A brief is prose handed to a model, so an unfilled token is a wrong instruction rather than a
 * broken file. `render` throws on those, which is right for a workflow and too strict here.
 */
function renderBrief(text: string, tokens: Record<string, string>): string {
  return text.replace(/%%([A-Z_]+)%%/g, (m, name: string) => tokens[name] ?? m);
}

/** The org half of the token set, for a brief that names the org and the humans. */
export function orgSpec(
  org: { org: string; name: string; human?: unknown; humans?: unknown },
  w: { opsName: string },
) {
  const humans = staffHumans(org as any);
  const first = humans[0];
  return {
    org: org.org,
    name: org.name,
    opsRepo: `${org.org}/${w.opsName}`,
    opsDirName: w.opsName,
    human: first?.name ?? first?.github ?? "the human",
    humanMarker: first?.marker ?? "human",
    humanLogins: humans.map((h) => h.github).filter(Boolean),
    allowedTools: toolsOf(org),
  };
}

/** Every directory a prompt might write a path relative to. */
export function workspaceRoots(org: {
  staff?: Array<{ handle: string; dir?: string }>;
  repos?: Array<{ name: string }>;
}): string[] {
  return [
    ...(org.staff ?? []).map((s) => s.dir ?? s.handle),
    ...(org.repos ?? []).map((r) => r.name),
  ];
}
