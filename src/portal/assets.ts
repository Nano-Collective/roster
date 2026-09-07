import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The portal UI is real files rather than template literals, so they can be opened, edited
 * and diffed like a page instead of like escaped strings.
 *
 * It was one 2,100-line HTML file until the CSS and the seven screens grew past the point
 * where any of them could be found. Now it is a shell, eight stylesheets and a dozen ES
 * modules, served from here. Still no build step: the browser resolves the module graph, so
 * editing a file and reloading is the whole edit loop.
 *
 * Resolved at run time because the bundled entry point lives in dist/ while the templates
 * sit beside it in the published package.
 */
function portalDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "..", "..", "templates", "portal"), // src/portal → package root
    join(here, "..", "templates", "portal"), // dist → package root
  ];
  for (const path of candidates) if (existsSync(join(path, "index.html"))) return path;
  throw new Error(`portal UI not found. Looked in:\n  ${candidates.join("\n  ")}`);
}

/* Read per request, not once at import. The portal is a local server over local files, and
   paying a file read to make "edit a stylesheet, hit reload" work is the right trade. */
export function portalIndex(): string {
  return readFileSync(join(portalDir(), "index.html"), "utf8");
}

const ASSET_MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

/**
 * One file out of the portal's own assets.
 *
 * `rel` arrives off a URL, so it is not trusted: only the extensions the UI actually uses
 * are served, and the resolved path must still be inside the asset directory. Without that
 * second check a crafted path walks straight out of it.
 */
export function portalAsset(rel: string): { body: Buffer; type: string } | null {
  const root = portalDir();
  const full = resolve(root, rel);
  if (!full.startsWith(resolve(root) + "/")) return null;
  const type = ASSET_MIME[extname(full).toLowerCase()];
  if (!type) return null;
  if (!existsSync(full) || statSync(full).isDirectory()) return null;
  return { body: readFileSync(full), type };
}
