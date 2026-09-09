/* Re-reading the world, and saying so.
 *
 * Everything is read from disk per request, so a refresh is just re-fetching. Without it a
 * run that lands while the page is open stays invisible until a reload, which is what made
 * the diffs look days old.
 *
 * Its own module because both the shell and the inbox need it, and importing the shell from
 * a view would make the module graph a ring. */

import { getOrg, getSync } from "./api.js";
import { $, ago, el, esc } from "./dom.js";
import { render } from "./router.js";
import { S } from "./state.js";

export async function refreshAll(soft) {
  const bar = $("#refreshall");
  bar?.classList.add("spin");
  try {
    // Pull first. The portal reads the working tree, so a run that has landed on GitHub is
    // invisible here until the checkout catches up.
    S.sync = await getSync();
    S.data = await getOrg();
    S.inbox = null; // the inbox re-fetches itself on next paint
    S.loadedAt = new Date();
    if (!soft) render();
    stampLoaded();
  } finally {
    bar?.classList.remove("spin");
  }
}

/**
 * The same thing, for coming back to the tab.
 *
 * Asked for by a focus event rather than by a person, so it has to earn every visible effect.
 * A full refresh drops the inbox, which sends the next paint to GitHub for four seconds and
 * throws away whatever was on screen — including a half-written issue. Almost every focus
 * finds nothing new, so this one syncs, looks, and only then does any of that.
 */
export async function refreshQuietly() {
  const bar = $("#refreshall");
  bar?.classList.add("spin");
  try {
    S.sync = await getSync();
    const data = await getOrg();
    const changed = shape(data) !== shape(S.data);
    S.data = data;
    S.loadedAt = new Date();
    stampLoaded();
    // Something landed in a checkout: the inbox is stale too, and the screen should say so.
    if (changed || (S.sync?.results ?? []).some((r) => r.pulled)) {
      S.inbox = null;
      render();
    }
  } finally {
    bar?.classList.remove("spin");
  }
}

/** The export minus its timestamp, which is stamped per request and always differs. */
function shape(data) {
  if (!data) return "";
  const { generatedAt, ...rest } = data;
  return JSON.stringify(rest);
}

export function stampLoaded() {
  const s = $("#loaded");
  if (s && S.loadedAt) s.textContent = "data " + ago(S.loadedAt.toISOString());
}

/* A repo that could not be fast-forwarded is the difference between "nothing happened
   today" and "something happened and you cannot see it", so it is said out loud. */
export function syncNotice() {
  const stuck = (S.sync?.results ?? []).filter((r) => r.skipped || r.error || r.behind > 0);
  if (!stuck.length) return null;
  const d = el("div", { className: "notice" });
  const lines = el("div");
  lines.innerHTML = stuck
    .map(
      (r) =>
        "<b>" + esc(r.dir) + "</b> " +
        (r.error
          ? "could not sync: " + esc(r.error)
          : r.skipped === "dirty"
            ? "is " + r.behind + " behind and has uncommitted changes, so it was not pulled. " +
              "Commit or stash them, then pull."
            : r.skipped === "diverged"
              ? "has diverged (" + r.ahead + " ahead, " + r.behind + " behind). " +
                "Push or rebase it by hand: a merge is not this button's to make."
              : r.skipped === "no-remote"
                ? "has no remote"
                : "is " + r.behind + " behind"),
    )
    .join("<br>");
  d.append(lines);

  /* The same conservative pull `roster portal` runs on a refresh, on demand: fetch, and pull
     only what is clean and fast-forward. It is here because the answer to "commit those and
     pull" should not be to reload the page and hope. */
  const status = el("span", { className: "meta" });
  const pull = el("button", { className: "ghbtn", textContent: "Pull now" });
  pull.onclick = async () => {
    pull.disabled = true;
    status.textContent = "pulling…";
    status.className = "meta";
    S.sync = await getSync();
    const pulled = (S.sync?.results ?? []).filter((r) => r.pulled);
    // Anything that landed is on disk now, so the export and the inbox are both behind it.
    if (pulled.length) await refreshAll(false);
    else {
      pull.disabled = false;
      status.textContent = "nothing could be pulled";
      render();
    }
  };
  d.append(el("div", { className: "row", style: "margin-top:10px" }, [pull, status]));
  return d;
}
