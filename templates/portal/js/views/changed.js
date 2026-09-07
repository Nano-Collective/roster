/* What this agent learned and forgot, and the diff that did it. */

import { diffUrl } from "../api.js";
import { el, esc, markCurrent } from "../dom.js";
import { S, staff, writeHash } from "../state.js";

export function viewChanged(m) {
  const s = staff();
  m.append(el("h1", { textContent: s.handle.toUpperCase() + " · what changed" }));
  m.append(el("p", { className: "sub", textContent:
    "What this agent learned and forgot. Click any row to see the diff that did it." }));

  const filter = el("input", { type: "search", placeholder: "Filter by slug or commit…", value: S.changedQuery });
  const only = el("select");
  only.append(el("option", { value: "", textContent: "Everything" }),
              el("option", { value: "added", textContent: "Learned" }),
              el("option", { value: "removed", textContent: "Forgotten" }));
  only.value = S.changedFilter;
  m.append(el("div", { className: "row", style: "margin-bottom:16px" }, [filter, only]));

  const split = el("div", { className: "split" });
  const list = el("div", { className: "tree" });
  const viewer = el("div", { className: "viewer" });
  split.append(list, viewer);
  m.append(split);
  viewer.append(el("p", { className: "empty", textContent: "Pick a change." }));

  filter.oninput = () => { S.changedQuery = filter.value; writeHash(false); paint(); };
  only.onchange = () => { S.changedFilter = only.value; paint(); };
  paint();

  function paint() {
    const q = S.changedQuery.trim().toLowerCase();
    list.replaceChildren();

    const facts = s.factsChanged.filter((c) =>
      (!S.changedFilter || c.change === S.changedFilter) &&
      (!q || (c.slug + " " + c.sha).toLowerCase().includes(q)));

    if (facts.length) {
      const byDay = new Map();
      for (const c of facts) {
        const d = c.date.slice(0, 10);
        if (!byDay.has(d)) byDay.set(d, []);
        byDay.get(d).push(c);
      }
      for (const [day, items] of byDay) {
        list.append(el("div", { className: "tdir", textContent: day }));
        for (const c of items) {
          const b = el("button", { className: "tfile" });
          b.innerHTML = '<span class="' + (c.change === "added" ? "ok" : "err") + '" style="flex:none">' +
            (c.change === "added" ? "+" : "−") + '</span><span class="t">' + esc(c.slug) + "</span>" +
            "<i>" + esc(c.sha.slice(0, 7)) + "</i>";
          b.onclick = () => { markCurrent(list, b); showDiff(viewer, s, c.sha, "memory/INDEX.md", c.slug); };
          list.append(b);
        }
      }
    }

    const commits = s.recentCommits.filter((c) => !q || (c.subject + " " + c.sha).toLowerCase().includes(q));
    if (commits.length && !S.changedFilter) {
      list.append(el("div", { className: "tdir", textContent: "commits" }));
      for (const c of commits.slice(0, 25)) {
        const b = el("button", { className: "tfile", title: c.subject });
        b.append(el("span", { className: "t", textContent: c.subject }));
        b.append(el("i", { textContent: c.sha.slice(0, 7) }));
        b.onclick = () => { markCurrent(list, b); showDiff(viewer, s, c.sha, "", null); };
        list.append(b);
      }
    }

    if (!list.children.length) list.append(el("p", { className: "empty", textContent: "Nothing matches." }));
  }
}

async function showDiff(viewer, s, sha, path, highlight) {
  viewer.replaceChildren(el("p", { className: "empty", textContent: "Loading diff…" }));
  const res = await fetch(diffUrl(s.dir, sha, path));
  if (!res.ok) { viewer.replaceChildren(el("p", { className: "empty err", textContent: "Could not load that diff." })); return; }
  const text = await res.text();

  // The first line is author\x1fdate\x1fsubject, prepended by the endpoint.
  const nl = text.indexOf("\n");
  const [author, date, subject] = text.slice(0, nl).split("\x1f");
  const body = text.slice(nl + 1);

  const head = el("div", { style: "margin-bottom:12px" }, [
    el("div", { style: "font-weight:600", textContent: subject ?? sha }),
    el("div", { className: "meta", textContent: sha + " · " + new Date(date).toLocaleString() + " · " + author }),
  ]);

  viewer.replaceChildren(head, ...renderDiff(body, highlight));
  const focus = viewer.querySelector(".dfocus");
  if (focus && focus.scrollIntoView) focus.scrollIntoView({ block: "center" });
}

/**
 * A unified diff as something you can read: one block per file, coloured rows, and the two
 * line-number gutters git leaves out. The noise git puts between files — index lines, mode
 * changes, the +++/--- pair — is dropped, because the filename is already the heading.
 */
export function renderDiff(body, highlight) {
  const blocks = [];
  let block = null, oldNo = 0, newNo = 0;

  const start = (name) => {
    block = { name, added: 0, removed: 0, rows: el("div", { className: "diff" }) };
    blocks.push(block);
  };
  const push = (cls, a, b, text) => {
    if (!block) start("");
    const r = el("div", { className: "dline" + (cls ? " " + cls : "") });
    r.append(el("span", { className: "ln", textContent: a }),
             el("span", { className: "ln", textContent: b }),
             el("span", { className: "tx", textContent: text }));
    // The fact whose change you clicked, marked so the scroll lands on it.
    if (highlight && text.includes("`" + highlight + "`")) r.classList.add("dfocus");
    block.rows.append(r);
  };

  for (const line of body.split("\n")) {
    if (line.startsWith("diff --git")) {
      const m = /\sb\/(.+)$/.exec(line);
      start(m ? m[1] : line.replace(/^diff --git\s*/, ""));
      continue;
    }
    if (/^(index |--- |\+\+\+ |new file|deleted file|similarity |rename |old mode|new mode|Binary )/.test(line)) continue;

    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      push("dhunk", "", "", (hunk[3] || "").trim() || "@@");
      continue;
    }
    if (!line) continue;                       // a blank context line is " ", not ""
    if (line.startsWith("+")) { push("dadd", "", String(newNo++), line.slice(1)); block.added++; continue; }
    if (line.startsWith("-")) { push("ddel", String(oldNo++), "", line.slice(1)); block.removed++; continue; }
    if (line.startsWith("\\")) { push("dmeta", "", "", line); continue; }
    push("", String(oldNo++), String(newNo++), line.slice(1));
  }

  if (!blocks.length) {
    return [el("p", { className: "dempty", textContent: "This commit changed nothing in that file." })];
  }

  return blocks.map((b) => {
    const wrap = el("div", { className: "dblock" });
    const h = el("div", { className: "dfile" });
    h.innerHTML = "<b>" + esc(b.name || "changes") + "</b>" +
      '<span class="p">+' + b.added + "</span>" +
      '<span class="m">−' + b.removed + "</span>";
    wrap.append(h, b.rows);
    return wrap;
  });
}
