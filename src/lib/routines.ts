/**
 * Routines: the times a staff member wakes up beyond the daily round, each with its own job.
 *
 * A routine is two halves in the brain repo. Its schedule is a line in `staff.yaml`, under
 * `routines:`, because the caller workflow is generated from the manifest and a schedule that
 * lived anywhere else would drift from the cron that actually fires. What to do is a markdown
 * file, `routines/<id>.md`, because it is a person's words: it can be long, it is read by the
 * agent as written, and the parser staff.yaml goes through has no business quoting it.
 *
 * Every schedule is compiled into the daily caller's `on.schedule`, and the cron that fired
 * (`github.event.schedule`) says which routine it was. So a routine costs nothing between runs:
 * there is no poller waking every hour to ask whether anything is due.
 */

export interface RoutineEntry {
  id: string;
  /** Five-field cron, UTC, as GitHub reads it. */
  schedule: string;
}

export interface Routine extends RoutineEntry {
  title: string;
  /** What to do, as the person wrote it. */
  body: string;
}

export const ROUTINE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** The id a title would get: lowercase, hyphenated, short enough to read in a run's name. */
export function routineId(title: string, taken: string[] = []): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32)
      .replace(/-+$/, "") || "routine";
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

/**
 * A cron GitHub will accept, in the five numeric fields it reads. Names (MON, JAN) and the
 * `@daily` shorthands are left out on purpose: the portal writes numbers, and one spelling is
 * what lets two schedules be compared for a clash.
 */
export function validCron(cron: string): boolean {
  const fields = cron.trim().split(/\s+/);
  return (
    fields.length === 5 &&
    fields.every((f) => /^(\*|\d+(-\d+)?)(\/\d+)?(,(\d+(-\d+)?)(\/\d+)?)*$/.test(f))
  );
}

/** Everything wrong with a set of routines, as sentences. Empty when it can be saved. */
export function checkRoutines(daily: string, routines: Routine[]): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  const crons = new Map<string, string>([[norm(daily), "the daily round"]]);
  if (!validCron(daily))
    out.push(`the daily round's schedule "${daily}" is not a cron GitHub reads`);
  for (const r of routines) {
    const name = r.title || r.id;
    if (!ROUTINE_ID.test(r.id))
      out.push(`"${r.id}" is not a routine id: lowercase letters, numbers and hyphens`);
    if (ids.has(r.id)) out.push(`two routines are called ${r.id}`);
    ids.add(r.id);
    if (!r.title.trim()) out.push(`${r.id} needs a name`);
    if (!r.body.trim()) out.push(`${name} needs something to do`);
    if (!validCron(r.schedule)) {
      out.push(`${name}'s schedule "${r.schedule}" is not a cron GitHub reads`);
      continue;
    }
    /* GitHub fires one event for a cron listed twice, so the second routine would never run.
       Saying so is better than a routine that silently does not. */
    const clash = crons.get(norm(r.schedule));
    if (clash) out.push(`${name} is at the same time as ${clash}; move one by a minute`);
    crons.set(norm(r.schedule), name);
  }
  return out;
}

const norm = (cron: string) => cron.trim().split(/\s+/).join(" ");

/** The routines a parsed staff.yaml lists. Anything malformed is dropped rather than thrown. */
export function routinesOf(manifest: Record<string, any>): RoutineEntry[] {
  const list = Array.isArray(manifest.routines) ? manifest.routines : [];
  return list
    .map((r: any) => ({ id: String(r?.id ?? ""), schedule: String(r?.schedule ?? "") }))
    .filter((r: RoutineEntry) => ROUTINE_ID.test(r.id) && validCron(r.schedule));
}

/** `routines/<id>.md`: the name as the heading, then what to do. */
export function routineFile(r: Pick<Routine, "title" | "body">): string {
  return `# ${r.title.trim()}\n\n${r.body.trim()}\n`;
}

export function parseRoutineFile(text: string, id: string): Pick<Routine, "title" | "body"> {
  const m = /^#\s+(.+)\n?/.exec(text.trimStart());
  if (!m) return { title: id, body: text.trim() };
  return { title: m[1]!.trim(), body: text.trimStart().slice(m[0].length).trim() };
}

export const routinePath = (id: string) => `routines/${id}.md`;

/**
 * Replace the `routines:` block in staff.yaml, or add one, leaving every other line as it was.
 *
 * Textual for the same reason `hire` edits org.yaml textually: the parser takes a small YAML
 * subset, and a round trip through a general emitter would reformat the file and drop its
 * comments.
 */
export function setRoutinesInManifest(text: string, routines: RoutineEntry[]): string {
  const block = routines.length
    ? `routines:\n${routines.map((r) => `  - { id: ${r.id}, schedule: "${norm(r.schedule)}" }`).join("\n")}`
    : "routines: []";
  const lines = text.split("\n");
  const at = lines.findIndex((l) => /^routines:/.test(l));
  if (at === -1) {
    const comment =
      "# Times this staff member wakes beyond the daily round, each with its own job in\n" +
      "# routines/<id>.md. Times are UTC. Edit them in the portal or with `roster routine`.";
    const scheduleAt = lines.findIndex((l) => /^schedule:/.test(l));
    if (scheduleAt === -1) return `${text.trimEnd()}\n\n${comment}\n${block}\n`;
    lines.splice(scheduleAt + 1, 0, comment, block);
    return lines.join("\n");
  }
  let end = at + 1;
  while (end < lines.length && /^(\s+|$)/.test(lines[end]!) && lines[end]!.trim() !== "") end++;
  lines.splice(at, end - at, block);
  return lines.join("\n");
}

/** Change the daily round's time in staff.yaml. */
export function setDailyInManifest(text: string, cron: string): string {
  return /^schedule:.*$/m.test(text)
    ? text.replace(/^schedule:.*$/m, `schedule: "${norm(cron)}"`)
    : `${text.trimEnd()}\nschedule: "${norm(cron)}"\n`;
}

/** The caller's `on.schedule` entries: the daily round, then each routine. */
export function scheduleLines(daily: string, routines: RoutineEntry[]): string {
  return [
    `    - cron: "${norm(daily)}"`,
    ...routines.map((r) => `    - cron: "${norm(r.schedule)}" # ${r.id}`),
  ].join("\n");
}

/**
 * Which routine a scheduled run is, as a GitHub expression: the id when the cron that fired is
 * a routine's, empty when it is the daily round's.
 */
export function routineExpression(routines: RoutineEntry[]): string {
  if (!routines.length) return "''";
  return `(${routines
    .map((r) => `(github.event.schedule == '${norm(r.schedule)}' && '${r.id}')`)
    .join(" || ")} || '')`;
}

const DAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * A schedule in words, for a person: "Weekdays at 08:00 UTC", "Mondays at 09:00 UTC". Anything
 * the picker cannot write comes back as the cron itself, which is still exact.
 */
export function describeCron(cron: string): string {
  const [min, hour, dom, mon, dow] = norm(cron).split(" ");
  if (!/^\d+$/.test(min ?? "") || !/^\d+$/.test(hour ?? "") || mon !== "*") return cron;
  const at = `at ${hour!.padStart(2, "0")}:${min!.padStart(2, "0")} UTC`;
  if (dom !== "*") {
    return /^\d+$/.test(dom ?? "") && dow === "*"
      ? `On the ${ordinal(Number(dom))} of each month ${at}`
      : cron;
  }
  const days =
    dow === "*"
      ? "Every day"
      : dow === "1-5"
        ? "Weekdays"
        : dow === "0,6" || dow === "6,0"
          ? "Weekends"
          : /^[0-6](,[0-6])*$/.test(dow ?? "")
            ? dow!
                .split(",")
                .map((d) => `${DAY[Number(d)]}s`)
                .join(", ")
                .replace(/, ([^,]*)$/, " and $1")
            : null;
  return days ? `${days} ${at}` : cron;
}

function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}
