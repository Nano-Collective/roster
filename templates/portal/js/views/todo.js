/* The numbered step card shared by Getting started and the hiring flow on the Staff screen. */

import { el } from "../dom.js";

/**
 * One numbered thing to do. Done ones fold to a single ticked line, and Change opens them again,
 * so the list shows what is left without hiding what was done.
 *
 * `setLocked(reason)` greys a step that cannot start yet and says why in the pill; `null`
 * unlocks it. A locked step shows no body, because a form you cannot use yet is a trap.
 */
export function todo(n, title, done) {
  const card = el("section", { className: "todo" });
  const num = el("span", { className: "todon" });
  const pill = el("span", { className: "todopill" });
  const change = el("button", { className: "ghbtn todochange", textContent: "Change" });
  const head = el("div", { className: "todohead" }, [num, el("h3", { textContent: title }), pill, change]);
  const hintEl = el("p", { className: "sub todohint" });
  const body = el("div", { className: "todobody" });
  card.append(head, hintEl, body);
  let open = false;
  let locked = null;
  let isDone = done;
  const paint = () => {
    card.classList.toggle("done", isDone && !locked);
    card.classList.toggle("locked", Boolean(locked));
    num.textContent = isDone && !locked ? "✓" : String(n);
    pill.textContent = locked ?? (isDone ? "Done" : "To do");
    change.hidden = !isDone || Boolean(locked);
    const shown = !locked && (!isDone || open);
    body.hidden = !shown;
    hintEl.hidden = !shown || !hintEl.textContent;
  };
  const setDone = (d) => {
    isDone = Boolean(d);
    paint();
  };
  change.onclick = () => {
    open = !open;
    change.textContent = open ? "Close" : "Change";
    paint();
  };
  paint();
  return {
    card,
    body,
    setDone,
    isDone: () => isDone,
    setLocked: (reason) => {
      locked = reason || null;
      paint();
    },
    renumber: (m) => {
      n = m;
      paint();
    },
    hint: (text) => {
      hintEl.textContent = text;
      paint();
    },
  };
}
