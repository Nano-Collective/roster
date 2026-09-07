/* What a staff member is actually sent, and the files it was made of.
 *
 * The composition is `roster prompt <handle> --kind daily` on the CLI, and it was the one
 * thing about these agents you could not see without a terminal. Composed by the tenant's own
 * compose.mjs on the server, so there is no second implementation to drift.
 *
 * The distinction the screen exists to make: most of a charter is NOT in the prompt. The
 * prompt tells the agent to go and read it. Editing CHARTER.md changes behaviour without
 * changing a byte of the composed text, and nothing said so before.
 */

import { getFile, post } from "../api.js";
import { el, esc, grow, kb } from "../dom.js";
import { mdlite } from "../md.js";
import { S, staff, writeHash } from "../state.js";

const KINDS = [
  ["daily", "Daily", "the scheduled run"],
  ["mention", "Mention", "someone typed @them in an issue"],
  ["pr-mention", "PR mention", "someone typed @them on a pull request"],
];

export function viewPrompt(m) {
  const s = staff();
  if (!S.promptKind) S.promptKind = "daily";

  m.append(el("h1", { textContent: s.name + " · prompt" }));
  const sub = el("p", { className: "sub", textContent: "Composing…" });
  m.append(sub);

  const kind = el("select");
  for (const [id, label, why] of KINDS) {
    kind.append(el("option", { value: id, textContent: label + " — " + why }));
  }
  kind.value = S.promptKind;
  kind.onchange = () => {
    S.promptKind = kind.value;
    S.promptOpen = null;
    writeHash(false);
    load();
  };
  m.append(el("div", { className: "row", style: "margin-bottom:16px" }, [kind]));

  const split = el("div", { className: "split" });
  const tree = el("div", { className: "tree" });
  const viewer = el("div", { className: "viewer" });
  split.append(tree, viewer);
  m.append(split);

  let view = null;
  load();

  async function load() {
    tree.replaceChildren(el("p", { className: "empty", textContent: "Composing…" }));
    viewer.replaceChildren();
    try {
      const url = "/api/prompt?staff=" + encodeURIComponent(s.handle) + "&kind=" + S.promptKind;
      view = await (await fetch(url, { cache: "no-store" })).json();
    } catch (e) {
      tree.replaceChildren(el("p", { className: "empty err", textContent: e.message }));
      return;
    }
    if (view.error) {
      sub.textContent = "This prompt does not compose.";
      tree.replaceChildren();
      viewer.replaceChildren(
        el("div", { className: "notice" }, [
          "compose.mjs refused: " + view.error,
        ]),
      );
      return;
    }
    paint();
  }

  function paint() {
    const chars = view.composed.length;
    const words = view.composed.split(/\s+/).filter(Boolean).length;
    sub.innerHTML =
      "What <b>" + esc(s.name) + "</b> is sent on a <b>" + esc(S.promptKind) +
      "</b> run: " + words.toLocaleString() + " words, " + chars.toLocaleString() +
      " characters, assembled from " + view.layers.filter((l) => !l.missing).length +
      " files. This is the text, not a description of it.";

    tree.replaceChildren();

    const composed = group("The prompt");
    composed.append(row({ key: "composed", label: "Composed", right: kb(chars) }));
    tree.append(composed);

    const inlined = group("Inlined, in order");
    for (const l of view.layers) inlined.append(layerRow(l));
    tree.append(inlined);

    const named = group("Named, not inlined");
    named.append(
      el("p", {
        className: "treenote",
        textContent:
          "The prompt tells the agent to open these. Editing one changes what it does without changing the prompt.",
      }),
    );
    for (const l of view.runtime) named.append(layerRow(l));
    tree.append(named);

    open(S.promptOpen ?? "composed");
  }

  function group(title) {
    const g = el("div", { className: "navgroup" });
    g.append(el("div", { className: "ghead", textContent: title }));
    return g;
  }

  function layerRow(l) {
    return row({
      key: l.path,
      label: l.rel.replace(/^staff:/, ""),
      right: l.missing ? "absent" : kb(l.bytes),
      note: l.repo,
      dim: l.missing,
    });
  }

  function row({ key, label, right, note, dim }) {
    const b = el("button", { className: "tfile tlayer" + (dim ? " dim" : ""), title: key });
    b.dataset.key = key;
    const t = el("span", { className: "t" });
    t.append(el("span", { className: "lname", textContent: label }));
    if (note) t.append(el("span", { className: "lrepo", textContent: note }));
    b.append(t);
    if (right) b.append(el("i", { textContent: right }));
    b.setAttribute("aria-current", String((S.promptOpen ?? "composed") === key));
    b.onclick = () => open(key);
    return b;
  }

  function open(key) {
    S.promptOpen = key;
    writeHash(false);
    for (const o of tree.querySelectorAll(".tfile")) {
      o.setAttribute("aria-current", String(o.dataset.key === key));
    }
    if (key === "composed") return showComposed();
    const layer = [...view.layers, ...view.runtime].find((l) => l.path === key);
    if (layer) showLayer(layer);
  }

  /* ------------------------------ the prompt ----------------------------- */

  function showComposed() {
    viewer.replaceChildren();
    const head = el("div", { className: "row", style: "margin-bottom:12px" });
    head.append(
      el("span", {
        className: "meta",
        textContent: "composed by " + S.data.name + "'s own compose.mjs · " + S.promptKind,
      }),
    );
    const toggle = el("button", { className: "ghbtn", textContent: "Show source" });
    head.append(toggle);
    viewer.append(head);

    const body = el("div", { className: "md doc" });
    body.innerHTML = mdlite(view.composed);
    viewer.append(body);

    let source = false;
    toggle.onclick = () => {
      source = !source;
      toggle.textContent = source ? "Show rendered" : "Show source";
      if (source) {
        body.className = "";
        body.replaceChildren(el("pre", { className: "code", textContent: view.composed }));
      } else {
        body.className = "md doc";
        body.replaceChildren();
        body.innerHTML = mdlite(view.composed);
      }
    };
  }

  /* ------------------------------ one layer ------------------------------ */

  async function showLayer(layer) {
    viewer.replaceChildren(el("p", { className: "empty", textContent: "Loading…" }));
    if (layer.missing) {
      viewer.replaceChildren(
        el("p", {
          className: "empty",
          textContent: layer.optional
            ? layer.rel + " is optional and this staff member does not have one."
            : layer.rel + " is missing.",
        }),
      );
      return;
    }

    let text;
    try {
      text = await getFile(layer.path);
    } catch (e) {
      viewer.replaceChildren(el("p", { className: "empty err", textContent: e.message }));
      return;
    }
    render(layer, text);
  }

  function render(layer, text) {
    viewer.replaceChildren();

    const head = el("div", { className: "row", style: "margin-bottom:12px" });
    head.append(
      el("span", { className: "meta", textContent: layer.path + " · " + kb(text.length) }),
    );
    const editBtn = el("button", { className: "ghbtn", textContent: "Edit" });
    if (layer.editable) head.append(editBtn);
    viewer.append(head);

    const body = el("div", { className: "md doc" });
    body.innerHTML = mdlite(text);
    viewer.append(body);

    editBtn.onclick = () => edit(layer, text);
  }

  /* Editing writes to a repo the agents run from, so the confirm names the repo and says
     who picks it up. `org/` reaches every staff member; a brain file reaches one. */
  function edit(layer, text) {
    viewer.replaceChildren();
    const shared = /^(org|prompts)\//.test(layer.rel);
    const reach = shared
      ? "every staff member on their next run"
      : s.name + " on their next run";

    viewer.append(
      el("div", { className: "row", style: "margin-bottom:10px" }, [
        el("span", { className: "meta", textContent: layer.path }),
      ]),
    );

    const ta = el("textarea", { value: text, className: "editor" });
    viewer.append(ta);
    grow(ta);
    ta.addEventListener("input", () => grow(ta));

    const status = el("span", { className: "meta" });
    const save = el("button", { className: "ghbtn primary", textContent: "Save and commit" });
    const cancel = el("button", { className: "ghbtn", textContent: "Cancel" });
    viewer.append(
      el("div", { className: "row", style: "margin-top:10px" }, [save, cancel, status]),
    );
    viewer.append(
      el("p", {
        className: "editnote",
        textContent: "Commits to " + layer.repo + " and pushes. Picked up by " + reach + ".",
      }),
    );

    cancel.onclick = () => render(layer, text);

    save.onclick = async () => {
      if (ta.value === text) {
        status.textContent = "nothing changed";
        return;
      }
      if (!confirm("Commit " + layer.path + " to " + layer.repo + " and push?\n\n" +
                   "Picked up by " + reach + ".")) return;
      save.disabled = cancel.disabled = true;
      status.textContent = "committing…";
      status.className = "meta";
      try {
        const r = await post({ path: layer.path, text: ta.value }, "/api/save");
        status.textContent = r.pushed
          ? "committed and pushed · " + r.sha
          : "committed " + r.sha + ", but the push failed: " + (r.note ?? "");
        status.className = r.pushed ? "meta ok" : "meta warn";
        // Recompose: the point of editing a layer is what it does to the prompt.
        await load();
        open(layer.path);
      } catch (e) {
        status.textContent = e.message;
        status.className = "meta err";
        save.disabled = cancel.disabled = false;
      }
    };
  }
}
