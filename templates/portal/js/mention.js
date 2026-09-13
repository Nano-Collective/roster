/* Typing `@` should offer the org.
 *
 * A mention is not decoration here: a staff member's workflow gates on their `@handle`, so a
 * reply that misspells it is a reply nobody is woken by, and a reply that spells a bot's login
 * where a handle belongs looks right and does nothing. Both failures are silent, which is the
 * kind this portal exists to stop. The roster is small and it is already on the page, so it is
 * offered rather than remembered.
 *
 * Everyone is here, and each row says what mentioning it actually does: a staff handle wakes
 * them, a human gets a notification, an App gets neither and is listed so you can recognise the
 * name rather than address it.
 */

import { el, esc } from "./dom.js";
import { humansOf, S } from "./state.js";

/**
 * Everyone a mention actually reaches, in the order they are worth offering.
 *
 * Staff first: waking one is the reason to type `@` in this app at all. Then the humans, who
 * get a notification.
 *
 * **The Apps are deliberately not here.** `@some-org-cto` is a login, not an inbox: GitHub
 * delivers nothing for mentioning a GitHub App, and an agent wakes on its own handle and not
 * on the name of the identity it posts as. A list you pick from should contain only things
 * that do something; an entry that says "notifies nobody" is a trap with a label on it, and it
 * pushed the entries that work off the bottom of the box.
 *
 * Nothing here knows what any of these people are called. Every row comes off `org.yaml` and
 * the manifests, so an org with a head of ops and a designer gets a head of ops and a designer.
 */
export function mentionable() {
  const out = [];

  for (const s of S.data?.staff ?? []) {
    const at = String(s.mention ?? "@" + s.handle);
    out.push({
      text: at,
      label: s.name ?? s.handle,
      note: "wakes them, usually within a minute",
      kind: "staff",
      terms: [at.replace(/^@/, ""), s.handle, s.name ?? ""],
    });
  }

  for (const h of humansOf()) {
    if (!h.github) continue;
    out.push({
      text: "@" + h.github,
      label: h.name ?? h.github,
      note: h.role ? h.role + " · notifies them" : "notifies them",
      kind: "human",
      terms: [h.github, h.name ?? ""],
    });
  }

  return out;
}

/** What is being typed after an `@`, or null. Only at a word boundary: an email is not a mention. */
export function queryAt(text, caret) {
  const before = String(text ?? "").slice(0, caret);
  const m = /(?:^|[\s(<[{>,;:"'`])@([A-Za-z0-9][\w.-]*)?$/.exec(before);
  if (!m) return null;
  const query = m[1] ?? "";
  return { query, start: caret - query.length - 1 };
}

/** The matches for a query, best first. Prefix beats substring; order beats neither. */
export function matches(query, all = mentionable()) {
  const q = query.toLowerCase();
  if (!q) return all;
  const rank = (c) => {
    const terms = c.terms.map((t) => String(t).toLowerCase()).filter(Boolean);
    if (terms.some((t) => t.startsWith(q))) return 0;
    if (terms.some((t) => t.includes(q))) return 1;
    return 2;
  };
  return all
    .map((c, i) => ({ c, i, r: rank(c) }))
    .filter((x) => x.r < 2)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.c);
}

/**
 * Wire a textarea up to the list.
 *
 * Attaching adds listeners and nothing else: the popup is built the first time somebody types
 * an `@`, so a screen that renders fifty boxes pays for none of them, and a DOM without
 * `getComputedStyle` (the test shim) never reaches the part that needs one.
 */
export function attachMentions(ta) {
  if (!ta?.addEventListener) return;

  let pop = null;
  let items = [];
  let at = 0;
  let anchor = null;

  const close = () => {
    if (pop) pop.hidden = true;
    anchor = null;
  };

  const open = (found, q) => {
    items = found;
    at = 0;
    anchor = q;
    if (!pop) {
      pop = el("div", { className: "mentions" });
      pop.setAttribute("role", "listbox");
      // mousedown, not click: the textarea must not lose the caret before the pick lands.
      pop.addEventListener("mousedown", (e) => {
        const row = e.target.closest?.("[data-at]");
        if (!row) return;
        e.preventDefault();
        pick(items[Number(row.dataset.at)]);
      });
      host(ta).append(pop);
    }
    pop.hidden = false;
    paint();
    place();
  };

  const paint = () => {
    pop.replaceChildren(
      ...items.map((c, i) => {
        const row = el("button", { className: "mrow " + c.kind, type: "button" });
        row.dataset.at = String(i);
        row.setAttribute("aria-selected", String(i === at));
        row.innerHTML =
          '<span class="mat">' + esc(c.text) + "</span>" +
          '<span class="mname">' + esc(c.label) + "</span>" +
          '<span class="mnote">' + esc(c.note) + "</span>";
        return row;
      }),
    );
  };

  const move = (by) => {
    at = (at + by + items.length) % items.length;
    paint();
    pop.children[at]?.scrollIntoView?.({ block: "nearest" });
  };

  const pick = (choice) => {
    if (!choice || !anchor) return;
    const caret = ta.selectionStart ?? ta.value.length;
    const after = ta.value.slice(caret);
    // A space, unless there already is one: nobody wants to type it and nobody wants two.
    const tail = /^\s/.test(after) ? "" : " ";
    ta.value = ta.value.slice(0, anchor.start) + choice.text + tail + after;
    const to = anchor.start + choice.text.length + tail.length;
    ta.setSelectionRange?.(to, to);
    close();
    ta.focus?.();
    // So the box's own listeners — the draft, the grow, the "this is what wakes them" line —
    // see the text that is now in it.
    if (typeof Event === "function") ta.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const look = () => {
    const caret = ta.selectionStart ?? 0;
    const q = queryAt(ta.value, caret);
    if (!q) return close();
    const found = matches(q.query);
    if (!found.length) return close();
    open(found, q);
  };

  ta.addEventListener("input", look);
  ta.addEventListener("click", close);
  ta.addEventListener("blur", close);
  ta.addEventListener("keydown", (e) => {
    if (!anchor || !pop || pop.hidden) return;
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); move(-1); return; }
    if (e.key === "Enter" || e.key === "Tab") {
      // ⌘⏎ is "send", and it means that whether or not this list is open.
      if (e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      // Nothing else on the page may see it: in a dialog, a stray Enter submits.
      e.stopPropagation();
      pick(items[at]);
      return;
    }
    if (e.key === "Escape") {
      // Dismiss the list, not the dialog around it.
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  });

  /** Where the popup lives: the first positioned ancestor, so a modal keeps it on top. */
  function host(node) {
    const parent = node.parentElement ?? node.parentNode;
    if (!parent) return node;
    if (typeof getComputedStyle === "function" && getComputedStyle(parent).position === "static") {
      parent.style.position = "relative";
    }
    return parent;
  }

  /**
   * Under the caret, not under the box.
   *
   * Measured with a mirror: a div with the textarea's own metrics, holding the text up to the
   * caret and a marker after it. There is no other way to ask a textarea where its caret is.
   * If any of that is unavailable, it falls back to the bottom of the box, which is worse but
   * never wrong.
   */
  function place() {
    const under = ta.offsetTop + ta.offsetHeight;
    let top = under;
    let left = ta.offsetLeft;
    let line = 18;
    if (typeof getComputedStyle === "function" && ta.parentElement) {
      const style = getComputedStyle(ta);
      const mirror = el("div", { className: "mmirror" });
      for (const prop of [
        "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing", "textTransform",
        "lineHeight", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
        "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
      ]) {
        mirror.style[prop] = style[prop];
      }
      mirror.style.width = ta.offsetWidth + "px";
      mirror.style.left = ta.offsetLeft + "px";
      mirror.style.top = ta.offsetTop + "px";
      mirror.textContent = ta.value.slice(0, ta.selectionStart ?? 0);
      const mark = el("span", { textContent: "​" });
      mirror.append(mark);
      ta.parentElement.append(mirror);
      line = Number.parseFloat(style.lineHeight) || 18;
      top = ta.offsetTop + mark.offsetTop - (ta.scrollTop ?? 0) + line;
      left = ta.offsetLeft + mark.offsetLeft;
      mirror.remove();
      // A caret near the bottom of a long box would put the list off the card.
      if (top > under) top = under;
    }
    pop.style.top = Math.round(top) + "px";
    pop.style.left = Math.round(left) + "px";

    /* Both edges, measured after placing, because until it is placed it has no size.
       A `<dialog>` scrolls its own box, so anything hanging outside it is not merely ugly:
       it is clipped, and the entries you were about to pick are the ones that go missing. */
    const host = pop.offsetParent ?? pop.parentElement;
    const wide = host?.clientWidth ?? 0;
    if (wide && left + pop.offsetWidth > wide - 8) {
      pop.style.left = Math.max(0, Math.round(wide - pop.offsetWidth - 8)) + "px";
    }
    const tall = host?.clientHeight ?? 0;
    if (tall && top + pop.offsetHeight > tall - 8) {
      // Above the line being typed if it fits there, which is where an editor would put it.
      // Otherwise as low as it can sit and still be whole.
      const above = top - line - pop.offsetHeight;
      pop.style.top =
        Math.round(above >= 0 ? above : Math.max(0, tall - pop.offsetHeight - 8)) + "px";
    }
  }
}
