/* The framework's own documentation, read where you already are. Same renderer as a brain
   file, so a link between pages behaves like a link between files rather than a dead end. */

import { getDoc, getDocs, searchDocs } from "../api.js";
import { el, esc, skeleton, slug } from "../dom.js";
import { mdlite } from "../md.js";
import { S, writeHash } from "../state.js";

export function viewDocs(m) {
  m.append(el("h1", { textContent: "Docs" }));
  m.append(
    el("p", {
      className: "sub",
      textContent:
        "How roster works, what it will not do for you, and every trap worth knowing about.",
    }),
  );

  /* Titles are not enough. Twenty-odd pages is too many to scan and few enough for the server
     to read in full on every keystroke, and what you are looking for — "which page explains the
     mention gate" — is a sentence in a paragraph rather than a word in a heading. So the box
     searches the text, and the list becomes the results while there is a query in it. */
  const find = el("input", {
    type: "search",
    placeholder: "Search the docs…",
    value: S.docQuery ?? "",
    style: "width:100%;margin-bottom:12px",
  });
  m.append(find);

  const split = el("div", { className: "split" });
  const list = el("div", { className: "tree" });
  const viewer = el("div", { className: "viewer" });
  split.append(list, viewer);
  m.append(split);

  if (S.docs) paint();
  else {
    list.replaceChildren(...skeleton("row", 8));
    getDocs()
      .then((d) => { S.docs = d; paint(); })
      .catch((e) => list.replaceChildren(el("p", { className: "empty err", textContent: e.message })));
  }

  /* Debounced, because every keystroke is a read of every page. 140ms is below the point
     where the list feels like it is lagging behind the typing. */
  let timer = null;
  find.oninput = () => {
    S.docQuery = find.value;
    writeHash(false);
    clearTimeout(timer);
    timer = setTimeout(run, 140);
  };
  if (S.docQuery) run();

  async function run() {
    const q = (S.docQuery ?? "").trim();
    if (!q) { paint(); return; }
    let hits;
    try {
      hits = (await searchDocs(q)).hits ?? [];
    } catch (e) {
      list.replaceChildren(el("p", { className: "empty err", textContent: e.message }));
      return;
    }
    // A slow answer to a query you have already moved on from must not land.
    if ((S.docQuery ?? "").trim() !== q) return;
    paintHits(hits, q);
  }

  function paint() {
    list.replaceChildren();
    if (!S.docs?.length) {
      list.append(el("p", { className: "empty", textContent: "No docs here." }));
      return;
    }
    for (const d of S.docs) {
      const b = el("button", { className: "tfile tmem", title: d.file });
      b.dataset.key = d.file;
      b.append(el("span", { className: "t", textContent: d.title }));
      b.setAttribute("aria-current", String((S.openDoc ?? S.docs[0].file) === d.file));
      b.onclick = () => open(d.file);
      list.append(b);
    }
    show(S.openDoc ?? S.docs[0].file);
  }

  /** The same list, narrowed, with the lines that matched under each row. */
  function paintHits(hits, q) {
    list.replaceChildren();
    list.append(
      el("div", {
        className: "tdir first",
        textContent: hits.length
          ? hits.length + (hits.length === 1 ? " page" : " pages") + " mention that"
          : "nothing mentions that",
      }),
    );
    if (!hits.length) {
      list.append(
        el("p", {
          className: "empty",
          textContent: "Every word has to appear somewhere on the page. Try fewer.",
        }),
      );
      return;
    }
    for (const h of hits) {
      const b = el("button", { className: "tfile thit", title: h.file });
      b.dataset.key = h.file;
      const t = el("span", { className: "t" });
      t.append(el("span", { className: "hitname", textContent: h.title }));
      for (const line of h.matches ?? []) {
        t.append(el("span", { className: "hitline", innerHTML: mark(line.text, q) }));
      }
      b.append(t);
      b.setAttribute("aria-current", String(S.openDoc === h.file));
      b.onclick = () => open(h.file);
      list.append(b);
    }
    // Opening the first result is what makes typing feel like searching rather than filtering.
    if (!hits.some((h) => h.file === S.openDoc)) open(hits[0].file);
  }

  /** The words that were asked for, shown in the line they were found in. */
  function mark(text, q) {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean)
      .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    let html = esc(text);
    if (terms.length) {
      html = html.replace(new RegExp("(" + terms.join("|") + ")", "gi"), "<em>$1</em>");
    }
    return html;
  }

  function open(file) {
    S.openDoc = file;
    writeHash(false);
    for (const o of list.querySelectorAll(".tfile")) {
      o.setAttribute("aria-current", String(o.dataset.key === file));
    }
    show(file);
  }

  async function show(file) {
    viewer.replaceChildren(...skeleton("head", 1), ...skeleton("line", 8));
    let text;
    try {
      text = await getDoc(file);
    } catch (e) {
      viewer.replaceChildren(el("p", { className: "empty err", textContent: e.message }));
      return;
    }
    const doc = el("div", { className: "md doc" });
    // The pages carry YAML frontmatter for the collective's docs site. It is metadata, not
    // content, so it is dropped rather than rendered as a rule and a stray paragraph.
    doc.innerHTML = mdlite(text.replace(/^---\n[\s\S]*?\n---\n/, ""), { docs: true });
    doc.addEventListener("click", (e) => {
      const link = e.target.closest?.("[data-doc]");
      if (!link) return;
      e.preventDefault();
      const [page, anchor] = link.dataset.doc.split("#");
      if (page && S.docs.some((d) => d.file === page)) open(page);
      if (anchor) {
        const to = [...viewer.querySelectorAll("h1,h2,h3,h4")].find(
          (h) => slug(h.textContent) === anchor,
        );
        if (to?.scrollIntoView) to.scrollIntoView({ block: "start" });
      }
    });
    viewer.replaceChildren(doc);
    viewer.scrollTop = 0;
  }
}
