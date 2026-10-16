/* People: who the staff answer to, and what each of them looks after. On the Org screen.
 *
 * Saving writes the humans list in org.yaml, and the server then puts each person's label on
 * every tracker and tells the mention callers who may wake a staff member, so somebody added
 * here can send work straight away. */

import { post } from "../api.js";
import { el } from "../dom.js";
import { refreshAll } from "../refresh.js";
import { S } from "../state.js";

export function peopleCard() {
  const start = (S.data?.people?.length ? S.data.people : (S.data?.humans ?? [])).map((h) => ({
    name: h.name ?? "",
    github: h.github ?? "",
    marker: h.marker ?? "",
    role: h.role ?? "",
    handles: (h.handles ?? []).join(", "),
    view_only: Boolean(h.viewOnly),
  }));
  const rows = start.map((p) => ({ ...p }));

  const list = el("div", { className: "peoplelist" });
  const note = el("span", { className: "meta" });
  const save = el("button", { className: "ghbtn primary", textContent: "Save" });
  const add = el("button", { className: "ghbtn", textContent: "Add a person" });

  const changed = () => JSON.stringify(rows) !== JSON.stringify(start);
  const stamp = () => {
    save.disabled = !changed();
  };

  function paint() {
    list.replaceChildren(
      el("div", { className: "peoplerow peoplehead", ariaHidden: "true" }, [
        el("span", { textContent: "Name" }),
        el("span", { textContent: "GitHub login" }),
        el("span", { textContent: "Looks after" }),
        el("span", { textContent: "Read only" }),
        el("span"),
      ]),
      ...rows.map((p, i) => row(p, i)),
    );
    stamp();
  }

  function row(p, i) {
    const input = (key, placeholder, label) => {
      const box = el("input", { type: "text", value: p[key], placeholder, ariaLabel: label });
      box.oninput = () => {
        p[key] = box.value;
        stamp();
      };
      return box;
    };
    const only = el("input", { type: "checkbox", checked: p.view_only, ariaLabel: "Read only" });
    only.onchange = () => {
      p.view_only = only.checked;
      stamp();
    };
    const remove = el("button", { className: "ghbtn danger", textContent: "Remove" });
    remove.onclick = () => {
      rows.splice(i, 1);
      paint();
    };
    return el("div", { className: "peoplerow" }, [
      input("name", "Name", "Name"),
      input("github", "login", "GitHub login"),
      input("handles", "e.g. marketing, content", "Looks after"),
      el("label", { className: "peopleonly" }, [only]),
      remove,
    ]);
  }

  add.onclick = () => {
    rows.push({ name: "", github: "", marker: "", role: "", handles: "", view_only: false });
    paint();
    list.querySelector(".peoplerow:last-child input")?.focus();
  };

  save.onclick = async () => {
    save.disabled = true;
    note.className = "meta";
    note.textContent = "Saving…";
    try {
      const r = await post({ people: rows.filter((p) => p.github.trim() || p.name.trim()) }, "/api/people");
      note.textContent = r.warnings?.length ? "Saved, but: " + r.warnings.join("; ") : "Saved.";
      if (r.warnings?.length) note.className = "meta warn";
      await refreshAll(false);
    } catch (e) {
      note.textContent = String(e.message || e);
      note.className = "meta err";
      stamp();
    }
  };

  paint();
  return el("div", { className: "card peoplecard" }, [
    el("h2", { textContent: "People" }),
    list,
    el("div", { className: "row" }, [add, save, note]),
  ]);
}
