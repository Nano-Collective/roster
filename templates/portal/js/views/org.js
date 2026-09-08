/* The org layer, in one place.
 *
 * These five files are what every staff member inherits. Editing `org/voice.md` once is the
 * whole extensibility story — the thing this arrangement exists to make possible — and until
 * now you reached them through a staff member's Prompt screen, which is a strange route to a
 * file that belongs to nobody in particular.
 *
 * `org.yaml` is here too, and is the one file that stops every prompt composing when it is
 * wrong. The server validates it before writing.
 */

import { getFile, post } from "../api.js";
import { el, esc, grow, kb } from "../dom.js";
import { mdlite } from "../md.js";
import { S, writeHash } from "../state.js";

/* What each file is for, in one line, because a list of five filenames tells you nothing
   about which one to open. */
const DOCS = [
  ["org.yaml", "Who and what: the humans, the repos, the defaults, which agent runs them.", "yaml"],
  ["org/business.md", "What the business actually is. Every prompt is composed on top of it, and it is the file that stops the agents writing generic slop.", "md"],
  ["org/operating.md", "The autonomy contract: what they do without asking, what they escalate, how a run starts and ends.", "md"],
  ["org/guardrails.md", "The non-negotiables. Every staff member is bound by these and cannot argue with them.", "md"],
  ["org/voice.md", "How everything they write reads. Change it once, and every surface changes on the next run.", "md"],
];

export function viewOrg(m) {
  const org = S.data;
  m.append(el("h1", { textContent: org.name + " · org" }));
  m.append(
    el("p", {
      className: "sub",
      textContent:
        "The layer every staff member inherits. Editing one of these reaches all " +
        org.staff.length + " of them on their next run.",
    }),
  );

  const facts = el("div", { className: "grid", style: "margin-bottom:18px" });
  const human = org.human ?? {};
  facts.append(
    kv("Organisation", esc(org.org), org.name),
    kv("They answer to", esc(human.name ?? human.github ?? "nobody"), human.github ? "@" + human.github : "no github handle in org.yaml"),
    kv("Staff", String(org.staff.length), org.staff.map((s) => s.handle).join(", ")),
  );
  m.append(facts);

  const split = el("div", { className: "split" });
  const tree = el("div", { className: "tree" });
  const viewer = el("div", { className: "viewer" });
  split.append(tree, viewer);
  m.append(split);

  const group = el("div", { className: "navgroup" });
  group.append(el("div", { className: "ghead", textContent: "The org layer" }));
  for (const [path, why] of DOCS) {
    const b = el("button", { className: "tfile tlayer", title: why });
    b.dataset.key = path;
    const t = el("span", { className: "t" });
    t.append(
      el("span", { className: "lname", textContent: path.replace(/^org\//, "") }),
      el("span", { className: "lrepo", textContent: why }),
    );
    b.append(t);
    b.onclick = () => open(path);
    group.append(b);
  }
  tree.append(group);

  /* Declared before the first `open()`, not after: `const` is not hoisted, and putting it
     below the call made the first paint fail with "cannot access 'full' before
     initialization" rather than rendering anything. */
  const full = (path) => S.data.opsName + "/" + path;

  open(S.orgOpen ?? DOCS[0][0]);

  function open(path) {
    S.orgOpen = path;
    writeHash(false);
    for (const o of tree.querySelectorAll(".tfile")) {
      o.setAttribute("aria-current", String(o.dataset.key === path));
    }
    show(path);
  }

  async function show(path) {
    viewer.replaceChildren(el("p", { className: "empty", textContent: "Loading…" }));
    let text;
    try {
      text = await getFile(full(path));
    } catch (e) {
      viewer.replaceChildren(el("p", { className: "empty err", textContent: e.message }));
      return;
    }
    render(path, text);
  }

  function render(path, text) {
    viewer.replaceChildren();
    const why = DOCS.find(([p]) => p === path)?.[1] ?? "";
    const head = el("div", { className: "row", style: "margin-bottom:4px" });
    head.append(el("span", { className: "meta", textContent: full(path) + " · " + kb(text.length) }));
    head.append(el("button", { className: "ghbtn", textContent: "Edit", onclick: () => edit(path, text) }));
    viewer.append(head, el("p", { className: "factsub", textContent: why }));

    if (path.endsWith(".yaml")) {
      viewer.append(el("pre", { className: "code", textContent: text }));
      return;
    }
    viewer.append(el("div", { className: "md doc", innerHTML: mdlite(text) }));
  }

  function edit(path, text) {
    viewer.replaceChildren();
    viewer.append(
      el("div", { className: "row", style: "margin-bottom:10px" }, [
        el("span", { className: "meta", textContent: full(path) }),
      ]),
    );

    const ta = el("textarea", { value: text, className: "editor" });
    viewer.append(ta);
    grow(ta);
    ta.addEventListener("input", () => grow(ta));

    const status = el("span", { className: "meta" });
    const save = el("button", { className: "ghbtn primary", textContent: "Save and commit" });
    const cancel = el("button", { className: "ghbtn", textContent: "Cancel" });
    cancel.onclick = () => render(path, text);
    viewer.append(el("div", { className: "row", style: "margin-top:10px" }, [save, cancel, status]));
    viewer.append(
      el("p", {
        className: "editnote",
        textContent:
          "Commits to " + S.data.opsName + " and pushes. Picked up by every staff member on their " +
          "next run." +
          (path.endsWith(".yaml")
            ? " org.yaml is checked before it is written: bad YAML, or a missing org or name, is refused rather than committed."
            : ""),
      }),
    );

    save.onclick = async () => {
      if (ta.value === text) {
        status.textContent = "nothing changed";
        return;
      }
      if (!confirm("Commit " + full(path) + " and push?\n\nEvery staff member picks this up on their next run.")) return;
      save.disabled = cancel.disabled = true;
      status.textContent = "committing…";
      status.className = "meta";
      try {
        const r = await post({ path: full(path), text: ta.value }, "/api/save");
        status.textContent = r.pushed
          ? "committed and pushed · " + r.sha
          : "committed " + r.sha + ", but the push failed: " + (r.note ?? "");
        status.className = r.pushed ? "meta ok" : "meta warn";
        render(path, ta.value);
      } catch (e) {
        // A refused org.yaml is the interesting case: the reason is the whole message.
        status.textContent = e.message;
        status.className = "meta err";
        save.disabled = cancel.disabled = false;
      }
    };
  }
}

function kv(label, value, sub) {
  const d = el("div", { className: "kv" });
  d.innerHTML =
    '<div class="k">' + esc(label) + '</div><div class="v">' + value +
    (sub ? "<small>" + esc(sub) + "</small>" : "") + "</div>";
  return d;
}
