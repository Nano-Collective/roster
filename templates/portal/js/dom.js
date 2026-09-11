/* The handful of DOM helpers every view uses. No framework: the portal is a few thousand
   lines of rendering over a JSON export, and a build step would cost more than it saves. */

export const $ = (s, r = document) => r.querySelector(s);

export const el = (t, props = {}, kids = []) => {
  const n = Object.assign(document.createElement(t), props);
  for (const k of [].concat(kids)) n.append(k);
  return n;
};

export const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

export function ago(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return "just now";
  if (s < 5400) return Math.round(s / 60) + "m ago";
  if (s < 172800) return Math.round(s / 3600) + "h ago";
  return Math.round(s / 86400) + "d ago";
}

export const kb = (n) =>
  n < 1024 ? n + "b" : n < 1048576 ? Math.round(n / 1024) + "k" : (n / 1048576).toFixed(1) + "M";

/** Rows are `.tfile` in a file tree and `.irow` in the inbox. Matching only one of them is
    how every clicked row stayed selected. */
export function markCurrent(list, btn) {
  for (const o of list.querySelectorAll('[aria-current="true"]')) {
    o.setAttribute("aria-current", "false");
  }
  btn.setAttribute("aria-current", "true");
}

/**
 * Placeholder shapes, for the seconds a screen spends asking GitHub.
 *
 * The inbox reads every repo in the org, which is several seconds on a cold cache, and what
 * stood there meanwhile was the word "Asking GitHub…" in an otherwise empty box beside an
 * empty box. Nothing about that says the shape of what is coming, so the page looked broken
 * rather than busy.
 *
 * `kind` names the shape: "row" for a list item, "line" for a paragraph, "head" for a title.
 * They are decorative, so they are hidden from assistive technology and the live region
 * elsewhere on the screen does the announcing.
 */
export function skeleton(kind, n = 1) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const box = el("div", { className: "sk sk-" + kind });
    box.setAttribute("aria-hidden", "true");
    if (kind === "row") {
      box.append(el("div", { className: "skbar t" }), el("div", { className: "skbar m" }));
    }
    out.push(box);
  }
  return out;
}

export function store(k, v) {
  try {
    return v === undefined ? localStorage.getItem(k) : localStorage.setItem(k, v);
  } catch {
    return null;
  }
}

/** GitHub's heading slug, for in-page anchors. */
export function slug(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/**
 * Size a textarea to its content, so the card it sits in is the only thing that scrolls.
 *
 * The border has to be added back: everything here is `border-box`, so `height` sets the
 * outer box while `scrollHeight` counts the padding and not the border. Two pixels short is
 * enough to clip the last line.
 */
export function grow(ta) {
  ta.style.height = "auto";
  const border = (ta.offsetHeight || 0) - (ta.clientHeight || 0);
  ta.style.height = (ta.scrollHeight || 0) + border + "px";
}

/**
 * Put text on the clipboard and say so on the button that asked.
 *
 * `navigator.clipboard` needs a secure context, and http://localhost counts, but a portal
 * bound to a LAN address does not. The textarea fallback is what makes the button work there
 * rather than failing silently, which for a copy button is the worst outcome: you paste the
 * last thing you copied and never notice.
 */
export async function toClipboard(text, btn, label) {
  const said = (msg) => {
    if (!btn) return;
    btn.textContent = msg;
    setTimeout(() => {
      btn.textContent = label;
    }, 2200);
  };
  try {
    await navigator.clipboard.writeText(text);
    said("copied · " + Math.round(text.length / 1000) + "k");
    return true;
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    said(ok ? "copied" : "could not copy");
    return ok;
  } catch {
    said("could not copy");
    return false;
  }
}
