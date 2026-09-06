import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Who owns a generated file, which is the whole question `roster upgrade` answers.
 *
 * `managed`  the framework owns it. The tenant is not meant to edit it, and an edit here is
 *            usually a fix applied in the wrong place — it will be fought over on every
 *            upgrade until it moves into the framework.
 * `seeded`   the framework hands over a starting point and the tenant makes it theirs. Local
 *            edits are the point, so these get a real three-way merge.
 *
 * The split is the one the design doc already draws inside the ops repo: `org/` is the
 * tenant's business truth, `prompts/` is theirs to override, and everything else is machinery.
 */
export type TemplateClass = "managed" | "seeded";

export function classify(rel: string): TemplateClass {
  return rel.startsWith("org/") || rel.startsWith("prompts/") ? "seeded" : "managed";
}

/**
 * The framework's own templates, resolved at run time: the bundled entry point lives in
 * dist/ while the templates sit beside it in the published package.
 */
export function templatesRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "..", "templates"), // src/lib → package root
    join(here, "..", "templates"), // dist → package root
  ];
  for (const path of candidates) if (existsSync(path)) return path;
  throw new Error(`roster templates not found. Looked in:\n  ${candidates.join("\n  ")}`);
}

/** Every file under a template directory, as paths relative to it. Dotfiles included: the
 *  reusable workflow lives under `.github/`, and missing it is how it got lost before. */
export function templateFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      if (name === ".DS_Store") continue;
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(root, full));
    }
  };
  walk(root);
  return out;
}

/** The template set a tenant's ops repo is generated from. */
export function opsTemplateDir(): string {
  return join(templatesRoot(), "ops");
}
