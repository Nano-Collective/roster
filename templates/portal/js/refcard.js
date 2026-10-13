/* What a #175 is, without leaving the page.
 *
 * Half of a status report is issue numbers, and the only way to find out what one was used to
 * be a click through to GitHub, which is a new tab and the end of whatever you were reading.
 * Hovering one now shows a card with its title, state and opening lines, the way GitHub does,
 * and clicking it opens the thread in a side sheet over the page you were on.
 *
 * Only for the org's own repos: the server reads nothing else, so a chip pointing anywhere
 * else stays a plain link. ⌘-click and middle-click still go to GitHub, as a link should.
 */

import { getRepos, getThread } from "./api.js";
import { ago, el, esc } from "./dom.js";
import { iconHTML } from "./icons.js";
import { openThread } from "./views/home.js";
import { tone } from "./views/inbox.js";

const REF_HREF = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(?:issues|pull)\/(\d+)/;
const SHOW_AFTER = 350;
const HIDE_AFTER = 200;
// Long enough to hover the same few numbers on a report without asking again; short enough
// that a card is not an hour out of date.
const FRESH_FOR = 5 * 60_000;

let known = null;
const cache = new Map();
let card = null;
let showing = null;
let showTimer = 0;
let hideTimer = 0;

export function installRefs() {
  /* Read once, off disk. A failure leaves every chip a plain link, which is what they were. */
  getRepos()
    .then((r) => {
      known = new Set((r?.repos ?? []).map((x) => x.owner + "/" + x.name));
    })
    .catch(() => {});

  document.addEventListener?.("click", (e) => {
    const ref = refOf(e.target);
    if (!ref || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    hide();
    openThread(ref);
  });

  document.addEventListener?.("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    if (card?.contains(e.target)) {
      clearTimeout(hideTimer);
      return;
    }
    const a = e.target?.closest?.("a.ref");
    const ref = refOf(e.target);
    if (!ref) return;
    clearTimeout(hideTimer);
    if (showing === a) return;
    // The card says everything the native tooltip did, and both at once is clutter.
    a.removeAttribute("title");
    clearTimeout(showTimer);
    showTimer = setTimeout(() => show(a, ref), SHOW_AFTER);
  });

  document.addEventListener?.("pointerout", (e) => {
    const from = e.target?.closest?.("a.ref, .refcard");
    if (!from || from.contains(e.relatedTarget)) return;
    clearTimeout(showTimer);
    hideTimer = setTimeout(hide, HIDE_AFTER);
  });

  addEventListener?.("keydown", (e) => e.key === "Escape" && hide());
  addEventListener?.("scroll", hide, true);
  addEventListener?.("hashchange", hide);
}

/** The repo and number a chip points at, if it is one of the org's own. */
function refOf(target) {
  const a = target?.closest?.("a.ref");
  if (!a || !known) return null;
  const m = REF_HREF.exec(a.getAttribute("href") ?? "");
  if (!m || !known.has(m[1])) return null;
  return { repo: m[1], number: Number(m[2]), kind: a.classList.contains("pr") ? "pr" : undefined };
}

function peek(ref) {
  const key = ref.repo + "#" + ref.number;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < FRESH_FOR) return hit.p;
  const p = getThread(ref.repo, ref.number, ref.kind ?? "").then((t) => {
    if (!t || t.error) throw new Error(t?.error ?? "could not read it");
    return t;
  });
  // A failure is not kept: the next hover asks again.
  p.catch(() => cache.delete(key));
  cache.set(key, { at: Date.now(), p });
  return p;
}

function show(a, ref) {
  if (!a.isConnected) return;
  showing = a;
  ensureCard();
  card.replaceChildren(
    el("div", { className: "rcmeta", textContent: ref.repo + " #" + ref.number }),
    el("div", { className: "sk sk-line" }),
    el("div", { className: "sk sk-line" }),
  );
  open(a);
  peek(ref)
    .then((t) => {
      if (showing === a) {
        fill(t);
        place(a);
      }
    })
    .catch((e) => {
      if (showing !== a) return;
      card.replaceChildren(
        el("div", { className: "rcmeta", textContent: ref.repo + " #" + ref.number }),
        el("p", {
          className: "rcbody",
          // A bare #213 is read as this repo's, and the writer often meant another one.
          textContent: /could not resolve|not found/i.test(e.message)
            ? "There is no #" + ref.number + " in " + ref.repo + "."
            : "Couldn't read it: " + e.message,
        }),
      );
    });
}

function fill(t) {
  const merged = t.state === "MERGED";
  const shut = t.state !== "OPEN";
  const glyph = merged ? "merged" : t.draft ? "draft" : shut ? "issue-closed" : "issue-open";
  const word = merged ? "Merged" : shut ? "Closed" : t.draft ? "Draft" : "Open";
  const excerpt = plain(t.body);
  const comments = t.commentCount ?? t.comments?.length ?? 0;

  card.innerHTML =
    '<div class="rcmeta">' +
      '<span class="rcstate ' + (merged ? "merged" : shut ? "closed" : "open") + '">' +
        iconHTML(glyph) + word + "</span>" +
      "<span>" + esc(t.repo) + " " + (t.kind === "pr" ? "PR " : "") + "#" + t.number + "</span>" +
    "</div>" +
    '<div class="rctitle">' + esc(t.title) + "</div>" +
    (excerpt ? '<p class="rcbody">' + esc(excerpt) + "</p>" : "") +
    (t.labels?.length
      ? '<div class="rclabels">' +
        t.labels.map((l) => '<span class="chip ' + tone(l) + '">' + esc(l) + "</span>").join("") +
        "</div>"
      : "") +
    '<div class="rcfoot">' +
      esc(t.author) + " · updated " + ago(t.updatedAt) +
      (comments ? " · " + comments + (comments === 1 ? " comment" : " comments") : "") +
    "</div>";
}

/** The opening of a body as a sentence: no headings, tables, images or link syntax. */
function plain(body) {
  const text = String(body ?? "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .split("\n")
    .map((l) => l.replace(/^\s*(#{1,6}\s+|>\s?|[-*+]\s+(\[[ x]\]\s+)?|\d+\.\s+)/i, "").trim())
    .filter((l) => l && !/^\|/.test(l) && !/^[-|:\s]+$/.test(l))
    .join(" ")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 220 ? text.slice(0, 219).trimEnd() + "…" : text;
}

function ensureCard() {
  if (card) return;
  card = el("div", { className: "refcard", role: "tooltip" });
  /* A popover goes in the top layer, so the card shows over an open side sheet too. A plain
     fixed div would sit underneath a modal <dialog> however high its z-index. */
  if (typeof card.showPopover === "function") card.setAttribute("popover", "manual");
  document.body.append(card);
}

function open(a) {
  // The top layer is ordered by when things were shown. Reopening puts the card above a
  // sheet that opened after it last showed.
  if (card.matches?.(":popover-open")) card.hidePopover();
  if (typeof card.showPopover === "function") card.showPopover();
  else card.hidden = false;
  card.classList.add("on");
  place(a);
}

/** Under the chip, or above it when there is no room below; never off the side. */
function place(a) {
  const r = a.getBoundingClientRect();
  const w = card.offsetWidth;
  const h = card.offsetHeight;
  const gap = 8;
  const left = Math.max(12, Math.min(r.left, innerWidth - w - 12));
  const below = r.bottom + gap + h <= innerHeight - 12;
  const top = below ? r.bottom + gap : Math.max(12, r.top - gap - h);
  card.style.left = left + "px";
  card.style.top = top + "px";
}

function hide() {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  showing = null;
  if (!card) return;
  card.classList.remove("on");
  if (card.matches?.(":popover-open")) card.hidePopover();
  else if (typeof card.showPopover !== "function") card.hidden = true;
}
