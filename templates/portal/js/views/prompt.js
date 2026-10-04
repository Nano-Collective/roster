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

import { highlighted } from "../mdedit.js";
import { getFile, post } from "../api.js";
import { askYes, sheet } from "../dialog.js";
import { el, esc, grow, kb, toClipboard } from "../dom.js";
import { icon } from "../icons.js";
import { mdlite } from "../md.js";
import { render } from "../router.js";
import { S, staff, writeHash } from "../state.js";
import { diffStat, unifiedDiff } from "../textdiff.js";
import { renderDiff } from "./changed.js";
import { showPasteResult } from "./paste.js";

const KINDS = [
  ["daily", "Daily", "the scheduled run"],
  ["mention", "Mention", "someone typed @them in an issue"],
];

/**
 * Fix a prompt with your own AI, in a side sheet: what is wrong, what you want changed, the
 * prompt as it is today, a brief to copy, and a box for the reply. The reply is parsed into
 * whole files and shown as diffs; nothing is saved until you press Save on one.
 *
 * @param {{handle: string, name?: string, kind: string, want?: string, title?: string,
 *   detail?: string}} o
 * @returns {{box: object | null, body: HTMLElement, want: HTMLTextAreaElement}} what it built,
 *   so a caller (or a test, where there is no <dialog>) can see it.
 */
export function amendSheet(o) {
  const body = el("div", { className: "amend" });
  const x = el("button", { className: "iconbtn", title: "Close (Esc)", ariaLabel: "Close" });
  x.append(icon("close"));
  body.append(el("div", { className: "sidebar-x" }, [x]));

  body.append(el("h3", { className: "sheettitle", textContent: o.title ?? "Change what they are told" }));
  if (o.detail) body.append(el("p", { className: "sub", textContent: o.detail }));

  const want = el("textarea", {
    className: "pastebox",
    rows: 3,
    value: o.want ?? "",
    placeholder: "stop opening decision issues for anything reversible",
  });
  body.append(el("label", { className: "amendlabel", textContent: "1. What you want changed" }), want);

  const copy = el("button", { className: "btn primary", textContent: "Copy the prompt" });
  const copied = el("span", { className: "meta" });
  copy.onclick = async () => {
    copy.disabled = true;
    try {
      const url =
        "/api/amend?staff=" + encodeURIComponent(o.handle) +
        "&kind=" + encodeURIComponent(o.kind) +
        "&want=" + encodeURIComponent(want.value);
      const text = await (await fetch(url, { cache: "no-store" })).text();
      await toClipboard(text, copy, "Copy the prompt");
      copied.textContent = "Paste it into Claude, ChatGPT or any other AI.";
      copied.className = "meta";
    } catch (e) {
      copied.textContent = String(e.message || e);
      copied.className = "meta err";
    } finally {
      copy.disabled = false;
    }
  };
  body.append(
    el("label", { className: "amendlabel", textContent: "2. Copy the prompt into your AI" }),
    el("div", { className: "row" }, [copy, copied]),
  );

  // The prompt this is about, to read before deciding what to ask for.
  const today = el("details", { className: "amendtoday" });
  const summary = el("summary", { textContent: "The " + o.kind + " prompt as it is today" });
  const text = el("pre", { className: "briefpreview", textContent: "Composing…" });
  today.append(summary, text);
  body.append(today);
  fetch("/api/prompt?staff=" + encodeURIComponent(o.handle) + "&kind=" + encodeURIComponent(o.kind), { cache: "no-store" })
    .then((r) => r.json())
    .then((v) => {
      if (v.error) throw new Error(v.error);
      const words = String(v.composed ?? "").split(/\s+/).filter(Boolean).length;
      summary.textContent = "The " + o.kind + " prompt as it is today · " + words.toLocaleString() + " words";
      text.textContent = v.composed ?? "";
    })
    .catch((e) => {
      text.textContent = String(e.message || e);
    });

  const answer = el("textarea", { className: "pastebox", rows: 8, placeholder: "Paste its whole reply here." });
  const check = el("button", { className: "btn", textContent: "Check the answer" });
  const result = el("div", { className: "pasteresult" });
  check.onclick = async () => {
    if (!answer.value.trim()) return;
    result.replaceChildren(el("p", { className: "sub", textContent: "Reading…" }));
    try {
      const data = await post({ staff: o.handle, kind: o.kind, answer: answer.value }, "/api/amend/check");
      showPasteResult(result, data, answer.value, () => {});
    } catch (e) {
      result.replaceChildren(el("p", { className: "err", textContent: String(e.message || e) }));
    }
  };
  body.append(
    el("label", { className: "amendlabel", textContent: "3. Paste its reply" }),
    answer,
    el("div", { className: "row" }, [check]),
    result,
  );

  const box = sheet({ node: body, side: true });
  if (box) x.onclick = () => box.close();
  return { box, body, want };
}

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
  /* The point of the screen: you can see the prompt, and you can get help changing it
     without first working out which of eight files to open. */
  const help = el("button", { className: "ghbtn primary", textContent: "Change this with your AI" });
  help.onclick = () => copyAmend("");
  const copy = el("button", { className: "ghbtn", textContent: "Copy the prompt" });
  copy.onclick = () => {
    if (view?.composed) toClipboard(view.composed, copy, "Copy the prompt");
  };
  const note = el("span", { className: "meta" });
  m.append(el("div", { className: "row", style: "margin-bottom:16px" }, [kind, help, copy, note]));

  const copyAmend = (want) => amendSheet({ handle: s.handle, name: s.name, kind: S.promptKind, want });

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

    /* No Problems section. This screen answers "what is sent"; whether what is sent is any
       good is a health question, and it is asked and answered on Health. Having both here
       made the tree beside the prompt half prompt and half complaints. */
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

  function group(title, right) {
    const g = el("div", { className: "navgroup" });
    const h = el("div", { className: "ghead", textContent: title });
    if (right) h.append(el("i", { textContent: right }));
    g.append(h);
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

  /* Returns a promise: `showLayer` fetches, and anything that wants to add to the pane after
     opening a file has to wait for it. Prepending before the fetch resolved is why the
     "what your edit did" strip appeared and then vanished. */
  function open(key) {
    S.promptOpen = key;
    writeHash(false);
    for (const o of tree.querySelectorAll(".tfile")) {
      o.setAttribute("aria-current", String(o.dataset.key === key));
    }
    if (key === "composed") return showComposed();
    const layer = [...view.layers, ...view.runtime].find((l) => l.path === key);
    return layer ? showLayer(layer) : undefined;
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

  /** What the edit did, once, at the top of the pane: the commit, and the composed diff. */
  function showEffect(saved, before, after) {
    const box = el("div", { className: "effect" });
    const head = el("div", { className: "row" });
    head.append(
      el("span", {
        className: saved.pushed ? "meta ok" : "meta warn",
        textContent: saved.pushed
          ? "committed and pushed · " + saved.sha
          : "committed " + saved.sha + ", but the push failed: " + (saved.note ?? ""),
      }),
    );

    const stat = diffStat(before, after);
    const patch = unifiedDiff(before, after, "the " + S.promptKind + " prompt");
    if (!patch) {
      head.append(
        el("span", { className: "meta", textContent: "· the composed prompt is unchanged" }),
      );
      box.append(head);
      viewer.prepend(box);
      return;
    }

    const toggle = el("button", { className: "tevmore" });
    toggle.setAttribute("aria-expanded", "false");
    toggle.append(
      icon("chevron", "caret"),
      el("span", {
        textContent:
          "the " + S.promptKind + " prompt: +" + stat.added + " −" + stat.removed + " lines",
      }),
    );
    const body = el("div", {}, renderDiff(patch, null));
    body.hidden = true;
    toggle.onclick = () => {
      body.hidden = !body.hidden;
      toggle.setAttribute("aria-expanded", String(!body.hidden));
    };
    box.append(head, toggle, body);
    viewer.prepend(box);
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
    const hl = highlighted(ta, "md");
    viewer.append(hl);
    grow(ta);
    hl.repaint();
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
      const yes = await askYes({
        title: "Commit " + layer.path + " to " + layer.repo + " and push?",
        hint: "Picked up by " + reach + ".",
        confirm: "Commit and push",
      });
      if (!yes) return;
      save.disabled = cancel.disabled = true;
      status.textContent = "committing…";
      status.className = "meta";
      const before = view.composed;
      try {
        const r = await post({ path: layer.path, text: ta.value }, "/api/save");
        // Recompose: the point of editing a layer is what it does to the prompt, and a file
        // diff answers a question nobody asked. A line added to one fragment can land three
        // times or not at all.
        await load();
        await open(layer.path);
        showEffect(r, before, view.composed);
      } catch (e) {
        status.textContent = e.message;
        status.className = "meta err";
        save.disabled = cancel.disabled = false;
      }
    };
  }
}
