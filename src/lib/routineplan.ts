import { join } from "node:path";
import { brainTemplateDir, type OrgSpec, render, specFromManifest, tokensFor } from "./render.js";
import {
  checkRoutines,
  parseRoutineFile,
  type Routine,
  routineFile,
  routinePath,
  routinesOf,
  setDailyInManifest,
  setRoutinesInManifest,
} from "./routines.js";
import { readFileSync } from "./vfs.js";

type ParseYaml = (t: string, f?: string) => Record<string, unknown>;

export const DAILY_TEMPLATE = ".github/workflows/%%STAFF%%-daily.yaml";

/** A file in the brain repo to write, or, with `text: null`, to delete. */
export interface FileChange {
  path: string;
  text: string | null;
}

/** One staff member's schedule as the portal and the CLI show it. */
export interface Schedule {
  daily: string;
  routines: Routine[];
}

/** The schedule a brain has today, read from its manifest and its routines/ files. */
export function readSchedule(
  manifest: Record<string, any>,
  read: (path: string) => string | undefined,
): Schedule {
  return {
    daily: String(manifest.schedule ?? ""),
    routines: routinesOf(manifest).map((r) => {
      const text = read(routinePath(r.id));
      return {
        ...r,
        ...(text === undefined ? { title: r.id, body: "" } : parseRoutineFile(text, r.id)),
      };
    }),
  };
}

/**
 * Everything a change to a staff member's schedule writes, worked out before anything is.
 *
 * Three kinds of file move together: staff.yaml (the times), routines/<id>.md (what to do) and
 * the daily caller (the crons GitHub actually fires on). The caller is rendered from the edited
 * manifest by the same template `hire` and `upgrade` use, so the three cannot disagree.
 *
 * `session` is the ops repo's session.yaml as it is now. A caller that passes `routine` to a
 * session workflow that does not declare it fails every run, so an ops repo that has not been
 * upgraded yet is refused rather than broken.
 */
export function planSchedule(opts: {
  manifest: string;
  parseYaml: ParseYaml;
  dir: string;
  org: OrgSpec;
  next: Schedule;
  /** What the brain holds now, path to text, for the files this could touch. */
  current: (path: string) => string | undefined;
  session: string;
}): { errors: string[]; changes: FileChange[] } {
  const errors = checkRoutines(opts.next.daily, opts.next.routines);
  if (opts.next.routines.length && !/^\s+routine:\s*$/m.test(opts.session)) {
    errors.push(
      "the ops repo's session workflow is older than routines. Run `roster upgrade --apply` and push the ops repo first.",
    );
  }
  if (errors.length) return { errors, changes: [] };

  const before = opts.parseYaml(opts.manifest, "staff.yaml") as Record<string, any>;
  const manifest = setRoutinesInManifest(
    setDailyInManifest(opts.manifest, opts.next.daily),
    opts.next.routines.map((r) => ({ id: r.id, schedule: r.schedule })),
  );
  const spec = specFromManifest(opts.parseYaml(manifest, "staff.yaml"), opts.dir);
  const tokens = tokensFor(opts.org, spec);
  const caller = render(
    readFileSync(join(brainTemplateDir(), DAILY_TEMPLATE), "utf8"),
    tokens,
    DAILY_TEMPLATE,
  );

  const want: FileChange[] = [
    { path: "staff.yaml", text: manifest },
    ...opts.next.routines.map((r) => ({ path: routinePath(r.id), text: routineFile(r) })),
    ...routinesOf(before)
      .filter((r) => !opts.next.routines.some((n) => n.id === r.id))
      .map((r) => ({ path: routinePath(r.id), text: null })),
    { path: render(DAILY_TEMPLATE, tokens), text: caller },
  ];
  const changes = want.filter((c) => {
    const have = opts.current(c.path);
    return c.text === null ? have !== undefined : have !== c.text;
  });
  return { errors: [], changes };
}
