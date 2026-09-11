/* Rendering one file out of a brain: markdown, image, video, CSV, JSON, or source. */

import { el, kb } from "../dom.js";
import { fileUrl, getFile } from "../api.js";
import { icon } from "../icons.js";
import { mdlite } from "../md.js";
import { yamlPre } from "../yaml.js";

const IMG = ["png", "jpg", "jpeg", "gif", "svg", "webp", "ico"];

/* A brain records as often as it screenshots, and a recording read as source is a screenful
   of binary. It plays here for the same reason an image displays here: it is the file. */
const VIDEO = ["mp4", "m4v", "webm", "mov", "ogv"];
const AUDIO = ["mp3", "m4a", "wav", "oga"];

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

  if (VIDEO.includes(f.ext) || AUDIO.includes(f.ext)) {
    const player = el(VIDEO.includes(f.ext) ? "video" : "audio", {
      src: fileUrl(path),
      controls: true,
      preload: "metadata",
      className: "player",
    });
    // Nothing else here streams, so say what to do when a codec the browser cannot decode
    // turns up — a .mov is often h.265, and a silent black rectangle explains nothing.
    const fallback = el("p", { className: "meta", hidden: true });
    player.onerror = () => {
      fallback.hidden = false;
      fallback.textContent = "This browser cannot play " + f.ext + ". The file itself is fine — ";
      fallback.append(
        el("a", { href: fileUrl(path), download: f.path.split("/").pop(), textContent: "download it" }),
      );
    };
    viewer.replaceChildren(head, player, fallback);
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

  // A manifest is the one kind of source in a brain that is read closely rather than skimmed.
  if (f.ext === "yaml" || f.ext === "yml") {
    viewer.replaceChildren(head, yamlPre(text));
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
  const shots = surface.files.filter((f) => IMG.includes(f.ext) || VIDEO.includes(f.ext));
  if (!shots.length) {
    viewer.replaceChildren(el("p", { className: "empty", textContent: "Nothing to show here." }));
    return;
  }
  const g = el("div", { className: "gallery" });
  for (const f of shots.slice(0, 200)) {
    const fig = el("figure");
    const src = fileUrl(s.dir + "/" + f.path);
    /* A video tile is its own first frame rather than a placeholder, which is what makes a
       wall of recordings tell you anything. `preload="metadata"` is enough for that and does
       not pull the whole file for every tile on the page. */
    const tile = IMG.includes(f.ext)
      ? el("img", { src, loading: "lazy", alt: f.path })
      : el("video", { src, preload: "metadata", muted: true, playsInline: true });
    tile.onclick = () => showFile(viewer, s, f);
    fig.append(tile);
    if (!IMG.includes(f.ext)) fig.append(el("span", { className: "playmark" }, [icon("play", "ic")]));
    fig.append(el("figcaption", { textContent: f.path.split("/").pop() }));
    g.append(fig);
  }
  const vids = shots.filter((f) => VIDEO.includes(f.ext)).length;
  viewer.replaceChildren(
    el("div", { className: "meta", style: "margin-bottom:12px" }, [
      shots.length - vids + " images" + (vids ? " and " + vids + " videos" : "") + " in " + surface.path,
    ]),
    g,
  );
}
