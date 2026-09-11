/* Colour for YAML.
 *
 * `org.yaml` and `staff.yaml` are the two files here a person actually reads closely, and they
 * were served as one flat grey wall: the comments, the keys and the values all the same weight,
 * so finding `mention_timeout_minutes` meant reading every line. Structure is the thing YAML has
 * and prose does not, and showing it costs about eighty lines.
 *
 * Deliberately not a parser. It is a per-line tokeniser that knows comments, keys, quoted
 * strings, numbers and the three keywords — enough to read by, and it cannot fail on a file it
 * does not understand, because anything it does not recognise is left as plain text.
 */

import { el, esc } from "./dom.js";

/** A `<pre>` holding the highlighted source. */
export function yamlPre(text, className = "code yaml") {
  const pre = el("pre", { className });
  pre.innerHTML = yamlHTML(text);
  return pre;
}

/** Escaped, highlighted HTML. Takes raw text: it does its own escaping. */
export function yamlHTML(text) {
  return String(text ?? "")
    .split("\n")
    .map(colourLine)
    .join("\n");
}

/**
 * The same, for text that is already HTML-escaped.
 *
 * The markdown renderer escapes a fenced block before it knows what language it is, and
 * un-escaping four entities to escape them again is exact and cheaper than restructuring
 * the renderer around one case.
 */
export function yamlHTMLFromEscaped(escaped) {
  return yamlHTML(
    String(escaped ?? "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, "&"),
  );
}

const span = (cls, text) => '<span class="' + cls + '">' + esc(text) + "</span>";

function colourLine(raw) {
  const [code, comment] = splitComment(raw);
  return (code ? colourCode(code) : "") + (comment ? span("yc", comment) : "");
}

/**
 * Split a trailing comment off, without cutting a `#` that is inside a string.
 *
 * `marker: will   # the provenance tag` is a comment; `name: "a # b"` is not. YAML also only
 * starts a comment at the beginning of a line or after whitespace, which is what keeps a
 * `#hashtag` in a value intact.
 */
function splitComment(raw) {
  let quote = null;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (quote) {
      if (c === quote && raw[i - 1] !== "\\") quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === "#" && (i === 0 || /\s/.test(raw[i - 1]))) return [raw.slice(0, i), raw.slice(i)];
  }
  return [raw, ""];
}

const DOC = /^\s*(---|\.\.\.)\s*$/;
/** Indent, then any run of list dashes: `  - - name: x` is two levels of list. */
const LEAD = /^(\s*)((?:-\s+)*)/;
/** A key is everything up to the first colon that is followed by a space or the end of line. */
const KEY = /^([^\s"'#][^:]*?)(:)(\s|$)/;

function colourCode(code) {
  if (DOC.test(code)) return span("yp", code);

  const lead = LEAD.exec(code);
  const indent = lead[1];
  const dashes = lead[2];
  let rest = code.slice(indent.length + dashes.length);
  let out = indent + (dashes ? span("yd", dashes) : "");

  /* A line that opens a flow collection has no key of its own: `- { handle: cto }` is a list
     item whose keys are all inside the braces, and taking "{ handle" for a key marked the
     brace as part of the name. */
  const key = /^[{[]/.test(rest) ? null : KEY.exec(rest);
  if (key) {
    out += span("yk", key[1]) + span("yp", key[2]) + key[3];
    rest = rest.slice(key[1].length + 1 + key[3].length);
  }
  return out + colourValue(rest);
}

/* Strings, inline-map keys, the three keywords, numbers, and the punctuation that holds a flow
   collection together. Ordered: a quoted string wins over everything inside it. */
const TOKEN = new RegExp(
  [
    /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/, // 1 quoted string
    /([A-Za-z_][\w.-]*)(\s*:)(?=\s|$)/, // 2,3 a key inside an inline map
    /(\b(?:true|false|null|yes|no|on|off)\b|~)/, // 4 keywords
    /(-?\d+(?:\.\d+)?\b)/, // 5 numbers
    /([{}[\],])/, // 6 flow punctuation
  ]
    .map((r) => r.source)
    .join("|"),
  "g",
);

function colourValue(value) {
  if (!value) return "";
  let out = "";
  let at = 0;
  TOKEN.lastIndex = 0;
  for (let m = TOKEN.exec(value); m; m = TOKEN.exec(value)) {
    out += esc(value.slice(at, m.index));
    if (m[1]) out += span("ys", m[1]);
    else if (m[2]) out += span("yk", m[2]) + span("yp", m[3]);
    else if (m[4]) out += span("yb", m[4]);
    else if (m[5]) out += span("yn", m[5]);
    else out += span("yp", m[6]);
    at = m.index + m[0].length;
  }
  return out + esc(value.slice(at));
}
