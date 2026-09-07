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
