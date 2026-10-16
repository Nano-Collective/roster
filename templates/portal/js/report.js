/* A staff member's report, the body of their status issue, taken apart for Home's card. */

/**
 * A report, taken apart: the status line, and the Done, Working on, Needs you and Next
 * sections the prompts ask for. A report written before that shape has none of them, and is
 * shown as its opening lines instead.
 */
export function parseReport(body) {
  const lines = String(body ?? "").replace(/\r/g, "").split("\n");
  const out = { status: "", headline: "", sections: {} };
  let at = null;
  const intro = [];
  for (const raw of lines) {
    const line = raw.trim();
    const h = /^#{2,3}\s+(.+?)\s*$/.exec(line);
    if (h) {
      at = sectionKey(h[1]);
      if (at) out.sections[at] ??= [];
      continue;
    }
    if (!at) {
      if (/^_?updated\b/i.test(line)) continue;
      const st = /^\**status:\s*(on track|needs you|stuck|blocked)\b[.!]?\**\s*[.:\u2013\u2014-]?\s*(.*)$/i.exec(line);
      if (st && !out.status) {
        out.status = st[1].trim().toLowerCase();
        if (st[2]) out.headline = st[2].replace(/^\**\s*/, "").trim();
        continue;
      }
      if (line) intro.push(line);
      continue;
    }
    const item = /^[-*]\s+(.*)$/.exec(line) ?? /^\d+[.)]\s+(.*)$/.exec(line);
    if (item) out.sections[at].push(item[1]);
    else if (line && out.sections[at].length) out.sections[at][out.sections[at].length - 1] += " " + line;
    else if (line) out.sections[at].push(line);
  }
  if (!out.headline && intro.length) out.headline = intro[0];
  for (const k of Object.keys(out.sections)) {
    out.sections[k] = out.sections[k].filter((x) => !/^nothing\.?$/i.test(x.trim()));
  }
  return out;
}

function sectionKey(title) {
  const t = title.toLowerCase();
  if (/^(done|shipped|finished|completed)/.test(t)) return "done";
  if (/^(working on|priorities|in progress)/.test(t)) return "working";
  if (/^(needs you|on you|waiting on)/.test(t)) return "needs";
  if (/^next/.test(t)) return "next";
  return null;
}
