import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";

/**
 * A file dropped onto an issue, put somewhere an agent can actually read it.
 *
 * GitHub has no public endpoint for the attachments you get by dragging a file into the
 * comment box — those are minted by the web app and cannot be reproduced by `gh`. So the
 * portal does the thing that is better for this org anyway: it commits the file into the
 * repo the issue lives in and links to it. Every run clones that repo, so a screenshot in an
 * issue is a path the model can open rather than a URL it would have to be given a token for.
 *
 * Deliberately small: one file, one commit, pushed. A failed push is reported rather than
 * hidden, because a link to a blob that only exists locally is worse than no link.
 */

export interface Attached {
  /** Where it landed inside the repo. This is the bit an agent reads. */
  path: string;
  /** The same file on GitHub, for the person reading the issue. */
  url: string;
  bytes: number;
  pushed: boolean;
  /** Why the push did not happen, when it did not. */
  note?: string;
}

/** 25MB. Git is not a blob store, and the reason to say so is at the moment of upload. */
export const MAX_UPLOAD = 25 * 1024 * 1024;

export const ATTACH_DIR = "attachments";

/**
 * Land `data` in `repoDir` under `attachments/`, commit it, push it.
 *
 * `repo` is `owner/name`, used only to build the link. `today` is passed in so the caller
 * owns the clock.
 */
export function attach(opts: {
  repoDir: string;
  repo: string;
  name: string;
  data: Buffer;
  today: string;
}): Attached {
  const { repoDir, repo, data, today } = opts;
  if (!existsSync(join(repoDir, ".git"))) {
    throw new Error(`${repo} is not checked out here, so there is nowhere to put the file`);
  }
  if (!data.length) throw new Error("that file is empty");
  if (data.length > MAX_UPLOAD) {
    throw new Error(`${basename(opts.name)} is larger than ${MAX_UPLOAD / 1024 / 1024}MB`);
  }

  const rel = free(repoDir, `${ATTACH_DIR}/${today}-${safeName(opts.name)}`);
  const full = join(repoDir, rel);
  mkdirSync(join(repoDir, ATTACH_DIR), { recursive: true });
  writeFileSync(full, data);

  const git = (args: string[]) =>
    execFileSync("git", ["-C", repoDir, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

  try {
    git(["add", "--", rel]);
    git(["commit", "-m", `portal: attach ${rel}`, "--", rel]);
  } catch (err) {
    throw new Error(`commit failed: ${short(err)}`);
  }

  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  const url = `https://github.com/${repo}/blob/${branch}/${rel.split("/").map(encodeURIComponent).join("/")}`;

  try {
    git(["push"]);
  } catch (err) {
    return { path: rel, url, bytes: data.length, pushed: false, note: short(err) };
  }
  return { path: rel, url, bytes: data.length, pushed: true };
}

/**
 * A file name that cannot be anything but a file name.
 *
 * Everything here arrives from a browser, so the name is not trusted: any directory part is
 * dropped and what is left is reduced to the characters a path can hold without quoting.
 */
function safeName(raw: string): string {
  const name = basename(String(raw ?? "")).replace(/^\.+/, "");
  const ext = extname(name).toLowerCase().slice(0, 12);
  const stem =
    name
      .slice(0, name.length - extname(name).length)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "file";
  return stem + ext.replace(/[^a-z0-9.]/g, "");
}

/** The same name twice in a day should not overwrite yesterday's evidence. */
function free(repoDir: string, rel: string): string {
  if (!existsSync(join(repoDir, rel))) return rel;
  const ext = extname(rel);
  const stem = rel.slice(0, rel.length - ext.length);
  for (let n = 2; n < 500; n++) {
    const next = `${stem}-${n}${ext}`;
    if (!existsSync(join(repoDir, next))) return next;
  }
  throw new Error("too many files by that name today");
}

function short(e: unknown): string {
  const msg = e instanceof Error ? (e as any).stderr?.toString() || e.message : String(e);
  const line = msg.split("\n").find((l: string) => l.trim()) ?? msg;
  return line.length > 200 ? `${line.slice(0, 199)}…` : line;
}
