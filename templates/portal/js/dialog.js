/* Asking for more than a sentence.
 *
 * `prompt()` is one line with no wrapping, which is the wrong shape for describing a change to
 * a prompt: the useful answers are two or three sentences and often a bullet list. Native
 * `<dialog>` gives the backdrop, the focus trap and Escape without any of it being written
 * here, which is the whole reason to use it rather than a div.
 */

import { el, grow } from "./dom.js";
import { attachMentions } from "./mention.js";

/**
 * Whether a click was on the backdrop, which is not the same question as "is the target the
 * dialog".
 *
 * Picking a name from the `@` list used to close the whole dialog and throw away what you had
 * typed. The list hides itself on mousedown so the caret survives the pick, so by the time the
 * `click` lands the row is gone and the event retargets to the nearest thing still under the
 * pointer, which is the dialog. A target test alone reads that as a backdrop click.
 *
 * So the pointer has to actually be outside the dialog's own box. `detail` of 0 is a click
 * synthesised by the keyboard, which reports 0,0 and would otherwise look like the top corner
 * of the page.
 */
export function onBackdrop(e, rect) {
  if (!rect || e.currentTarget !== e.target || !e.detail) return false;
  return (
    e.clientX < rect.left ||
    e.clientX > rect.right ||
    e.clientY < rect.top ||
    e.clientY > rect.bottom
  );
}

/**
 * @param decorate  given the textarea, returns a node to sit under it. This is how the reply
 *   box carries its attachments: the control has to write into the box it is beside.
 * @param allowEmpty  saying nothing is an answer for some of these. Closing an issue without
 *   a parting comment is the normal case, not a cancelled dialog.
 * @returns the text, or null if they cancelled.
 */
export function askText({
  title,
  hint,
  value = "",
  placeholder = "",
  confirm = "Continue",
  decorate,
  allowEmpty = false,
}) {
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
  /* Before the ⌘⏎ handler below, so that when the `@` list is open its own Enter wins. Every
     dialog this function opens is prose that may need to reach somebody, and a mention is how
     it reaches them. */
  attachMentions(ta);
  const under = decorate?.(ta);
  if (under) box.append(under);

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
    const said = () => ta.value.trim() || (allowEmpty ? "" : null);
    cancel.onclick = () => done(null);
    go.onclick = () => done(said());
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        done(said());
      }
    });
    // Escape and the backdrop both close it, and both mean no.
    box.addEventListener("close", () => {
      box.remove();
      resolve(answer);
    });
    box.addEventListener("click", (e) => {
      if (onBackdrop(e, box.getBoundingClientRect?.())) done(null);
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

/**
 * Asking before something that cannot be taken back: a merge, a push, a new repo, a paid run.
 *
 * Native `confirm()` looked like the browser rather than this page, and it blocks the whole
 * tab, which froze browser automation mid-run. This is the same `<dialog>` as askText, so the
 * backdrop, Escape and the focus trap come free. The wording is the caller's: `title` is the
 * question, `hint` says what will happen.
 *
 * @returns true only for the confirm button. Escape, Cancel and the backdrop are all no.
 */
export function askYes({ title, hint, confirm = "Continue" }) {
  const box = document.createElement("dialog");
  // The test shim has no dialog element; see askText.
  if (typeof box.showModal !== "function") {
    return Promise.resolve(Boolean(globalThis.confirm?.(hint ? title + "\n\n" + hint : title)));
  }

  box.className = "ask";
  box.append(el("h3", { textContent: title }));
  if (hint) box.append(el("p", { className: "askhint", textContent: hint }));

  const cancel = el("button", { className: "ghbtn", textContent: "Cancel" });
  const go = el("button", { className: "ghbtn primary", textContent: confirm });
  box.append(el("div", { className: "row askrow" }, [cancel, go]));

  return new Promise((resolve) => {
    let answer = false;
    const done = (yes) => {
      answer = yes;
      box.close();
    };
    cancel.onclick = () => done(false);
    go.onclick = () => done(true);
    box.addEventListener("close", () => {
      box.remove();
      resolve(answer);
    });
    box.addEventListener("click", (e) => {
      if (onBackdrop(e, box.getBoundingClientRect?.())) done(false);
    });
    document.body.append(box);
    box.showModal();
    // Cancel has the focus, so an Enter pressed out of habit does not merge anything.
    cancel.focus();
  });
}

/**
 * A larger dialog for a whole task: hiring someone, or finishing their setup. Native <dialog>
 * again, appended to <body> rather than to the screen, so a background refresh repainting the
 * screen leaves it open with whatever was typed into it.
 *
 * @returns {{set: (node: Node) => void, close: () => void, isOpen: () => boolean} | null}
 *   null where there is no dialog element (the test shim), and the caller draws inline instead.
 */
export function sheet({ node, onClose }) {
  const box = document.createElement("dialog");
  if (typeof box.showModal !== "function") return null;
  box.className = "sheet";
  const body = el("div", { className: "sheetbody" });
  body.append(node);
  box.append(body);
  let open = true;
  const close = () => {
    if (!open) return;
    open = false;
    box.close();
    box.remove();
    onClose?.();
  };
  box.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  box.addEventListener("click", (e) => {
    if (onBackdrop(e, box.getBoundingClientRect())) close();
  });
  document.body.append(box);
  box.showModal();
  return { set: (n) => body.replaceChildren(n), close, isOpen: () => open };
}
