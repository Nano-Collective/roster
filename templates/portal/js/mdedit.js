/* Colour behind a textarea, for the files people edit here.
 *
 * The textarea stays the thing you type into, so undo, selection, spellcheck and ⌘S all work
 * as they always did. Its text is made transparent and a <pre> with the same box sits behind
 * it, redrawn on every keystroke. The editors grow to fit rather than scroll, which is what
 * keeps the two lined up without syncing a scroll position.
 *
 * Markdown here is a per-line tokeniser, like yaml.js: enough to read by, and anything it does
 * not recognise is plain text rather than an error.
 */

import { el, esc } from "./dom.js";
import { yamlHTML } from "./yaml.js";

/**
 * Wrap a textarea so its contents are highlighted. Returns the wrapper, which is what goes on
 * the page in place of the textarea.
 * @param {"md"|"yaml"} lang
 */
export function highlighted(ta, lang = "md") {
  const wrap = el("div", { className: "hled" });
  const back = el("pre", { className: "hlback" });
  back.setAttribute?.("aria-hidden", "true");
  ta.classList?.add("hlfront");
  wrap.append(back, ta);
  /* The colours only line up if both boxes set text identically, and the textarea's box comes
     from whichever class it already had, so it is read rather than restated in CSS. */
  const match = () => {
    if (typeof getComputedStyle !== "function" || !ta.isConnected) return;
    const cs = getComputedStyle(ta);
    for (const k of ["font", "lineHeight", "letterSpacing", "tabSize", "padding", "borderWidth", "borderStyle", "borderRadius"]) {
      back.style[k] = cs[k];
    }
  };
  const paint = () => {
    match();
    // A trailing newline in a textarea is a line; in a <pre> it is not, without something after it.
    back.innerHTML = (lang === "yaml" ? yamlHTML(ta.value) : markdownHTML(ta.value)) + "\n ";
  };
  ta.addEventListener("input", paint);
  paint();
  // Setting .value from code fires no input event, so the owner can ask for a repaint.
  wrap.repaint = paint;
  return wrap;
}

/** Escaped, highlighted HTML for markdown source. */
export function markdownHTML(text) {
  let fenced = false;
  return String(text ?? "")
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        return span("mdfence", line);
      }
      if (fenced) return span("mdcode", line);
      if (/^#{1,6}\s/.test(line)) return span("mdh", line);
      if (/^\s*>/.test(line)) return span("mdq", line);
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) return span("mdfence", line);
      const list = /^(\s*)([-*+]|\d+[.)])(\s+)(.*)$/.exec(line);
      if (list) return esc(list[1]) + span("mdl", list[2]) + esc(list[3]) + inline(list[4]);
      return inline(line);
    })
    .join("\n");
}

const span = (cls, text) => '<span class="' + cls + '">' + esc(text) + "</span>";

/** Inline marks, on one line. Code spans first, so nothing inside one is read as markup. */
function inline(line) {
  return line
    .split(/(`[^`]+`)/)
    .map((part, i) => (i % 2 ? span("mdc", part) : marks(part)))
    .join("");
}

function marks(text) {
  return esc(text)
    .replace(/\{\{[^}]*\}\}/g, (m) => '<span class="mdt">' + m + "</span>")
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '<span class="mdb">$1$2$1</span>')
    .replace(/(^|[^*\w])([*_])(?=\S)([^*_]+?)(?<=\S)\2(?![*\w])/g, '$1<span class="mdi">$2$3$2</span>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<span class="mdk">[$1]</span><span class="mdu">($2)</span>');
}
