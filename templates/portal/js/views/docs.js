/* The framework's own documentation, read where you already are. Same renderer as a brain
   file, so a link between pages behaves like a link between files rather than a dead end. */

import { getDoc, getDocs } from "../api.js";
import { el, slug } from "../dom.js";
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

  const split = el("div", { className: "split" });
  const list = el("div", { className: "tree" });
  const viewer = el("div", { className: "viewer" });
  split.append(list, viewer);
  m.append(split);

  if (S.docs) paint();
  else {
    list.append(el("p", { className: "empty", textContent: "Loading…" }));
    getDocs()
      .then((d) => { S.docs = d; paint(); })
      .catch((e) => list.replaceChildren(el("p", { className: "empty err", textContent: e.message })));
  }

  function paint() {
    list.replaceChildren();
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

  function open(file) {
    S.openDoc = file;
    writeHash(false);
    for (const o of list.querySelectorAll(".tfile")) {
      o.setAttribute("aria-current", String(o.dataset.key === file));
    }
    show(file);
  }

  async function show(file) {
    viewer.replaceChildren(el("p", { className: "empty", textContent: "Loading…" }));
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
