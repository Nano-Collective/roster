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
    });
  }
  return out;
}

/**
 * The one the prose addresses.
 *
 * Every prompt is written to somebody — "{{human.name}} is not here" — and a list of two cannot
 * be dropped into that sentence. The first entry is it, and the rest are named where being named
 * matters: the mention gate, and the line that says who else can rule on things.
 */
export function primaryHuman(org: HasHumans | undefined): Human | null {
  return readHumans(org)[0] ?? null;
}

/** Every login that may wake an agent, for the caller workflows' gate. */
export function humanLogins(org: HasHumans | undefined): string[] {
  return readHumans(org)
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
