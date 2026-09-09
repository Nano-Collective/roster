/* What is still wrong, and one button that hands it all to a coding agent.
 *
 * Derived from `roster doctor` every time it is drawn. Nothing here remembers that you clicked
 * something: setup takes days, not minutes, and a stored step counter would disagree with the
 * world about five minutes after it was written. */

import { getDoctor, getFix } from "../api.js";
import { el, toClipboard } from "../dom.js";

const LEVEL_ORDER = { fail: 0, warn: 1, ok: 2 };

/**
 * @param opts.shell  when Health draws this, the section it lives in: `{actions, say}`. The
 *   setup screen passes nothing and gets the layout it has always had. Its own screen is a
 *   wizard, where a chunky button and a paragraph under it are right; on Health it is one
 *   section of four, and has to look like the other three.
 */
export async function checklist(host, opts = {}) {
  const inSection = Boolean(opts.shell);
  const btnClass = inSection ? "ghbtn" : "btn";
  const noteClass = inSection ? "hnote" : "sub";
  host.replaceChildren(el("p", { className: noteClass, textContent: "Checking…" }));

  let report;
  try {
    report = await getDoctor(opts.offline);
  } catch (err) {
    host.replaceChildren(el("p", { className: "err", textContent: String(err.message || err) }));
    return;
  }

  const findings = (report.findings ?? []).slice().sort(
    (a, b) => (LEVEL_ORDER[a.level] ?? 3) - (LEVEL_ORDER[b.level] ?? 3),
  );
  const bad = findings.filter((f) => f.level !== "ok");

  host.replaceChildren();
  opts.shell?.say(bad.length ? String(bad.length) : "clean");
  host.append(
    el("p", {
      className: noteClass,
      textContent: bad.length
        ? `${bad.filter((f) => f.level === "fail").length} failing, ${bad.filter((f) => f.level === "warn").length} to look at.` +
          (report.online ? "" : " Local checks only.")
        : "Everything doctor checks is clean." + (report.online ? "" : " Local checks only."),
    }),
  );

  for (const f of bad) {
    const row = el("div", { className: "check " + f.level });
    row.append(
      el("span", { className: "checkmark", textContent: f.level === "fail" ? "✗" : "!" }),
      el("div", {}, [
        el("b", { textContent: f.title }),
        el("span", { className: "meta", textContent: f.scope + " · " + f.id }),
        ...(f.fix ? [el("p", { textContent: f.fix })] : []),
      ]),
    );
    host.append(row);
  }

  /* The isitagentready move: the findings as instructions, for the agent you already have
     pointed at this workspace. What only a person can do is deliberately not in that text. */
  const copy = el("button", { className: btnClass + " primary", textContent: "Copy all instructions" });
  const note = el("span", { className: "meta" });
  copy.onclick = async () => {
    copy.disabled = true;
    copy.textContent = "Collecting…";
    try {
      const data = await getFix(opts.offline);
      const mine = (data.items ?? []).filter((i) => i.who === "agent").length;
      const yours = (data.items ?? []).filter((i) => i.who === "human").length;
      await toClipboard(data.text, copy, "Copied");
      note.textContent =
        `${mine} for your agent` + (yours ? `, ${yours} only you can do (listed, not asked for)` : "");
    } catch (err) {
      note.textContent = String(err.message || err);
    } finally {
      copy.disabled = false;
    }
  };

  const again = el("button", { className: btnClass, textContent: "Check again" });
  again.onclick = () => checklist(host, opts);

  const feet = opts.shell?.actions ?? host;
  if (opts.shell) feet.replaceChildren();
  feet.append(copy, again, note);
  if (bad.length) {
    feet.append(
      el("p", {
        className: noteClass,
        style: "flex-basis:100%",
        textContent:
          "Paste it into Cursor, Claude Code or anything else that can edit files here, then " +
          "check again. The ids above should be gone.",
      }),
    );
  }
}
