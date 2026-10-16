import * as fs from "node:fs";

/**
 * `node:fs`, plus directories that are not on disk.
 *
 * Most of what the portal knows about an org it learns by reading files: org.yaml, a staff
 * member's manifest, their memory, their prompts. That code was written against a checkout, and
 * it is right — it is the same parsing the CLI does. What changes for a portal with no checkout is
 * only where the bytes come from, so this is the one place that changes: a GitHub snapshot is
 * *mounted* at a path, and the same `readFileSync` that reads a working tree reads it.
 *
 * Anything outside a mount goes straight to `node:fs`, so the CLI, which mounts nothing, behaves
 * exactly as it did. Only the four calls the readers use are here; writes are never virtual.
 */
export interface VirtualFile {
  size: number;
  mtime: Date;
  /** The body, when it was kept. A file without one exists and has a size, and is fetched on demand. */
  text?: string;
}

export interface VirtualTree {
  /** A file at a path relative to the mount, or undefined. */
  file(rel: string): VirtualFile | undefined;
  /** The names directly inside a directory relative to the mount ("" is the top), or undefined. */
  dir(rel: string): string[] | undefined;
}

const mounts = new Map<string, VirtualTree>();

function normPath(p: string): string {
  return String(p)
    .replaceAll("\\", "/")
    .replace(/^[A-Za-z]:/, "");
}

/** Serve `tree` at `prefix`, replacing whatever was there. `prefix` is absolute, no trailing slash. */
export function mount(prefix: string, tree: VirtualTree): void {
  mounts.set(normPath(prefix).replace(/\/+$/, ""), tree);
}

function lookup(path: string): { tree: VirtualTree; rel: string } | null {
  if (!mounts.size) return null;
  const p = normPath(path).replace(/\/+$/, "");
  for (const [prefix, tree] of mounts) {
    if (p === prefix) return { tree, rel: "" };
    if (p.startsWith(`${prefix}/`)) return { tree, rel: p.slice(prefix.length + 1) };
  }
  return null;
}

function missing(path: string, syscall: string): NodeJS.ErrnoException {
  const err: NodeJS.ErrnoException = new Error(
    `ENOENT: no such file or directory, ${syscall} '${path}'`,
  );
  err.code = "ENOENT";
  err.path = path;
  err.syscall = syscall;
  return err;
}

export function existsSync(path: fs.PathLike): boolean {
  const hit = lookup(String(path));
  if (!hit) return fs.existsSync(path);
  return hit.tree.file(hit.rel) !== undefined || hit.tree.dir(hit.rel) !== undefined;
}

export function readFileSync(path: fs.PathOrFileDescriptor): Buffer;
export function readFileSync(
  path: fs.PathOrFileDescriptor,
  options: BufferEncoding | { encoding: BufferEncoding; flag?: string },
): string;
export function readFileSync(
  path: fs.PathOrFileDescriptor,
  options?: BufferEncoding | { encoding: BufferEncoding; flag?: string },
): string | Buffer {
  const hit = typeof path === "number" ? null : lookup(String(path));
  if (!hit) return options ? fs.readFileSync(path, options) : fs.readFileSync(path);
  const file = hit.tree.file(hit.rel);
  if (!file) throw missing(String(path), "open");
  if (file.text === undefined) {
    const err: NodeJS.ErrnoException = new Error(
      `${String(path)} is too large to hold in memory; open it from its own page`,
    );
    err.code = "EFBIG";
    throw err;
  }
  return options ? file.text : Buffer.from(file.text, "utf8");
}

export function readdirSync(path: fs.PathLike): string[] {
  const hit = lookup(String(path));
  if (!hit) return fs.readdirSync(path) as string[];
  const names = hit.tree.dir(hit.rel);
  if (!names) throw missing(String(path), "scandir");
  return [...names].sort();
}

export interface Stat {
  size: number;
  mtime: Date;
  isDirectory(): boolean;
  isFile(): boolean;
}

export function statSync(path: fs.PathLike): Stat {
  const hit = lookup(String(path));
  if (!hit) return fs.statSync(path);
  const file = hit.tree.file(hit.rel);
  if (file)
    return { size: file.size, mtime: file.mtime, isDirectory: () => false, isFile: () => true };
  if (hit.tree.dir(hit.rel)) {
    return { size: 0, mtime: new Date(0), isDirectory: () => true, isFile: () => false };
  }
  throw missing(String(path), "stat");
}

/** A tree from a flat map of path to text, for files carried in code rather than on disk. */
export function treeOf(files: Record<string, string>, mtime = new Date(0)): VirtualTree {
  const dirs = new Map<string, Set<string>>([["", new Set()]]);
  for (const path of Object.keys(files)) {
    const parts = path.split("/");
    let dir = "";
    for (const name of parts) {
      if (!dirs.has(dir)) dirs.set(dir, new Set());
      dirs.get(dir)!.add(name);
      dir = dir ? `${dir}/${name}` : name;
    }
  }
  return {
    file: (rel) => {
      const text = files[rel];
      return text === undefined ? undefined : { size: Buffer.byteLength(text), mtime, text };
    },
    dir: (rel) => {
      const names = dirs.get(rel);
      return names && !(rel in files) ? [...names] : undefined;
    },
  };
}
