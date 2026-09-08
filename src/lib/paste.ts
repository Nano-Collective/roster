import { looksUnwritten } from "./stub.js";

/**
 * Getting a file back out of a chat window.
 *
 * You copy a brief, paste it into whatever you use, and paste the answer back here. That last
 * step is the one with no obvious mechanism: the model has no filesystem, so what comes back is
 * a message, and a message has to be turned into a file safely.
 *
 * The rules are all forgiving in the same direction. A model will add "Here's your charter!",
 * wrap things in fences, and explain itself afterwards. None of that is an error. What is an
 * error is not being able to tell which bytes are the file.
 */

/** What a brief asks for back, and what the paste is checked against. */
export interface PasteTarget {
  /** Workspace-relative, e.g. `roster-ops/org/business.md`. */
  path: string;
  /** The text on disk now, so an unchanged paste can be reported as unchanged. */
  before: string;
}

export interface PastedFile {
  path: string;
  text: string;
  /** Identical to what is already on disk. Worth saying: it means the model echoed the input. */
  unchanged: boolean;
}

export interface PasteProblem {
  /** Stable, so the UI can attach its own wording and a retry button. */
  id: "no-envelope" | "unknown-path" | "stub-echoed" | "brief-echoed" | "too-short" | "empty";
  message: string;
  /** What to say to the model to get a better answer. Empty when there is nothing to retry. */
  retry: string;
  path?: string;
}

export interface PasteResult {
  files: PastedFile[];
  problems: PasteProblem[];
}

/**
 * The envelope a brief asks the model to use.
 *
 * Sentinels rather than code fences, because fences cannot survive the content: a charter and
 * a business.md both legitimately contain fenced examples, and `lib/amend.ts` already carries a
 * helper that computes a fence longer than anything inside the text for exactly this reason.
 * A sentinel on its own line has no such problem.
 */
export const BEGIN = (path: string) => `<<<ROSTER FILE ${path}>>>`;
export const END = "<<<ROSTER END>>>";

const BLOCK = /^[ \t]*<<<ROSTER FILE ([^>\n]+)>>>[ \t]*\n([\s\S]*?)\n?[ \t]*<<<ROSTER END>>>/gm;

/** A file this short is a failure however plausible it reads. */
const MIN_WORDS = 40;

export function parsePaste(raw: string, targets: PasteTarget[]): PasteResult {
  const files: PastedFile[] = [];
  const problems: PasteProblem[] = [];
  const text = raw.replace(/\r\n/g, "\n");

  if (!text.trim()) {
    return {
      files,
      problems: [{ id: "empty", message: "Nothing was pasted.", retry: "" }],
    };
  }

  const known = new Map(targets.map((t) => [t.path, t]));

  BLOCK.lastIndex = 0;
  for (const m of text.matchAll(BLOCK)) {
    const path = m[1]!.trim();
    const body = strip(m[2] ?? "");
    const target = known.get(path);

    if (!target) {
      problems.push({
        id: "unknown-path",
        path,
        message: `The answer writes ${path}, which this brief did not ask for.`,
        retry: `Write only ${[...known.keys()].join(", ")}, using the sentinels exactly as given.`,
      });
      continue;
    }

    files.push({
      path,
      text: ensureNewline(body),
      unchanged: body.trim() === target.before.trim(),
    });
  }

  if (!files.length && !problems.length) {
    problems.push({
      id: "no-envelope",
      message:
        "Your AI answered in prose. The reply has no <<<ROSTER FILE ...>>> block, so there is " +
        "nothing here that can be saved as a file.",
      retry:
        "Send that again as the finished file only, wrapped exactly like this and with nothing " +
        `outside it:\n\n${BEGIN(targets[0]?.path ?? "<path>")}\n...the whole file...\n${END}`,
    });
  }

  for (const file of files) {
    const words = file.text.split(/\s+/).filter(Boolean).length;

    if (file.unchanged) {
      problems.push({
        id: "brief-echoed",
        path: file.path,
        message: `${file.path} came back byte for byte. Some models restate a long prompt before working.`,
        retry: "That is the file I sent you. Write the new version.",
      });
      continue;
    }

    if (words < MIN_WORDS) {
      problems.push({
        id: "too-short",
        path: file.path,
        message: `${file.path} is ${words} words. That is a failed answer, not a short one.`,
        retry: "That is far too short. Interview me properly first, then write the whole file.",
      });
      continue;
    }

    if (looksUnwritten(file.text)) {
      problems.push({
        id: "stub-echoed",
        path: file.path,
        message: `${file.path} still carries the scaffold's own headings, so the questions were never answered.`,
        retry:
          "You returned the template with its instructions still in it. Answer the questions and " +
          "write the real file, with none of the scaffold's guidance left in it.",
      });
    }
  }

  return { files, problems };
}

/**
 * A model that is told to return a bare file will still sometimes fence the whole thing. One
 * layer comes off; anything deeper is content, because a file that opens with two fences is a
 * file about fences.
 */
function strip(body: string): string {
  const trimmed = body.replace(/^\n+/, "").replace(/\s+$/, "");
  const fenced = /^(`{3,}|~{3,})[^\n]*\n([\s\S]*)\n\1\s*$/.exec(trimmed);
  return fenced ? fenced[2]! : trimmed;
}

function ensureNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}
