/* Icons.
 *
 * Lucide glyphs (lucide.dev, ISC), vendored as path data rather than pulled from
 * a CDN or a font. The portal is local-first and offline, so an icon that needs the network
 * is an icon that is sometimes a blank square.
 *
 * This replaces the arrow-and-lozenge characters the UI used to draw with. Those were never
 * icons: they are text, they render differently on every platform, half of them fall back to
 * a box in the wrong font, and none of them line up with a baseline.
 *
 * They inherit `currentColor` and size from the `--ic` custom property, so a caller sets
 * colour and size in CSS and never touches the SVG.
 */

const PATHS = {
  "check":
    "<path d=\"M20 6 9 17l-5-5\" />",
  "chevron":
    "<path d=\"m6 9 6 6 6-6\" />",
  "close":
    "<path d=\"M18 6 6 18\" /> <path d=\"m6 6 12 12\" />",
  "closed":
    "<circle cx=\"12\" cy=\"12\" r=\"10\" /> <path d=\"m15 9-6 6\" /> <path d=\"m9 9 6 6\" />",
  "commit":
    "<circle cx=\"12\" cy=\"12\" r=\"3\" /> <line x1=\"3\" x2=\"9\" y1=\"12\" y2=\"12\" /> <line x1=\"15\" x2=\"21\" y1=\"12\" y2=\"12\" />",
  "crossref":
    "<path d=\"M7 7h10v10\" /> <path d=\"M7 17 17 7\" />",
  "dash":
    "<path d=\"M5 12h14\" />",
  "docs":
    "<path d=\"M12 5v16\" /> <path d=\"M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z\" />",
  "dot":
    "<circle cx=\"12\" cy=\"12\" r=\"1\" />",
  "draft":
    "<circle cx=\"18\" cy=\"18\" r=\"3\" /> <circle cx=\"6\" cy=\"6\" r=\"3\" /> <path d=\"M18 6V5\" /> <path d=\"M18 11v-1\" /> <line x1=\"6\" x2=\"6\" y1=\"9\" y2=\"21\" />",
  "edit":
    "<path d=\"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z\" /> <path d=\"m15 5 4 4\" />",
  "file":
    "<path d=\"M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z\" /> <path d=\"M14 2v5a1 1 0 0 0 1 1h5\" /> <path d=\"M10 9H8\" /> <path d=\"M16 13H8\" /> <path d=\"M16 17H8\" />",
  "gallery":
    "<path d=\"m22 11-1.296-1.296a2.4 2.4 0 0 0-3.408 0L11 16\" /> <path d=\"M4 8a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2\" /> <circle cx=\"13\" cy=\"7\" r=\"1\" fill=\"currentColor\" /> <rect x=\"8\" y=\"2\" width=\"14\" height=\"14\" rx=\"2\" />",
  "inbox":
    "<polyline points=\"22 12 16 12 14 15 10 15 8 12 2 12\" /> <path d=\"M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z\" />",
  "issue-closed":
    "<circle cx=\"12\" cy=\"12\" r=\"10\" /> <path d=\"m16 9-5.5 5.5L8 12\" />",
  "issue-open":
    "<circle cx=\"12\" cy=\"12\" r=\"1\" /> <circle cx=\"12\" cy=\"12\" r=\"10\" />",
  "label":
    "<path d=\"M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z\" /> <circle cx=\"7.5\" cy=\"7.5\" r=\".5\" fill=\"currentColor\" />",
  "merged":
    "<circle cx=\"18\" cy=\"18\" r=\"3\" /> <circle cx=\"6\" cy=\"6\" r=\"3\" /> <path d=\"M6 21V9a9 9 0 0 0 9 9\" />",
  "monitor":
    "<rect width=\"20\" height=\"14\" x=\"2\" y=\"3\" rx=\"2\" /> <line x1=\"8\" x2=\"16\" y1=\"21\" y2=\"21\" /> <line x1=\"12\" x2=\"12\" y1=\"17\" y2=\"21\" />",
  "moon":
    "<path d=\"M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401\" />",
  "paperclip":
    "<path d=\"m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48\" />",
  "person":
    "<circle cx=\"12\" cy=\"8\" r=\"5\" /> <path d=\"M20 21a8 8 0 0 0-16 0\" />",
  "play":
    "<path d=\"M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z\" />",
  "refresh":
    "<path d=\"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8\" /> <path d=\"M21 3v5h-5\" /> <path d=\"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16\" /> <path d=\"M8 16H3v5\" />",
  "rename":
    "<path d=\"M13 21h8\" /> <path d=\"m15 5 4 4\" /> <path d=\"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z\" />",
  "reopened":
    "<path d=\"M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8\" /> <path d=\"M3 3v5h5\" />",
  "review":
    "<path d=\"M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z\" /> <path d=\"M7 11h10\" /> <path d=\"M7 15h6\" /> <path d=\"M7 7h8\" />",
  "square":
    "<rect width=\"18\" height=\"18\" x=\"3\" y=\"3\" rx=\"2\" />",
  "sun":
    "<circle cx=\"12\" cy=\"12\" r=\"4\" /> <path d=\"M12 2v2\" /> <path d=\"M12 20v2\" /> <path d=\"m4.93 4.93 1.41 1.41\" /> <path d=\"m17.66 17.66 1.41 1.41\" /> <path d=\"M2 12h2\" /> <path d=\"M20 12h2\" /> <path d=\"m6.34 17.66-1.41 1.41\" /> <path d=\"m19.07 4.93-1.41 1.41\" />",
  "task-done":
    "<path d=\"M21 10.656V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12.344\" /> <path d=\"m9 11 3 3L22 4\" />",
};

const OPEN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';

/** An icon as an HTML string, for the places that build markup rather than nodes. */
export function iconHTML(name, cls = "") {
  const body = PATHS[name];
  if (!body) return "";
  return OPEN + ' class="ic' + (cls ? " " + cls : "") + '">' + body + "</svg>";
}

/** An icon as an element. */
export function icon(name, cls = "") {
  const span = document.createElement("span");
  span.innerHTML = iconHTML(name, cls);
  return span.firstChild ?? span;
}

export function hasIcon(name) {
  return Object.hasOwn(PATHS, name);
}
