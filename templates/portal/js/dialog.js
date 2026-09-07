/* Asking for more than a sentence.
 *
 * `prompt()` is one line with no wrapping, which is the wrong shape for describing a change to
 * a prompt: the useful answers are two or three sentences and often a bullet list. Native
 * `<dialog>` gives the backdrop, the focus trap and Escape without any of it being written
 * here, which is the whole reason to use it rather than a div.
 */

import { el, grow } from "./dom.js";

/**
 * @returns the text, or null if they cancelled.
 */
export function askText({ title, hint, value = "", placeholder = "", confirm = "Continue" }) {
  const box = document.createElement("dialog");
  // The shim in the tests has no dialog element. Falling back keeps a view renderable there
  // rather than throwing halfway through a paint.
  if (typeof box.showModal !== "function") {
    return Promise.resolve(globalThis.prompt?.(title, value) ?? null);
  }

  box.className = "ask";
  box.append(el("h3", { textContent: title }));
  if (hint) box.append(el("p", { className: "askhint", textContent: hint }));

  const ta = el("textarea", { value, placeholder, rows: 5 });
  box.append(ta);

  const cancel = el("button", { className: "ghbtn", textContent: "Cancel" });
  const go = el("button", { className: "ghbtn primary", textContent: confirm });
  box.append(
    el("div", { className: "row askrow" }, [
      el("span", { className: "meta", textContent: "⌘⏎ to " + confirm.toLowerCase() }),
      cancel,
      go,
    ]),
  );

  return new Promise((resolve) => {
    let answer = null;
    const done = (text) => {
      answer = text;
      box.close();
    };
    cancel.onclick = () => done(null);
    go.onclick = () => done(ta.value.trim() || null);
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        done(ta.value.trim() || null);
      }
    });
    // Escape and the backdrop both close it, and both mean no.
    box.addEventListener("close", () => {
      box.remove();
      resolve(answer);
    });
    box.addEventListener("click", (e) => {
      if (e.target === box) done(null);
    });

    document.body.append(box);
    box.showModal();
    grow(ta);
    ta.focus();
    // Put the caret at the end of a pre-filled answer rather than selecting it, so typing
    // adds to what a finding already said instead of replacing it.
    ta.setSelectionRange?.(ta.value.length, ta.value.length);
  });
}
