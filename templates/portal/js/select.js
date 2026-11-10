/* Dropdowns: Astryx's Selector, drawn over the native <select> it stands in for.
 *
 * Every view builds a plain <select>, reads `.value` and listens for `change`, and none of that
 * changes. When one lands in the page, this puts Astryx's trigger beside it and hides it; the
 * <select> stays the one place the value lives. A pick sets it and fires `change` on it, and a
 * value set on it from code (or options added to it) repaints the trigger. The markup is
 * Selector's own, element by element, with the class strings in astryx-ui.js; css/astryx.css has
 * their rules unchanged, so this decides only what the control does, never what it looks like.
 *
 * What it does is the select-only combobox from the WAI-ARIA practices, which is what Selector
 * is: focus stays on the trigger and `aria-activedescendant` names the highlighted row. Closed,
 * the arrow keys, Enter and Space open it and typing picks by first letters, as a native one
 * does. Open, the arrows, Home and End move, Enter, Space and Tab pick, and Escape closes it
 * without closing the dialog it may sit in. The list is a popover, so the page's own top layer
 * and light dismiss do the rest, placed by CSS anchor positioning as Astryx places it.
 */

import { LAYER_STYLE, SELECTOR as C } from "./astryx-ui.js";

const CHEVRON = '<path d="M6 9l6 6 6-6"></path>';
const CHECK = '<path d="M5 13l4 4L19 7"></path>';
const svg = (body) =>
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
  'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="1em" height="1em" ' +
  `aria-hidden="true">${body}</svg>`;

const node = (tag, className, attrs = {}) => {
  const n = document.createElement(tag);
  if (className) n.className = className;
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

let ids = 0;

/** Puts the Astryx control beside one <select>. Calling it twice on the same one does nothing. */
export function enhanceSelect(select) {
  if (select.dataset.astryx || select.multiple || !select.isConnected) return;
  select.dataset.astryx = "1";
  // Read here rather than at load: the tests' DOM shim has no HTMLSelectElement.
  const PROTO = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  const INDEX = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "selectedIndex");
  const ANCHORED = globalThis.CSS?.supports?.("position-area: block-end") ?? false;
  const id = `axsel-${++ids}`;
  const anchor = `--${id}`;

  const host = node("span", "axselect");
  const frame = node("div", C.frame, { "data-variant": "input", "data-size": "md" });
  frame.style.setProperty("anchor-name", anchor);
  const button = node("button", C.button, {
    type: "button",
    role: "combobox",
    "aria-haspopup": "listbox",
    "aria-expanded": "false",
    "aria-controls": `${id}-list`,
  });
  const value = node("span", C.value);
  button.append(value);
  const chevron = node("span", C.chevron, {
    "aria-hidden": "true",
    "data-state": "collapsed",
    "data-size": "sm",
    "data-color": "secondary",
  });
  chevron.innerHTML = svg(CHEVRON);
  frame.append(button, chevron);

  const layer = node("div", C.layer, { popover: "auto", "data-layer-anchored": "" });
  layer.setAttribute("style", LAYER_STYLE.replaceAll("{anchor}", anchor));
  const inner = node("div", C.layerInner);
  const list = node("div", C.listbox, { id: `${id}-list`, role: "listbox" });
  inner.append(list);
  // A press on a row must not take focus from the trigger, which is where the keys go.
  list.addEventListener("pointerdown", (e) => e.preventDefault());
  layer.append(inner);
  host.append(frame, layer);

  // Whatever names the <select> names the control: its label, its title, its aria-label.
  for (const a of ["title", "aria-label"]) {
    if (select.hasAttribute(a)) button.setAttribute(a, select.getAttribute(a));
  }
  if (select.id) {
    const label = document.querySelector(`label[for="${CSS.escape(select.id)}"]`);
    if (label) {
      label.id ||= `${id}-label`;
      button.setAttribute("aria-labelledby", label.id);
      label.addEventListener("click", (e) => {
        e.preventDefault();
        button.focus();
      });
    }
  }
  list.setAttribute("aria-label", button.getAttribute("aria-label") ?? select.title ?? "");

  select.classList.add("axnative");
  select.after(host);

  let rows = [];
  let active = -1;
  let keyboard = false;

  const options = () => [...select.options];
  const enabled = (i) => i >= 0 && i < rows.length && !select.options[i].disabled;

  function paintValue() {
    const o = select.options[select.selectedIndex];
    value.textContent = o ? o.textContent : "";
    host.hidden = select.hidden;
    button.disabled = select.disabled;
  }

  function paintRows() {
    const chosen = select.selectedIndex;
    rows = options().map((o, i) => {
      const row = node("div", C.option, {
        id: `${id}-item-${i}`,
        role: "option",
        "aria-selected": String(i === chosen),
        "data-size": "md",
      });
      if (o.disabled) row.setAttribute("aria-disabled", "true");
      const main = node("span", C.optionMain);
      const line = node("div", C.optionRow, { "data-density": "balanced", "data-align": "center" });
      const outer = node("span", C.optionLabelOuter);
      const label = node("span", C.optionLabel);
      label.textContent = o.textContent;
      outer.append(label);
      line.append(outer);
      main.append(line);
      const end = node("span", C.optionEnd);
      if (i === chosen) {
        row.setAttribute("data-selected", "selected");
        const check = node("span", C.check, {
          "aria-hidden": "true",
          "data-size": "sm",
          "data-color": "accent",
        });
        check.innerHTML = svg(CHECK);
        end.append(check);
      }
      row.append(main, end);
      row.addEventListener("pointermove", () => {
        if (active !== i || keyboard) highlight(i, false);
      });
      row.addEventListener("click", () => {
        if (enabled(i)) pick(i);
      });
      return row;
    });
    list.replaceChildren(...rows);
  }

  /** The classes a row wears: Selector's, plus each state it is in, as React composes them. */
  function paintRow(i) {
    const row = rows[i];
    if (!row) return;
    const o = select.options[i];
    row.className = [
      C.option,
      i === active && C.highlighted,
      i === active && keyboard && C.keyboard,
      i === select.selectedIndex && C.selected,
      o?.disabled && C.disabled,
    ]
      .filter(Boolean)
      .join(" ");
  }

  function highlight(i, byKeyboard) {
    const was = active;
    active = i;
    keyboard = byKeyboard;
    paintRow(was);
    paintRow(i);
    if (i >= 0) {
      button.setAttribute("aria-activedescendant", rows[i].id);
      if (byKeyboard) rows[i].scrollIntoView({ block: "nearest" });
    } else button.removeAttribute("aria-activedescendant");
  }

  const isOpen = () => layer.matches(":popover-open");

  function open(byKeyboard) {
    if (isOpen() || button.disabled) return;
    paintRows();
    rows.forEach((_, i) => paintRow(i));
    layer.style.minInlineSize = `${frame.offsetWidth}px`;
    layer.showPopover();
    if (!ANCHORED) place();
    const start = enabled(select.selectedIndex) ? select.selectedIndex : step(-1, 1);
    highlight(start, byKeyboard);
  }

  function close() {
    if (isOpen()) layer.hidePopover();
  }

  /** Where anchor positioning is missing: under the trigger, or over it when there is no room. */
  function place() {
    const r = frame.getBoundingClientRect();
    const h = layer.offsetHeight;
    const below = r.bottom + h + 8 <= innerHeight || r.top < h + 8;
    layer.style.position = "fixed";
    layer.style.margin = "0";
    layer.style.left = `${Math.max(8, Math.min(r.left, innerWidth - layer.offsetWidth - 8))}px`;
    layer.style.top = below ? `${r.bottom + 4}px` : `${r.top - h - 4}px`;
  }

  function pick(i) {
    const changed = select.selectedIndex !== i;
    INDEX.set.call(select, i);
    paintValue();
    close();
    button.focus();
    if (changed) {
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  /** The next enabled row from `from` in direction `dir`, or `from` itself at either end. */
  function step(from, dir) {
    for (let i = from + dir; i >= 0 && i < select.options.length; i += dir) {
      if (!select.options[i].disabled) return i;
    }
    return from;
  }

  /* Typing picks by first letters: closed it changes the value, as a native one does; open
     it moves the highlight. A pause of a second starts a new word. */
  let typed = "";
  let typedAt = 0;
  function typeahead(ch) {
    const now = Date.now();
    typed = now - typedAt > 1000 ? ch : typed + ch;
    typedAt = now;
    const from = isOpen() ? active : select.selectedIndex;
    const all = options();
    const order = all.map((_, k) => (from + 1 + k) % all.length);
    // The same letter pressed again cycles through the options that start with it.
    const want = typed.split("").every((c) => c === typed[0]) ? typed[0] : typed;
    const hit = order.find(
      (i) => !all[i].disabled && all[i].textContent.trim().toLowerCase().startsWith(want),
    );
    if (hit === undefined) return;
    if (isOpen()) highlight(hit, true);
    else pick(hit);
  }

  button.addEventListener("click", () => (isOpen() ? close() : open(false)));
  // Light dismiss closes the popover on the pointerdown before this click, which would reopen
  // it at once. A press that starts on the trigger of an open list is a close, nothing more.
  button.addEventListener("pointerdown", (e) => {
    if (isOpen()) {
      e.preventDefault();
      close();
      button.addEventListener("click", (c) => c.stopImmediatePropagation(), {
        once: true,
        capture: true,
      });
    }
  });

  button.addEventListener("keydown", (e) => {
    const k = e.key;
    if (!isOpen()) {
      if (k === "ArrowDown" || k === "ArrowUp" || k === "Enter" || k === " ") {
        e.preventDefault();
        open(true);
        if (k === "ArrowUp") highlight(step(select.options.length, -1), true);
      } else if (k.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        typeahead(k.toLowerCase());
      }
      return;
    }
    if (k === "Escape") {
      // A dialog round this would close on the same key; this Escape is the list's.
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (k === "ArrowDown" || k === "ArrowUp") {
      e.preventDefault();
      if (e.altKey && k === "ArrowUp") {
        if (enabled(active)) pick(active);
        return;
      }
      highlight(step(active, k === "ArrowDown" ? 1 : -1), true);
    } else if (k === "Home" || k === "End") {
      e.preventDefault();
      highlight(k === "Home" ? step(-1, 1) : step(select.options.length, -1), true);
    } else if (k === "Enter" || k === " ") {
      e.preventDefault();
      if (enabled(active)) pick(active);
    } else if (k === "Tab") {
      if (enabled(active)) pick(active);
    } else if (k.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      typeahead(k.toLowerCase());
    }
  });

  layer.addEventListener("toggle", (e) => {
    const shown = e.newState === "open";
    button.setAttribute("aria-expanded", String(shown));
    button.className = shown ? C.buttonOpen : C.button;
    chevron.className = shown ? C.chevronOpen : C.chevron;
    chevron.setAttribute("data-state", shown ? "expanded" : "collapsed");
    if (!shown) highlight(-1, false);
  });

  /* Code that sets the value, swaps the options, hides or disables the <select> after this has
     run is still the source of truth: each of those repaints the trigger. */
  Object.defineProperty(select, "value", {
    configurable: true,
    get: () => PROTO.get.call(select),
    set: (v) => {
      PROTO.set.call(select, v);
      paintValue();
    },
  });
  Object.defineProperty(select, "selectedIndex", {
    configurable: true,
    get: () => INDEX.get.call(select),
    set: (v) => {
      INDEX.set.call(select, v);
      paintValue();
    },
  });
  new MutationObserver(() => {
    paintValue();
    if (isOpen()) paintRows();
  }).observe(select, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["hidden", "disabled", "selected"],
  });
  select.addEventListener("change", paintValue);

  paintValue();
}

/**
 * Every <select> the page gains from here on gets the control, so no view has to remember to
 * ask for it. Views build theirs detached and append them whole, so it is the arrival that is
 * watched, and the work waits for the end of the task: by then the view has set the value.
 */
export function installSelects(root = document.body) {
  // The tests' DOM shim has no observers, and with nothing to watch there is nothing to do.
  if (typeof MutationObserver !== "function") return;
  const sweep = (n) => {
    if (n.nodeType !== 1) return;
    if (n.tagName === "SELECT") enhanceSelect(n);
    else for (const s of n.querySelectorAll("select")) enhanceSelect(s);
  };
  new MutationObserver((records) => {
    const added = records.flatMap((r) => [...r.addedNodes]);
    if (added.length) queueMicrotask(() => added.forEach(sweep));
  }).observe(root, { childList: true, subtree: true });
  sweep(root);
}
