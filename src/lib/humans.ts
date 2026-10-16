/**
 * Who the staff answer to.
 *
 * There used to be exactly one, written as a `human:` map. An org with a co-founder, or a second
 * person on the rota, had no way to say so: the mention callers gate on one login, so a comment
 * from anybody else was silently ignored — the worst failure this system has, because nothing
 * anywhere says it happened.
 *
 * So `org.yaml` now takes a `humans:` list as well. The singular key still works and means a list
 * of one, and the first entry is the primary: the person the prose addresses and whose marker
 * tags a ruling. Everything that gates on identity reads the whole list.
 *
 * Except anyone marked `view_only`. Showing somebody how the org runs should not hand them the
 * org: a view-only human signs in to the portal like anyone else, but cannot wake a staff member,
 * is not named in the prompts as somebody who rules, and is never the primary.
 */
export interface Human {
  /** Login. The mention callers gate on this. */
  github: string;
  /** What to call them in prose. Falls back to the login. */
  name: string;
  /** Provenance tag on a fact they ruled on, as in `[will]`. Falls back to the first name-part. */
  marker: string;
  /** Prose only. */
  role?: string;
  /**
   * What this person looks after, as in `handles: [marketing, content]`. Staff send each ask to
   * the person whose area it is, and the portal shows each person what is theirs.
   */
  handles?: string[];
  /** Signs in and reads; cannot wake anybody, and nothing they say is a ruling. */
  viewOnly?: boolean;
}

type Humanish = Record<string, unknown> | null | undefined;

/**
 * Anything with a `human` or a `humans` on it.
 *
 * Deliberately loose: the callers hold org.yaml as half a dozen slightly different shapes —
 * a parsed manifest with an index signature here, a narrow interface there — and a strict type
 * would mean a cast at every one of them.
 */
export type HasHumans = {
  human?: unknown;
  humans?: unknown;
} & Record<string, any>;

/**
 * Every human, in order, from either spelling.
 *
 * `humans` wins when it has entries, because an org that has written the list is the org that
 * means it. Anyone in `human` who is not already in the list is kept — deleting somebody because
 * they were written in the old key would be a silent demotion.
 */
export function readHumans(org: HasHumans | undefined): Human[] {
  const listed: Humanish[] = Array.isArray(org?.humans)
    ? org.humans
    : org?.humans
      ? [org.humans as Humanish]
      : [];
  const raw = [...listed, org?.human as Humanish].filter(Boolean) as Array<Record<string, unknown>>;

  const out: Human[] = [];
  for (const entry of raw) {
    const github = String(entry.github ?? entry.login ?? "").trim();
    const name = String(entry.name ?? github).trim();
    if (!github && !name) continue;
    // Two entries for one login is a duplicate, not a second person.
    if (github && out.some((h) => h.github.toLowerCase() === github.toLowerCase())) continue;
    out.push({
      github,
      name: name || github,
      marker: String(entry.marker ?? "").trim() || defaultMarker(name || github),
      role: entry.role === undefined || entry.role === null ? undefined : String(entry.role),
      ...(handlesOf(entry.handles).length ? { handles: handlesOf(entry.handles) } : {}),
      ...(entry.view_only === true ? { viewOnly: true } : {}),
    });
  }
  return out;
}

function handlesOf(v: unknown): string[] {
  const list = Array.isArray(v) ? v : v ? String(v).split(",") : [];
  return list.map((x) => String(x ?? "").trim()).filter(Boolean);
}

/** Everyone the staff answer to: every human but the view-only ones. */
export function staffHumans(org: HasHumans | undefined): Human[] {
  return readHumans(org).filter((h) => !h.viewOnly);
}

/** Whether this login is one of the org's view-only humans. */
export function isViewOnly(org: HasHumans | undefined, login: string): boolean {
  const l = login.toLowerCase();
  return readHumans(org).some((h) => h.viewOnly && h.github.toLowerCase() === l);
}

/**
 * The one the prose addresses.
 *
 * Every prompt is written to somebody — "{{human.name}} is not here" — and a list of two cannot
 * be dropped into that sentence. The first entry is it, and the rest are named where being named
 * matters: the mention gate, and the line that says who else can rule on things.
 */
export function primaryHuman(org: HasHumans | undefined): Human | null {
  return staffHumans(org)[0] ?? null;
}

/** Every login that may wake an agent, for the caller workflows' gate. */
export function humanLogins(org: HasHumans | undefined): string[] {
  return staffHumans(org)
    .map((h) => h.github)
    .filter(Boolean);
}

/** "Will (@will-lamerton) and Sam (@sam)", for a sentence in a prompt. */
export function humanSentence(humans: Human[]): string {
  const parts = humans.map((h) => (h.github ? `${h.name} (@${h.github})` : h.name));
  if (parts.length < 2) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** `Will Lamerton` rules on things as `[will]`. */
function defaultMarker(name: string): string {
  return (
    String(name)
      .trim()
      .split(/[\s-]+/)[0]!
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "") || "human"
  );
}

/** One person as the portal's People form sends them. */
export interface PersonInput {
  name?: string;
  github?: string;
  marker?: string;
  role?: string;
  handles?: string[] | string;
  view_only?: boolean;
}

/* org.yaml is read by a small parser in compose.mjs that splits an inline map on commas and
   ends a value at a " #". A name or an area with one of those in it would come back as two
   fields, so they are taken out rather than quoted. */
const clean = (v: unknown) =>
  String(v ?? "")
    .replace(/[,{}[\]#"'\n\r]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** A login GitHub would accept. */
export const LOGIN_RE = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

/**
 * The people, checked and tidied for writing: a marker for everyone, no duplicates, at least
 * one person who can wake the staff. Returns the error to show instead when they will not do.
 */
export function tidyPeople(input: PersonInput[]): { people: Human[]; error?: string } {
  const people: Human[] = [];
  for (const p of input) {
    const github = clean(p.github).replace(/^@/, "");
    const name = clean(p.name) || github;
    if (!github && !name) continue;
    if (!LOGIN_RE.test(github))
      return { people, error: `"${github || name}" is not a GitHub login` };
    if (people.some((h) => h.github.toLowerCase() === github.toLowerCase())) {
      return { people, error: `@${github} is in the list twice` };
    }
    const marker = (clean(p.marker) || defaultMarker(name || github))
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "");
    if (people.some((h) => h.marker === marker)) {
      return {
        people,
        error: `two people would share the label "${marker}"; give one a different label`,
      };
    }
    const handles = (Array.isArray(p.handles) ? p.handles : String(p.handles ?? "").split(","))
      .map(clean)
      .filter(Boolean);
    people.push({
      github,
      name,
      marker,
      ...(clean(p.role) ? { role: clean(p.role) } : {}),
      ...(handles.length ? { handles } : {}),
      ...(p.view_only === true ? { viewOnly: true } : {}),
    });
  }
  if (!people.some((h) => !h.viewOnly)) {
    return {
      people,
      error: "someone has to be able to wake the staff: one person cannot be read-only",
    };
  }
  return { people };
}

/**
 * org.yaml with its `human:` or `humans:` block replaced by `humans:` holding these people, and
 * everything else, comments included, left as it was.
 */
export function writeHumans(text: string, people: Human[]): string {
  const lines = text.split("\n");
  const block = [
    "humans:",
    ...people.map((h) => {
      const parts = [`name: ${h.name}`, `github: ${h.github}`, `marker: ${h.marker}`];
      if (h.role) parts.push(`role: ${h.role}`);
      if (h.handles?.length) parts.push(`handles: [${h.handles.join(", ")}]`);
      if (h.viewOnly) parts.push("view_only: true");
      return `  - { ${parts.join(", ")} }`;
    }),
  ];
  const out: string[] = [];
  let at = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^humans?:/.test(lines[i]!)) {
      if (at < 0) at = out.length;
      // The block runs on while its lines are indented, or blank with more of it below.
      while (i + 1 < lines.length) {
        const next = lines[i + 1]!;
        const more = /^\s+\S/.test(next) || (/^\s*$/.test(next) && nextIsIndented(lines, i + 1));
        if (!more) break;
        i++;
      }
      continue;
    }
    out.push(lines[i]!);
  }
  if (at < 0) {
    const name = out.findIndex((l) => /^name:/.test(l));
    at = name >= 0 ? name + 1 : out.length;
    out.splice(at, 0, "");
    at++;
  }
  out.splice(at, 0, ...block);
  return out.join("\n");
}

function nextIsIndented(lines: string[], from: number): boolean {
  for (let j = from; j < lines.length; j++) {
    if (/^\s*$/.test(lines[j]!)) continue;
    return /^\s+\S/.test(lines[j]!);
  }
  return false;
}
