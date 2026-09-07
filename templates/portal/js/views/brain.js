/* The brain screen.
 *
 * Memory and the file tree were two screens showing one thing, and both manifests already
 * declare `memory/` as a surface with `render: memory`. So it is one screen — but one screen
 * is not one list. The navigator is two boxes, because a parsed memory section and a file on
 * disk are different kinds of thing and the old flat list told them apart only by typeface.
 *
 * The `memory/` surface's own files are folded into Memory rather than repeated under Files:
 * `INDEX.md` is literally what "All facts" renders, and `notes/x.md` is the argument behind a
 * fact. Listing them twice was most of what made this hard to read.
 */

import { el, kb } from "../dom.js";
import { icon } from "../icons.js";
import { S, staff, writeHash } from "../state.js";
import { showFile, showGallery } from "./files.js";
import { showMemory } from "./memory.js";

/** Files a brain browser should not offer: placeholders that hold a directory open. */
const NOISE = new Set([".gitkeep", ".keep", ".DS_Store"]);

const isIndex = (path) => path === "memory/INDEX.md";
const isNote = (path) => path.startsWith("memory/notes/");

export function viewBrain(m) {
  const s = staff();
  if (!S.openSurfaces) S.openSurfaces = new Map();

  const allFiles = s.surfaces.flatMap((x) => x.files).filter((f) => !NOISE.has(base(f.path)));
  const notes = allFiles.filter((f) => isNote(f.path));
  /* What Files is actually for: everything that is not the memory index or a note behind a
     fact, both of which Memory already renders properly. */
  const plain = allFiles.filter((f) => !isIndex(f.path) && !isNote(f.path));

  m.append(el("h1", { textContent: s.name + " · brain" }));
  m.append(
    el("p", {
      className: "sub",
      textContent:
        s.facts.length + " facts in " + s.sections.length + " sections, " + notes.length +
        " notes · " + plain.length + " other files across " + s.surfaces.length + " surfaces.",
    }),
  );

  const filter = el("input", {
    type: "search",
    placeholder: "Search facts and files…",
    value: S.fileQuery,
  });
  const count = el("span", { className: "meta" });
  m.append(el("div", { className: "row", style: "margin-bottom:16px" }, [filter, count]));

  const split = el("div", { className: "split" });
  const tree = el("div", { className: "tree" });
  const viewer = el("div", { className: "viewer" });
  split.append(tree, viewer);
  m.append(split);

  filter.oninput = () => {
    S.fileQuery = filter.value;
    writeHash(false);
    paintTree();
  };

  // Memory is where a brain starts, so it is what you land on.
  if (!S.openFile) S.openFile = "mem:*";
  paintTree();
  openBrain(S.openFile);

  /* ------------------------------ selection ----------------------------- */

  function pick(key) {
    S.openFile = key;
    writeHash(false);
    markTree();
    openBrain(key);
  }

  /** Which row is open, and — when a single fact is focused — which section holds it, so
      opening one fact never loses your place in the list above it. */
  function withinKey() {
    if (!S.openFile?.startsWith("fact:")) return null;
    const f = s.facts.find((x) => x.slug === S.openFile.slice(5));
    return f ? "mem:" + f.section : null;
  }

  /** Applied as a row is built and again when the selection moves without a repaint, so
      picking a fact does not rebuild the tree and throw away its scroll position. */
  function mark(b, within) {
    b.setAttribute("aria-current", String(b.dataset.key === S.openFile));
    if (within && b.dataset.key === within) b.dataset.within = "true";
    else delete b.dataset.within;
  }

  function markTree() {
    const within = withinKey();
    for (const o of tree.querySelectorAll(".tfile")) mark(o, within);
  }

  /* -------------------------------- rows -------------------------------- */

  function row(key, label, right, cls) {
    const b = el("button", { className: "tfile" + (cls ? " " + cls : ""), title: label });
    b.dataset.key = key;
    b.append(el("span", { className: "t", textContent: label }));
    if (right) b.append(el("i", { textContent: right }));
    mark(b, withinKey());
    b.onclick = () => pick(key);
    return b;
  }

  /** A titled box in the navigator. Two of them: what the agent knows, and what it holds. */
  function group(title, right) {
    const g = el("div", { className: "navgroup" });
    const h = el("div", { className: "ghead", textContent: title });
    if (right) h.append(el("i", { textContent: right }));
    g.append(h);
    return g;
  }

  /** A folder that unfolds. Big surfaces start closed; a handful of files does not need it. */
  function folder(g, key, label, kids, right) {
    const open = S.openSurfaces.get(key) ?? kids.length <= 12;
    const head = el("button", { className: "tsurface", title: label });
    head.setAttribute("aria-expanded", String(open));
    head.append(
      icon("chevron", "caret"),
      el("span", { className: "t", textContent: label }),
      el("i", { textContent: right ?? String(kids.length) }),
    );
    const box = el("div", { className: "tsfiles" }, kids);
    box.hidden = !open;
    head.onclick = () => {
      const now = !(S.openSurfaces.get(key) ?? kids.length <= 12);
      S.openSurfaces.set(key, now);
      head.setAttribute("aria-expanded", String(now));
      box.hidden = !now;
    };
    g.append(head, box);
  }

  /* ------------------------------ the tree ------------------------------ */

  function paintTree() {
    const q = S.fileQuery.trim().toLowerCase();
    tree.replaceChildren();

    const hits = s.facts.filter((f) => matchesFact(f, q));
    const noteHits = notes.filter((f) => !q || f.path.toLowerCase().includes(q));
    const fileHits = plain.filter((f) => !q || f.path.toLowerCase().includes(q));

    /* ---- memory ---- */
    const mem = group("Memory", s.facts.length + " facts");
    if (q) {
      for (const f of hits.slice(0, 200)) mem.append(row("fact:" + f.slug, f.slug, "", "tmem"));
      if (!hits.length) {
        mem.append(el("div", { className: "tfile", textContent: "no facts match" }));
      }
    } else {
      mem.append(row("mem:*", "All facts", String(s.facts.length), "tmem"));
      for (const sec of s.sections) {
        const n = s.facts.filter((f) => f.section === sec).length;
        mem.append(row("mem:" + sec, sec, String(n), "tmem"));
      }
    }
    if (noteHits.length) {
      /* Labelled, because "notes" beside a list of memory sections reads as a mystery
         drawer. A note is the argument behind one fact, read only when that fact is in
         play, which is what keeps the index cheap enough to read at every boot. */
      folder(
        mem,
        "notes",
        "notes/ — why a fact holds",
        noteHits.map((f) => row(f.path, base(f.path), kb(f.bytes))),
        String(noteHits.length),
      );
    }
    if (!q && allFiles.some((f) => isIndex(f.path))) {
      mem.append(row("memory/INDEX.md", "INDEX.md — the raw index", "", "tmem"));
    }
    tree.append(mem);

    /* ---- who they are ----
       CHARTER.md and staff.yaml sit at the brain root and are in no declared surface, so
       the portal could not show either of them. They are the two files that decide what
       this staff member is, which made that a strange gap. */
    if (!q) {
      const id = group("Identity", "");
      id.append(row("CHARTER.md", "CHARTER.md — the personality", "", "tmem"));
      id.append(row("staff.yaml", "staff.yaml — the manifest", "", "tmem"));
      tree.append(id);
    }

    /* ---- files ---- */
    if (fileHits.length) {
      const fg = group("Files", plain.length + " files");
      for (const surface of s.surfaces) {
        const fs = fileHits.filter((f) => surface.files.some((x) => x.path === f.path));
        if (!fs.length) continue;
        const kids = fs
          .slice(0, 400)
          .map((f) => row(f.path, f.path.replace(surface.path, "") || f.path, kb(f.bytes)));
        // A gallery surface earns one extra row, in words rather than the manifest's jargon.
        if (surface.render === "gallery" && !q) {
          kids.unshift(row("gallery:" + surface.path, "View all as a gallery", ""));
        }
        folder(fg, surface.path, surface.path, kids);
      }
      tree.append(fg);
    }

    // Counted the same way the subtitle counts, so the two never disagree.
    count.textContent = q
      ? hits.length + " facts, " + noteHits.length + " notes, " + fileHits.length + " files"
      : s.facts.length + " facts, " + notes.length + " notes, " + plain.length + " files";
    if (q && !hits.length && !fileHits.length && !noteHits.length) {
      tree.replaceChildren(el("p", { className: "empty", textContent: "Nothing matches." }));
    }
    markTree();
  }

  /* ------------------------------ the pane ------------------------------ */

  function openBrain(key) {
    if (key?.startsWith("gallery:")) {
      const surface = s.surfaces.find((x) => x.path === key.slice(8));
      if (surface) showGallery(viewer, s, surface);
      return;
    }
    if (!key || key.startsWith("mem:") || key.startsWith("fact:")) {
      showMemory(viewer, s, key || "mem:*", pick);
      return;
    }
    const f = allFiles.find((x) => x.path === key) ?? rootFile(key);
    if (!f) {
      viewer.replaceChildren(
        el("p", { className: "empty", textContent: "That file is not in this brain." }),
      );
      return;
    }
    showFile(viewer, s, f, pick);
  }
}

const base = (path) => path.split("/").pop();

/* A file at the brain root, which no surface declares. `bytes` and `modified` are only used
   for the header line, and the renderer reads the file itself. */
const ROOT_FILES = new Set(["CHARTER.md", "staff.yaml", "README.md"]);
function rootFile(key) {
  if (!ROOT_FILES.has(key)) return null;
  return { path: key, ext: key.split(".").pop().toLowerCase(), bytes: 0, modified: new Date().toISOString() };
}

export function matchesFact(f, q) {
  if (!q) return true;
  return (f.slug + " " + f.statement + " " + (f.consequence ?? "") + " " + (f.section ?? ""))
    .toLowerCase()
    .includes(q);
}
