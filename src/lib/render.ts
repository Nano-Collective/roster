import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { templateFiles, templatesRoot } from "./templates.js";

/**
 * Everything a brain-repo template needs to know about the staff member it is being rendered
 * for. Assembled once, in `hire`, and then also used by `upgrade` to work out what a caller
 * *should* look like today — which is the only way to tell a deliberate local edit from a
 * generated file that has fallen behind.
 */
export interface StaffSpec {
  handle: string;
  name: string;
  /** Directory in the workspace, which is also the repo name. */
  dir: string;
  /** owner/name of the brain repo. */
  brain: string;
  mention: string;
  /** The pinned status issue. 0 until `--apply` opens it; the manifest is incomplete until then. */
  statusIssue: number;
  /** Repos this staff member contributes to but does not own, as `owner/name`. */
  worksIn: string[];
  schedule: string;
  model: string;
  timeout: number;
  mentionTimeout: number;
  /** Secret name prefix for this staff member's own app: CTO_APP_ID and so on. */
  secretPrefix: string;
  /** The shared public identity every staff member pushes through. */
  publicSecretPrefix: string;
  /** GitHub App slugs. These carry a tenant's own naming (`acme-cto`, not `acme-cto`), so
   *  they are inferred from an existing staff member rather than built from the handle. */
  app: string;
  publicApp: string;
  publicTokenEnv: string;
  /** The repo secret holding the agent's credential, named after the credential itself. */
  agentSecret: string;
}

export interface OrgSpec {
  org: string;
  name: string;
  opsRepo: string;
  /** Just the directory name, for a relative path from a brain repo to the ops repo. */
  opsDirName: string;
  human: string;
  /** The provenance tag on a fact the human ruled on, and their label on a tracker. */
  humanMarker: string;
}

/**
 * A line carrying %%TOKENS%% is a note to whoever reads the template, not a placeholder, and
 * it is dropped rather than filled. Keeping it would put "filled by roster hire" into every
 * generated file, which is exactly the sort of thing nobody deletes afterwards.
 *
 * Every line of a note has to carry the marker. Dropping only the first line of a two-line
 * note left the second stranded — "which is why this template uses a different delimiter"
 * with nothing before it — which is worse than having left the whole thing in.
 */
const NOTE = "%%TOKENS%%";
const TOKEN = /%%([A-Z_]+)%%/g;

/** The half of the token set that does not need a staff member: briefs about the org layer. */
export function orgTokens(org: OrgSpec): Record<string, string> {
  return {
    ORG: org.org,
    ORG_NAME: org.name,
    OPS_REPO: org.opsRepo,
    OPS_REPO_DIR: org.opsDirName,
    HUMAN: org.human,
    HUMAN_MARKER: org.humanMarker,
  };
}

export function tokensFor(org: OrgSpec, s: StaffSpec): Record<string, string> {
  return {
    ...orgTokens(org),
    STAFF: s.handle,
    STAFF_UPPER: s.handle.toUpperCase(),
    NAME: s.name,
    DIR: s.dir,
    BRAIN: s.brain,
    MENTION: s.mention,
    STATUS_ISSUE: String(s.statusIssue),
    WORKS_IN: s.worksIn.length
      ? "\n" +
        s.worksIn.map((r) => `  - { repo: ${r}, role: contributor, checkout: true }`).join("\n")
      : " []",
    SCHEDULE: s.schedule,
    MODEL: s.model,
    TIMEOUT: String(s.timeout),
    MENTION_TIMEOUT: String(s.mentionTimeout),
    SECRET_PREFIX: s.secretPrefix,
    PUBLIC_SECRET_PREFIX: s.publicSecretPrefix,
    APP: s.app,
    PUBLIC_APP: s.publicApp,
    PUBLIC_TOKEN_ENV: s.publicTokenEnv,
    AGENT_SECRET: s.agentSecret,
  };
}

/**
 * Fill a template. An unknown token throws rather than being left on the page: a generated
 * workflow containing a literal %%SCHEDULE%% is a file GitHub will accept and never run.
 */
export function render(text: string, tokens: Record<string, string>, where = "template"): string {
  const lines = text.split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]!.includes(NOTE)) {
      kept.push(lines[i]!);
      continue;
    }
    // Take the separator that introduced the note with it, rather than leaving a bare "#".
    while (kept.length && /^\s*#\s*$/.test(kept[kept.length - 1]!)) kept.pop();
  }
  const body = kept.join("\n").replace(/\n{3,}/g, "\n\n");

  const missing = new Set<string>();
  const out = body.replace(TOKEN, (_m, name: string) => {
    const value = tokens[name];
    if (value === undefined) {
      missing.add(name);
      return _m;
    }
    return value;
  });

  if (missing.size) {
    throw new Error(
      `${where}: no value for ${[...missing].map((m) => `%%${m}%%`).join(", ")}.\n` +
        `Known tokens: ${Object.keys(tokens).sort().join(", ")}`,
    );
  }
  return out;
}

/**
 * Render a whole template directory, keyed by the path the file will have.
 *
 * Paths are rendered too. A caller workflow is called `cto-daily.yaml`, not `daily.yaml` —
 * they sit in one Actions list per repo and an unprefixed name says nothing about whose run
 * it is. Missing that is why the first comparison reported every live workflow as absent.
 */
export function renderTree(dir: string, tokens: Record<string, string>): Map<string, string> {
  const out = new Map<string, string>();
  for (const rel of templateFiles(dir)) {
    const path = render(rel, tokens, rel);
    out.set(path, render(readFileSync(join(dir, rel), "utf8"), tokens, rel));
  }
  return out;
}

export function brainTemplateDir(): string {
  return join(templatesRoot(), "brain");
}

/**
 * The authoring briefs.
 *
 * One source, two surfaces: `roster brief` prints them for any agent, and `init` and `hire`
 * render them into `.claude/commands/` so Claude Code users get `/discover`, `/voice` and
 * `/charter`. Nothing in them is specific to any agent, which is the point.
 */
export function briefTemplateDir(): string {
  return join(templatesRoot(), "briefs");
}

/**
 * The briefs, rendered as Claude Code slash commands.
 *
 * Claude Code is the reference runner, so it gets the one-word path; every other agent gets
 * the same text from `roster brief`. Generated from the briefs rather than kept beside them,
 * because two copies of an interview script diverge and only one of them is ever updated.
 */
export function briefCommands(
  which: string[],
  tokens: Record<string, string>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const kind of which) {
    const path = join(briefTemplateDir(), `${kind}.md`);
    if (!existsSync(path)) throw new Error(`no brief template at ${path}`);
    out.set(
      `.claude/commands/${kind}.md`,
      render(readFileSync(path, "utf8"), tokens, `briefs/${kind}.md`),
    );
  }
  return out;
}

/**
 * Stagger a new hire away from everyone already on a schedule.
 *
 * They write to each other's trackers, and a human reading the output has one attention span,
 * so three agents all starting at 07:00 is worse than three starting forty minutes apart.
 * Only the common "minute hour * * days" shape is understood; anything else is left alone and
 * the caller falls back to a default.
 */
export function nextSlot(existing: string[], gapMinutes = 40): string | null {
  const times = existing
    .map((c) => /^(\d+)\s+(\d+)\s+\S+\s+\S+\s+(\S+)$/.exec(String(c).trim()))
    .filter(Boolean)
    .map((m) => ({ min: Number(m![1]), hour: Number(m![2]), days: m![3]! }));
  if (!times.length) return null;

  const latest = times.reduce((a, b) => (a.hour * 60 + a.min >= b.hour * 60 + b.min ? a : b));
  const at = latest.hour * 60 + latest.min + gapMinutes;
  // Past midnight is a different day's run, which is a decision rather than arithmetic.
  if (at >= 24 * 60) return null;
  return `${at % 60} ${Math.floor(at / 60)} * * ${latest.days}`;
}

/**
 * The spec for a staff member who already exists, read from their own manifest.
 *
 * Every value here is the tenant's, not the framework's, and that is the whole point: rendering
 * the base and the incoming version of a file with the *same* current spec cancels the tenant's
 * values out, so only the template's own change shows up as drift. Read the wrong source — the
 * org defaults, say — and the CTO's deliberate 90-minute ceiling reads as something to revert.
 */
export function specFromManifest(m: Record<string, any>, dir: string): StaffSpec {
  const identity = (scope: string) =>
    (m.identities ?? []).find((i: any) => i?.scope === scope) ?? {};
  const priv = identity("private");
  const pub = identity("public");
  return {
    handle: String(m.handle ?? dir),
    name: String(m.name ?? m.handle ?? dir),
    dir,
    brain: String(m.brain ?? ""),
    mention: String(m.mention ?? `@${m.handle ?? dir}`),
    statusIssue: Number(m.status_issue ?? 0),
    worksIn: (m.works_in ?? []).map((w: any) => String(w?.repo)).filter(Boolean),
    schedule: String(m.schedule ?? ""),
    model: String(m.model ?? ""),
    timeout: Number(m.timeout_minutes ?? 90),
    // Absent from the manifests written before these were separate fields. 90 either way: a
    // mention that ends in a build needs a session's room, and the 30 these once fell back to
    // killed four runs mid-gate at a ceiling nobody had chosen.
    mentionTimeout: Number(m.mention_timeout_minutes ?? 90),
    secretPrefix: String(priv.secret_prefix ?? String(m.handle ?? dir).toUpperCase()),
    publicSecretPrefix: String(pub.secret_prefix ?? "BOT"),
    app: String(priv.app ?? ""),
    publicApp: String(pub.app ?? ""),
    publicTokenEnv: String(m.public_token_env ?? "PUBLIC_TOKEN"),
    agentSecret: String(m.agent_secret ?? "CLAUDE_CODE_OAUTH_TOKEN"),
  };
}
