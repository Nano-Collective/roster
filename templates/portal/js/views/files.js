/* Rendering one file out of a brain: markdown, image, CSV, JSON, or source. */

import { el, kb } from "../dom.js";
import { fileUrl, getFile } from "../api.js";
import { mdlite } from "../md.js";

const IMG = ["png", "jpg", "jpeg", "gif", "svg", "webp", "ico"];

export async function showFile(viewer, s, f, pick) {
  viewer.replaceChildren(el("p", { className: "empty", textContent: "Loading…" }));
  const path = s.dir + "/" + f.path;
  const head = el("div", { className: "meta", style: "margin-bottom:12px" });
  /* A file the export did not walk (the charter, the manifest) has no size on it, so the
     header says what it knows and fills the rest in once the text arrives. */
  const stamp = (bytes) =>
    f.path + (bytes ? " · " + kb(bytes) : "") +
    (f.bytes ? " · " + new Date(f.modified).toLocaleDateString() : "");
  head.textContent = stamp(f.bytes);

  if (IMG.includes(f.ext)) {
    viewer.replaceChildren(head, el("img", { src: fileUrl(path), alt: f.path }));
    return;
  }

  const text = await getFile(path);
  head.textContent = stamp(f.bytes || text.length);
  if (f.ext === "csv") {
    viewer.replaceChildren(head, csvTable(text));
    return;
  }

  // A brain is mostly markdown, and reading it as source was the thing that made the file
  // tree feel like a worse GitHub rather than a better one.
  if (f.ext === "md" || f.ext === "markdown") {
    const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/") + 1) : "";
    const doc = el("div", { className: "md doc" });
    doc.innerHTML = mdlite(text, { repo: s.brain, file: { dir, staffDir: s.dir } });
    doc.addEventListener("click", (e) => {
      const link = e.target.closest?.("[data-file]");
      if (!link) return;
      e.preventDefault();
      pick?.(link.dataset.file);
    });
    viewer.replaceChildren(head, doc);
    return;
  }

  if (f.ext === "json") {
    let pretty = text;
    try {
      pretty = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      /* malformed: show it as it is */
    }
    viewer.replaceChildren(head, el("pre", { className: "code", textContent: pretty }));
    return;
  }

  viewer.replaceChildren(head, el("pre", { className: "code", textContent: text }));
}

function csvTable(text) {
  const rows = text.trim().split("\n").slice(0, 300).map((r) => r.split(","));
  const t = el("table");
  const [head, ...body] = rows;
  t.append(el("tr", {}, (head ?? []).map((h) => el("th", { textContent: h }))));
  for (const r of body) t.append(el("tr", {}, r.map((c) => el("td", { textContent: c }))));
  return t;
}

export function showGallery(viewer, s, surface) {
  const imgs = surface.files.filter((f) => IMG.includes(f.ext));
  if (!imgs.length) {
    viewer.replaceChildren(el("p", { className: "empty", textContent: "No images here." }));
    return;
  }
  const g = el("div", { className: "gallery" });
  for (const f of imgs.slice(0, 200)) {
    const fig = el("figure");
    const img = el("img", {
      src: fileUrl(s.dir + "/" + f.path),
      loading: "lazy",
      alt: f.path,
    });
    img.onclick = () => showFile(viewer, s, f);
    fig.append(img, el("figcaption", { textContent: f.path.split("/").pop() }));
    g.append(fig);
  }
  viewer.replaceChildren(
    el("div", { className: "meta", style: "margin-bottom:12px" }, [
      imgs.length + " images in " + surface.path,
    ]),
    g,
  );
}
