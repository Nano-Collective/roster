/**
 * How to spell a roster command back to the person who ran this one.
 *
 * The docs and every message here said `roster upgrade`, but the first run, and for many people
 * every run, is `npx @nanocollective/roster`, which puts no `roster` on the PATH. A command
 * printed as advice has to be one that works when pasted.
 */

// @latest, because npx will otherwise reuse whatever version it cached last time.
const NPX = "npx @nanocollective/roster@latest";

/** `roster`, or the npx spelling when this process was started through npx. */
export function bin(env: NodeJS.ProcessEnv = process.env, argv1 = process.argv[1] ?? ""): string {
  if (env.ROSTER_BIN) return env.ROSTER_BIN;
  // npm 7+ runs npx as `npm exec`, and installs the package under an `_npx` cache directory.
  if (env.npm_command === "exec" || /[\\/]_npx[\\/]/.test(argv1)) return NPX;
  return "roster";
}

const COMMAND =
  /\broster(?= (?:init|hire|app|credential|run|doctor|fix|portal|prompt|upgrade|retire|lint|brief|export|help)\b)/g;

/** Rewrite `roster <command>` in text shown to a person, so it can be pasted as is. */
export function withBin(text: string, name = bin()): string {
  return name === "roster" ? text : text.replace(COMMAND, name);
}

/**
 * Everything the CLI prints goes through here once, rather than each of a hundred messages
 * choosing its own spelling.
 */
export function rewriteOutput(name = bin()): (text: string) => void {
  const raw = process.stdout.write.bind(process.stdout);
  if (name === "roster") return (text) => void raw(text);
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream) as (chunk: unknown, ...rest: unknown[]) => boolean;
    stream.write = ((chunk: unknown, ...rest: unknown[]) =>
      write(
        typeof chunk === "string" ? withBin(chunk, name) : chunk,
        ...rest,
      )) as typeof stream.write;
  }
  // For text laid out in columns, where a long prefix on every line would wreck the alignment.
  return (text) => void raw(text);
}
