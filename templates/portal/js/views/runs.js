/* Every staff member's recent runs, and what the last 30 days cost.
 *
 * The one screen that is only ever on GitHub: runs are not in any repo, so offline it says so
 * rather than drawing an empty table that reads as "nothing ran". */

import { getRuns } from "../api.js";
import { ago, el, esc, skeleton } from "../dom.js";
import { render } from "../router.js";
import { S } from "../state.js";

/** How many runs a staff member's table shows. The spend covers all of the last 30 days. */
const SHOWN = 15;

export function viewRuns(m) {
  m.append(el("h1", { textContent: "Runs" }));
  m.append(
    el("p", {
      className: "sub",
      textContent:
        "What each staff member ran in the last 30 days, how it ended, and what it cost where " +
        "the agent said. Read from GitHub through your own gh.",
    }),
  );

  if (!S.runs) {
    const wait = el("div", { className: "runs" }, skeleton("row", 4));
    m.append(wait);
    load(false);
    return;
  }
  paint(m, S.runs);
  /* Kept for the session, it could be days old: a tab opened during a rate limit went on
     showing a two-week-old list. Anything older than a few minutes is asked for again. */
  // Only a read with a time on it can be old, and only one re-read is asked for at a time.
  const at = S.runs.fetchedAt ? new Date(S.runs.fetchedAt).getTime() : 0;
  if (at && Date.now() - at > 5 * 60_000 && !asking) load(true);
}

let asking = false;

async function load(force) {
  if (asking) return;
  asking = true;
  try {
    S.runs = await getRuns(force);
  } catch (e) {
    S.runs = { online: false, error: e.message, staff: [] };
  } finally {
    asking = false;
  }
  if (S.view === "runs") render();
}

function paint(m, data) {
  const again = el("button", { className: "ghbtn", textContent: "Ask GitHub again" });
  again.onclick = () => {
    S.runs = null;
    load(true);
    render();
  };

  if (!data.online) {
    const box = el("div", { className: "notice" });
    box.innerHTML =
      "<b>Runs live on GitHub, and it could not be reached.</b><br>" +
      esc(data.error ?? "gh is unavailable") +
      "<br>Everything else in the portal reads from disk and still works.";
    m.append(box, el("div", { className: "row hacts" }, [again]));
    return;
  }

  const g = el("div", { className: "grid runsum" });
  g.append(tile("Last 30 days", money(data.spend), priced(data.spend), over(data.spend, data.budget)));
  if (data.budget) {
    g.append(tile("Budget", "$" + data.budget, "org.yaml · 30 days, all staff", over(data.spend, data.budget)));
  }
  g.append(tile("Runs", String(data.spend?.runs ?? 0), "skipped mentions are not counted"));
  m.append(g);

  for (const s of data.staff ?? []) m.append(...staffSection(s));

  m.append(
    el("div", { className: "row hacts" }, [
      again,
      el("span", { className: "meta", textContent: data.fetchedAt ? "read " + ago(data.fetchedAt) : "" }),
    ]),
  );
}

function staffSection(s) {
  const head = el("div", { className: "hsect" });
  head.append(el("span", { textContent: s.name }));
  const total = el("i", {
    textContent: money(s.spend) + (s.budget ? " of $" + s.budget : "") + " · 30 days",
  });
  if (over(s.spend, s.budget)) total.className = "warn";
  head.append(total);

  const body = el("div", { className: "hbody runs" });
  for (const e of s.errors ?? []) body.append(el("p", { className: "hnote err", textContent: e }));
  if (!(s.runs ?? []).length) {
    body.append(el("p", { className: "hnote", textContent: "No runs in the last 30 days." }));
    return [head, body];
  }

  const table = el("table", { className: "runtable" });
  table.innerHTML =
    "<thead><tr><th>When</th><th>Kind</th><th>Outcome</th><th>Took</th><th>Turns</th>" +
    "<th>Cost</th><th></th></tr></thead>";
  const rows = el("tbody");
  for (const r of s.runs.slice(0, SHOWN)) rows.append(row(r));
  table.append(rows);
  body.append(table);
  if (s.runs.length > SHOWN) {
    body.append(
      el("p", {
        className: "hnote",
        textContent: s.runs.length - SHOWN + " older runs count towards the total and are not listed.",
      }),
    );
  }
  return [head, body];
}

function row(r) {
  const tr = el("tr");
  const out = outcome(r);
  const rec = r.record ?? {};
  const mins = rec.duration_s != null ? rec.duration_s / 60 : r.minutes;
  tr.innerHTML =
    '<td title="' + esc(r.createdAt) + '">' + esc(ago(r.createdAt)) + "</td>" +
    "<td>" + esc(r.kind) + "</td>" +
    '<td><span class="chip ' + out.tone + '">' + esc(out.word) + "</span></td>" +
    "<td>" + (mins != null ? Math.round(mins) + "m" : "–") + "</td>" +
    "<td>" + (rec.turns ?? "–") + "</td>" +
    "<td>" + (typeof rec.cost_usd === "number" ? "$" + rec.cost_usd.toFixed(2) : "–") + "</td>" +
    '<td><a class="ref" href="' + esc(r.url) + '" target="_blank" rel="noopener">log</a></td>';
  return tr;
}

/** The record's word when there is one, which knows a setup failure from an agent failure. */
function outcome(r) {
  if (r.status !== "completed") return { word: r.status.replace("_", " "), tone: "" };
  const word = r.record?.outcome ?? r.conclusion ?? "unknown";
  const tone = word === "success" ? "ok" : word === "cancelled" ? "warm" : "hot";
  return { word, tone };
}

function money(spend) {
  return "$" + (spend?.usd ?? 0).toFixed(2);
}

/** A total is only as good as the runs it could price, so it says how many that was. */
function priced(spend) {
  if (!spend?.runs) return "no runs";
  if (spend.known === spend.runs) return "every run priced";
  return "cost known for " + spend.known + " of " + spend.runs + " runs";
}

function over(spend, budget) {
  return !!budget && (spend?.usd ?? 0) > budget;
}

function tile(k, v, sub, bad) {
  const d = el("div", { className: "kv" + (bad ? " bad" : "") });
  d.innerHTML =
    '<div class="k">' + esc(k) + '</div><div class="v">' + esc(v) +
    (sub ? "<small>" + esc(sub) + "</small>" : "") + "</div>";
  return d;
}
