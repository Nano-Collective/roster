import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

/**
 * A `gh` on PATH that answers from a table, so the online half of a command can be tested
 * without the network, an account, or anybody's org.
 *
 * It is a real executable rather than a mocked module because roster shells out to the
 * human's own `gh`; faking at the process boundary exercises the argument building, the JSON
 * parsing and the error tidying that a module mock would skip.
 *
 * A route matches when its regex matches the arguments joined by spaces. First match wins.
 * Anything unmatched fails the way gh does for a missing resource, so a test that forgets a
 * route sees a 404 finding rather than a pass.
 */
export interface Route {
  match: RegExp;
  /** Printed as JSON unless it is already a string. */
  stdout?: unknown;
  /** gh's own error output; a non-zero exit is implied. */
  stderr?: string;
}

export interface FakeGh {
  /** Every invocation so far, as its argument list. */
  calls(): string[][];
  restore(): void;
}

const SCRIPT = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const here = __dirname;
fs.appendFileSync(path.join(here, "calls.jsonl"), JSON.stringify(args) + "\\n");
const routes = JSON.parse(fs.readFileSync(path.join(here, "routes.json"), "utf8"));
const line = args.join(" ");
for (const r of routes) {
  if (!new RegExp(r.match).test(line)) continue;
  if (r.stderr !== undefined) {
    process.stderr.write(r.stderr + "\\n");
    process.exit(1);
  }
  process.stdout.write(r.stdout ?? "");
  process.exit(0);
}
process.stderr.write('gh: Not Found (HTTP 404)\\n{"message":"Not Found"}\\n');
process.exit(1);
`;

export function fakeGh(routes: Route[]): FakeGh {
  const dir = mkdtempSync(join(tmpdir(), "roster-fakegh-"));
  writeFileSync(
    join(dir, "routes.json"),
    JSON.stringify(
      routes.map((r) => ({
        match: r.match.source,
        stdout:
          r.stdout === undefined || typeof r.stdout === "string"
            ? r.stdout
            : JSON.stringify(r.stdout),
        stderr: r.stderr,
      })),
    ),
  );
  const bin = join(dir, "gh");
  writeFileSync(bin, SCRIPT);
  chmodSync(bin, 0o755);

  const before = process.env.PATH;
  process.env.PATH = dir + delimiter + (before ?? "");

  return {
    calls() {
      const log = join(dir, "calls.jsonl");
      if (!existsSync(log)) return [];
      return readFileSync(log, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as string[]);
    },
    restore() {
      process.env.PATH = before;
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Swallow a command's report while it runs, and hand back what it wrote. */
export async function quietly<T>(
  fn: () => Promise<T>,
): Promise<{ value: T; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const write = { out: process.stdout.write, err: process.stderr.write };
  /* Only strings are captured. The test runner reports from this same process over stdout in
     binary chunks, and swallowing one of those loses a result rather than some noise. */
  const capture =
    (into: string[], stream: NodeJS.WriteStream, original: typeof process.stdout.write) =>
    (chunk: unknown, ...rest: unknown[]) => {
      if (typeof chunk !== "string") {
        return (original as (...a: unknown[]) => boolean).call(stream, chunk, ...rest);
      }
      into.push(chunk);
      return true;
    };
  process.stdout.write = capture(out, process.stdout, write.out) as typeof process.stdout.write;
  process.stderr.write = capture(err, process.stderr, write.err) as typeof process.stderr.write;
  try {
    const value = await fn();
    return { value, out: out.join(""), err: err.join("") };
  } finally {
    process.stdout.write = write.out;
    process.stderr.write = write.err;
  }
}
