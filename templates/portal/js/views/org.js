/* The org layer, in one place.
 *
 * These files are what every staff member inherits. Editing `org/voice.md` once is the whole
 * extensibility story — the thing this arrangement exists to make possible — and until recently
 * you reached them through a staff member's Prompt screen, which is a strange route to a file
 * that belongs to nobody in particular.
 *
 * The list comes off disk rather than out of this file. It used to be five paths written here,
 * which meant a tenant that added `org/pricing.md` could not open it at all, and one that had
 * not written `org/business.md` yet got "not found" with nothing to do about it. Both are the
 * same mistake: a list of what a tenant *should* have, standing in for what it has.
 *
 * `org.yaml` is here too, and is the one file that stops every prompt composing when it is
 * wrong. The server validates it before writing.
 */

import { highlighted } from "../mdedit.js";
import { getFile, getOrgLayer, post } from "../api.js";
import { askYes } from "../dialog.js";
import { el, esc, grow, kb, skeleton } from "../dom.js";
import { icon } from "../icons.js";
import { mdlite } from "../md.js";
import { humansOf, S, writeHash } from "../state.js";
import { yamlPre } from "../yaml.js";
import { businessForm, fileModes, prioritiesForm } from "./orgedit.js";
import { repoPicker } from "./repos.js";

/* What the files roster itself ships are for, in one line each. A filename says nothing about
   which one to open; anything a tenant has added of its own falls back to its first heading. */
const KNOWN = {
  "org.yaml": "The people, repos, defaults and coding agent.",
  "org/business.md": "What the business is. Every staff member reads it.",
  "org/priorities.md": "This month's priorities, in order, and what's out of scope.",
  "org/operating.md": "What staff do on their own, what they ask about, and how a run starts and ends.",
  "org/guardrails.md": "Rules every staff member must follow.",
  "org/voice.md": "How staff write.",
  "prompts/daily.md": "The instructions for a scheduled run.",
  "prompts/mention.md": "The instructions when you @-mention someone.",
  "prompts/_identity.md": "Who staff post as.",
  "prompts/_paths.md": "Where files are during a run.",
};

const GROUPS = [
  ["org", "Org files", "Every staff member reads these."],
  ["prompts", "Prompts", "Roster's run instructions. Upgrades may change them."],
];

export function viewOrg(m) {
  const org = S.data;
  m.append(el("h1", { textContent: org.name + " · org" }));
  m.append(
    el("p", {
      className: "sub",
      textContent:
        "Files every staff member reads. Changes apply from their next run.",
    }),
  );

  const facts = el("div", { className: "grid", style: "margin-bottom:18px" });
  const humans = humansOf();
  facts.append(
    kv("Organisation", esc(org.org), org.name),
    /* Plural on purpose. An org can answer to more than one person, and a card that names one
       of two is worse than one that names neither: it reads as the only one who counts. */
    kv(
      "They answer to",
      humans.length
        ? humans.map((h) => esc(h.name ?? h.github)).join(", ")
        : "nobody",
      humans.length
        ? humans.map((h) => (h.github ? "@" + h.github : "no github handle")).join(" · ")
        : "org.yaml names no human, so nothing can wake an agent",
    ),
    kv("Staff", String(org.staff.length), org.staff.map((s) => s.handle).join(", ")),
  );
  m.append(facts);

  /* Marking a product repo after setup. The picker only lived on the setup screen, so a repo
     created later meant typing `role: product` into org.yaml by hand. Folded, because it asks
     GitHub for every repo in the org and most visits here are to read a file. */
  const repoPane = el("div");
  const repos = el("button", { className: "ghbtn", textContent: "Add a product repo" });
  repos.onclick = () => {
    if (repoPane.children.length) {
      repoPane.replaceChildren();
      return;
    }
    repoPane.replaceChildren(repoPicker({ org: org.org, onAdded: () => open("org.yaml") }));
  };
  m.append(el("div", { className: "row", style: "margin-bottom:14px" }, [repos]), repoPane);

  const split = el("div", { className: "split" });
  const tree = el("div", { className: "tree" });
  const viewer = el("div", { className: "viewer" });
  split.append(tree, viewer);
  m.append(split);

  const full = (path) => S.data.opsName + "/" + path;

  tree.replaceChildren(...skeleton("row", 6));
  getOrgLayer()
    .then(({ files }) => {
      S.orgFiles = files ?? [];
      paintTree();
      const first = S.orgFiles[0]?.path;
      open(S.orgFiles.some((f) => f.path === S.orgOpen) ? S.orgOpen : first);
    })
    .catch((e) => {
      tree.replaceChildren(el("p", { className: "empty err", textContent: e.message }));
    });

  function why(file) {
    return KNOWN[file.path] ?? file.title ?? "";
  }

  function paintTree() {
    tree.replaceChildren();
    if (!S.orgFiles.length) {
      tree.append(el("p", { className: "empty", textContent: "No org files here." }));
      return;
    }
    for (const [id, heading, note] of GROUPS) {
      const mine = S.orgFiles.filter((f) => (f.group ?? "org") === id);
      if (!mine.length) continue;
      const group = el("div", { className: "navgroup" });
      group.append(el("div", { className: "ghead", textContent: heading, title: note }));
      for (const f of mine) {
        const b = el("button", { className: "tfile tlayer", title: why(f) });
        b.dataset.key = f.path;
        const t = el("span", { className: "t" });
        t.append(
          el("span", { className: "lname", textContent: f.path.replace(/^(org|prompts)\//, "") }),
          el("span", { className: "lrepo", textContent: why(f) }),
        );
        b.append(t);
        b.onclick = () => open(f.path);
        group.append(b);
      }
      tree.append(group);
    }
  }

  function open(path) {
    if (!path) return;
    S.orgOpen = path;
    writeHash(false);
    for (const o of tree.querySelectorAll(".tfile")) {
      o.setAttribute("aria-current", String(o.dataset.key === path));
    }
    show(path);
  }

  async function show(path) {
    viewer.replaceChildren(...skeleton("head", 1), ...skeleton("line", 7));
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
    const head = el("div", { className: "row filehead" });
    head.append(el("span", { className: "meta", textContent: full(path) + " · " + kb(text.length) }));
    /* The edit control used to be a word in a row of grey text, which is why "there is no easy
       way to edit the org docs" was a fair thing to say about a screen that could edit them. */
    const file = S.orgFiles.find((f) => f.path === path) ?? { path };

    if (path.endsWith(".yaml") || path.endsWith(".yml")) {
      const edit = el("button", { className: "ghbtn primary editbtn", onclick: () => editor(path, text) });
      edit.append(icon("edit", "ic"), el("span", { textContent: "Edit" }));
      head.append(edit);
      viewer.append(head, el("p", { className: "factsub", textContent: why(file) }), yamlPre(text));
      return;
    }

    /* Prose files open on Read, with the ways to change them as tabs beside it: the same ones
       Getting started offers, because a file is no easier to write after setup than during it. */
    viewer.append(head, el("p", { className: "factsub", textContent: why(file) }));
    const read = { label: "Read", node: el("div", { className: "md doc", innerHTML: mdlite(text) }) };
    const o = { path: full(path), name: S.data.name, text, before: [read], onSaved: () => show(path) };
    viewer.append(
      path === "org/business.md"
        ? businessForm(o)
        : path === "org/priorities.md"
          ? prioritiesForm(o)
          : fileModes(o),
    );
  }

  function editor(path, text) {
    viewer.replaceChildren();
    const isYaml = /\.ya?ml$/.test(path);

    const status = el("span", { className: "meta" });
    const save = el("button", { className: "ghbtn primary", textContent: "Save and commit" });
    const cancel = el("button", { className: "ghbtn", textContent: "Cancel" });

    const bar = el("div", { className: "row filehead" });
    bar.append(el("span", { className: "meta", textContent: full(path) }), save, cancel, status);
    viewer.append(bar);

    const ta = el("textarea", { value: text, className: "editor" });
    const hl = highlighted(ta, isYaml ? "yaml" : "md");
    viewer.append(hl);
    grow(ta);
    hl.repaint();
    ta.addEventListener("input", () => grow(ta));
    // ⌘S is what a person's hands do in a text box. Without it, saving means finding a button
    // above a screenful of textarea you have just scrolled past.
    ta.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        commit();
      }
    });
    ta.focus?.();

    cancel.onclick = () => render(path, text);
    save.onclick = commit;

    viewer.append(
      el("p", {
        className: "editnote",
        textContent:
          "⌘S saves. Commits to " + S.data.opsName + " and pushes, and every staff member picks " +
          "it up on their next run." +
          (isYaml
            ? " org.yaml is checked before it is written: bad YAML, or a missing org or name, is refused rather than committed."
            : ""),
      }),
    );

    async function commit() {
      if (ta.value === text) {
        status.textContent = "nothing changed";
        status.className = "meta";
        return;
      }
      /* Only the manifest asks. A prose edit is one commit to revert and the agents pick it up
         on their next run; org.yaml is the file that can stop every prompt composing, and the
         portal has just told you it validates it. Asking every time taught people to click
         through the question, which is worse than not asking. */
      if (
        isYaml &&
        !(await askYes({
          title: "Commit " + full(path) + " and push?",
          hint: "Every staff member picks this up on their next run.",
          confirm: "Commit and push",
        }))
      ) {
        return;
      }
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
    }
  }
}

function kv(label, value, sub) {
  const d = el("div", { className: "kv" });
  d.innerHTML =
    '<div class="k">' + esc(label) + '</div><div class="v">' + value +
    (sub ? "<small>" + esc(sub) + "</small>" : "") + "</div>";
  return d;
}
