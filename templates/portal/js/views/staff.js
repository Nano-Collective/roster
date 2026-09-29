/* The Staff screen: a card per staff member, retiring, and the way in to hiring.
 *
 * Hiring itself is in hire.js. Retiring runs the CLI's own `buildRetirePlan` and
 * `applyRetirePlan` on the server, plan then apply: you see what it stops and what it keeps,
 * and nothing happens until you say so.
 */

import { post } from "../api.js";
import { askYes, sheet } from "../dialog.js";
import { ago, el, esc } from "../dom.js";
import { whatsLeft, sentence } from "../readiness.js";
import { refreshAll } from "../refresh.js";
import { S } from "../state.js";
import { hireFlow, line, rolePicker } from "./hire.js";

/* The open dialog, if any. It lives on <body>, so it outlives a repaint of this screen, and a
   background refresh leaves whatever was typed into it alone. */
let current = null;

/**
 * @param {{open?: string, result?: object}} [o]  `open` keeps one staff member's steps on
 *   screen across a repaint, which is how a finished hire lands on step 2.
 */
export function viewStaff(m, o = {}) {
  m.append(el("h1", { textContent: "Staff" }));
  const empty = !S.data.staff.length;
  if (empty) m.append(el("p", { className: "sub", textContent: "No staff yet. Pick a role to hire your first." }));

  const pane = el("div", { className: "hirepane" });

  /* Tasks open in a dialog. Where there is no dialog element (the test shim) they draw into
     the pane instead, which is how this screen always drew them. */
  function present(node) {
    if (current?.isOpen()) {
      current.set(node);
      return;
    }
    current = sheet({
      node,
      onClose: () => {
        current = null;
        S.staffOpen = null;
      },
    });
    if (!current) pane.replaceChildren(node);
  }
  function dismiss() {
    if (current) current.close();
    else pane.replaceChildren();
    S.staffOpen = null;
    if (empty) pick();
  }

  // With nobody hired the roles are the page. After that they are a dialog behind Hire someone.
  function pick() {
    if (empty) {
      pane.replaceChildren(rolePicker({ onPick: (role) => open(role) }));
      return;
    }
    const cancel = el("button", { className: "ghbtn", textContent: "Cancel" });
    cancel.onclick = dismiss;
    present(
      el("div", {}, [
        el("h2", { className: "sheettitle", textContent: "Pick a role" }),
        rolePicker({ onPick: (role) => open(role) }),
        el("div", { className: "row", style: "margin-top:14px" }, [cancel]),
      ]),
    );
  }

  /* One staff member's steps, hired or not yet. A hire repaints the whole screen, so the new
     card is in the list and the steps reopen on the same person. */
  function open(role, result) {
    // Remembered, so a refresh after a trip to GitHub (creating the App) reopens it.
    S.staffOpen = role;
    present(
      hireFlow({
        role,
        result,
        onHired: (handle, r) => {
          m.replaceChildren();
          viewStaff(m, { open: handle, result: r });
        },
        onClose: dismiss,
      }),
    );
  }

  if (!empty) {
    const list = el("div", { className: "grid", style: "margin-bottom:18px" });
    for (const s of S.data.staff) list.append(card(s));
    // In the grid, where the next person would go, rather than a button under it.
    const hire = el("button", { className: "hirecard", textContent: "Hire someone" });
    hire.onclick = pick;
    list.append(hire);
    m.append(list);
  }
  m.append(pane);

  const opened = o.open && S.data.staff.find((s) => s.handle === o.open);
  const kept = !opened && S.staffOpen;
  const keptStaff = kept && S.data.staff.find((s) => s.handle === kept.handle);
  if (empty) pick();
  if (opened) open(roleOf(opened), o.result);
  // An open dialog is still open; only the inline fallback has to be drawn again.
  else if (kept && !current?.isOpen()) open(keptStaff ? roleOf(keptStaff) : kept);

  /* --------------------------- one staff member --------------------------- */

  function card(s) {
    const d = el("div", { className: "kv staffcard" });
    const rig = s.rig ?? {};
    d.innerHTML =
      '<div class="k">' + esc(s.handle) + "</div>" +
      '<div class="v">' + esc(s.name) +
        "<small>" + esc(s.brain ?? s.dir) + " · " + s.facts.length + " facts · " +
        (rig.lastCommit ? "last commit " + esc(ago(rig.lastCommit.date)) : "no commits") +
        "</small></div>";

    const status = el("span", { className: "meta" });
    const go = el("button", { className: "ghbtn", textContent: "Retire" });
    go.onclick = () => {
      const host = el("div");
      present(host);
      retireForm(host, s, status);
    };

    /* Every setup step (the App, the charter, the credential, a run) is in the one list, so the
       card has one way in. It says Finish setting up until setup looks finished: the charter
       from disk at once, and the App's secrets and a first run from GitHub when it answers. */
    const finish = el("button", { className: "ghbtn", textContent: "Set up" });
    finish.onclick = () => open(roleOf(s));
    const warn = el("p", { className: "warnline", hidden: true });
    whatsLeft(s).then((left) => {
      if (!left.length) return;
      finish.textContent = "Finish setting up";
      finish.className = "ghbtn primary";
      d.classList.add("notready");
      warn.hidden = false;
      warn.textContent = "Not ready to run. Still to do: " + sentence(left) + ".";
    });
    d.append(warn);

    d.append(
      el("div", { className: "row", style: "margin-top:10px" }, [finish, go, status]),
    );
    return d;
  }

  /* ------------------------------- retiring ------------------------------- */

  async function retireForm(host, s, cardStatus) {
    cardStatus.textContent = "planning…";
    cardStatus.className = "meta";
    let data;
    try {
      data = await (
        await fetch("/api/staff/plan?action=retire&handle=" + encodeURIComponent(s.handle), {
          cache: "no-store",
        })
      ).json();
      if (data.error) throw new Error(data.error);
    } catch (e) {
      cardStatus.textContent = e.message;
      cardStatus.className = "meta err";
      return;
    }
    cardStatus.textContent = "";

    const plan = data.plan;
    const box = el("div", { className: "plan" });
    box.append(el("h3", { textContent: "Retire " + plan.name + "?" }));
    box.append(el("div", { className: "planhead", textContent: "This would stop" }));
    for (const w of plan.workflows) box.append(line("stop", plan.dir + "/" + w + " disabled"));
    box.append(line("stop", "removed from org.yaml"));
    for (const p of plan.peers) {
      box.append(
        line("stop", "removed from " + p.dir + "/staff.yaml"),
        line("stop", p.label + " deleted from " + (p.brain ?? p.dir)),
      );
    }

    /* The point of retiring rather than deleting. Said as loudly as what it stops, because
       "this is not destructive" is the thing somebody needs to believe before clicking. */
    box.append(el("div", { className: "planhead keep", textContent: "This would keep" }));
    for (const k of plan.keeps) box.append(line("keep", k));
    for (const w of plan.warnings ?? []) box.append(line("warn", w));

    const status = el("span", { className: "meta" });
    const go = el("button", { className: "ghbtn", textContent: "Retire " + plan.handle });
    const cancel = el("button", { className: "ghbtn", textContent: "Cancel" });
    cancel.onclick = dismiss;
    go.onclick = () =>
      apply(
        { action: "retire", handle: plan.handle },
        { title: "Retire " + plan.name + "?", hint: (plan.brain ?? plan.dir) + " is not touched.", confirm: "Retire " + plan.handle },
        go,
        status,
        box,
      );
    box.append(el("div", { className: "row", style: "margin-top:14px" }, [go, cancel, status]));
    host.replaceChildren(box);
  }

  /* -------------------------------- apply -------------------------------- */

  async function apply(payload, ask, btn, status, box) {
    if (!(await askYes(ask))) return;
    btn.disabled = true;
    status.textContent = "working…";
    status.className = "meta";
    try {
      const r = await post(payload, "/api/staff/apply");
      status.textContent = r.ok ? "done" : "finished with problems";
      status.className = r.ok ? "meta ok" : "meta warn";
      // What the terminal would have printed, because that is the useful account of it.
      if (r.output) box.append(el("pre", { className: "code planout", textContent: r.output }));
      await refreshAll(true);
    } catch (e) {
      status.textContent = e.message;
      status.className = "meta err";
      btn.disabled = false;
    }
  }
}

/** The flow's view of somebody already hired. */
function roleOf(s) {
  return { handle: s.handle, name: s.name, dir: s.dir };
}
