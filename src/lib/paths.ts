import { isAbsolute, relative, sep } from "node:path";

/**
 * Paths as roster names them: forward slashes, whatever the platform.
 *
 * A path relative to a repo is also a key — in a snapshot, in a template list, in what the portal
 * sends back to save — and those are compared with "/" everywhere. On Windows `path.relative`
 * answers with backslashes, so every comparison quietly failed there.
 */
export function posix(p: string): string {
  return sep === "/" ? p : p.split(sep).join("/");
}

/** `full` is inside `root` (and is not `root` itself), on any platform. */
export function inside(root: string, full: string): boolean {
  const rel = relative(root, full);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}
