/* Enough markdown for an issue thread and for a file in a brain, escaped first. Not a
 * general parser: tables, headings, nested lists, code, quotes, rules, images and links,
 * which is what these actually contain. Tables matter most — the status issues are mostly
 * tables, and without them the body is a wall of pipes.
 */

import { esc } from "./dom.js";

/* Who this org is, so `@cto` can be told from `@some-stranger`. Registered once at boot
   rather than threaded through every call site, because every call site would pass the
   same value. */
let PEOPLE = new Map();

/** @param people Map of lowercased handle → { href, known } */
export function setPeople(people) {
  PEOPLE = people;
}

/* Renders the small subset of markdown that appears in a fact line. Deliberately not a
   markdown parser: escaping first, then a handful of inline forms. */
export function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code style="font:12px var(--mono);color:var(--accent)">$1</code>')
    .replace(/\[\[([a-z0-9-]+)\]\]/g, '<span class="slug" data-goto="$1">[[$1]]</span>')
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>',
    );
}

const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

/**
 * opts.repo   resolves a bare #123 to that repository
 * opts.file   { dir, staffDir } resolves relative images and links inside a brain
 * opts.docs   links between doc pages stay inside the portal
 */
export function mdlite(src, opts = {}) {
  const lines = esc(src).replace(/\r/g, "").split("\n");
  const out = [];
  let i = 0;

  const inlineFmt = (s) =>
    chips(
      s
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(
          /!\[([^\]]*)\]\(([^)\s]+)\)/g,
          (_m, alt, src2) =>
            '<img src="' + mdAsset(src2, opts) + '" alt="' + alt + '" loading="lazy">',
        )
        // Non-greedy and allowing an inner asterisk, because "**bold with *this* inside**" is
        // ordinary in these files and the old pattern silently left the stars on the page.
        // Requiring a non-space first character keeps a literal "/** wildcard" from opening one.
        .replace(/\*\*(\S[\s\S]*?)\*\*/g, "<b>$1</b>")
        .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<i>$2</i>")
        .replace(/~~([^~]+)~~/g, "<s>$1</s>")
        .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text, href) => mdLink(href, text, opts))
        .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (_m, pre, url) => pre + mdLink(url, url, opts)),
      opts,
    );

  const cells = (row) => {
    let s = row.trim();
    if (s.startsWith("|")) s = s.slice(1);
    if (s.endsWith("|")) s = s.slice(0, -1);
    return s.split("|").map((c) => inlineFmt(c.trim()));
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith("```")) {
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) buf.push(lines[i++]);
      i++;
      out.push("<pre><code>" + buf.join("\n") + "</code></pre>");
      continue;
    }

    // A table is a pipe row followed by a --- separator row.
    if (
      line.trim().startsWith("|") &&
      (lines[i + 1] ?? "").replace(/[^|:\-\s]/g, "") === (lines[i + 1] ?? "").trim() &&
      /^\|?[\s:|-]+\|[\s:|-]*$/.test((lines[i + 1] ?? "").trim())
    ) {
      const head = cells(line);
      i += 2;
      const body = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) body.push(cells(lines[i++]));
      const th = head.map((h) => "<th>" + h + "</th>").join("");
      const tr = body.map((r) => "<tr>" + r.map((c) => "<td>" + c + "</td>").join("") + "</tr>").join("");
      // A leading empty header cell is how these issues start a two-column "thing | ask"
      // table; keeping the row would just print a blank strip.
      const showHead = head.some((h) => h.trim());
      out.push(
        '<div class="ctable"><table>' +
          (showHead ? "<thead><tr>" + th + "</tr></thead>" : "") +
          "<tbody>" + tr + "</tbody></table></div>",
      );
      continue;
    }

    if (!line.trim()) { i++; continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { out.push("<h" + h[1].length + ">" + inlineFmt(h[2]) + "</h" + h[1].length + ">"); i++; continue; }

    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) { out.push("<hr>"); i++; continue; }

    if (line.trim().startsWith("&gt;")) {
      const buf = [];
      while (i < lines.length && lines[i].trim().startsWith("&gt;")) {
        buf.push(lines[i++].trim().replace(/^&gt;\s?/, ""));
      }
      out.push("<blockquote>" + inlineFmt(buf.join(" ")) + "</blockquote>");
      continue;
    }

    // Lists are gathered whole and nested by indent. Flat divs with a left margin looked
    // right until a sub-point wrapped, and then the wrap did not line up with the bullet.
    if (LIST_RE.test(line)) {
      const items = [];
      while (i < lines.length && LIST_RE.test(lines[i])) {
        const m = LIST_RE.exec(lines[i++]);
        items.push({
          depth: Math.floor(m[1].replace(/\t/g, "  ").length / 2),
          ordered: /\d/.test(m[2]),
          text: m[3],
        });
        // A continuation line indented under the bullet is part of that bullet.
        while (i < lines.length && lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && !LIST_RE.test(lines[i])) {
          items[items.length - 1].text += " " + lines[i++].trim();
        }
      }
      out.push(mdList(items, 0, items[0].depth, inlineFmt).html);
      continue;
    }

    /* Consecutive plain lines are one paragraph; markdown hard-wraps and we should not.
       The join happens before the formatting, not after: these files wrap at 95 columns, so
       a **bold run** or a [link](…) routinely straddles two source lines, and formatting
       line by line left the asterisks on the page. */
    const para = [];
    while (
      i < lines.length && lines[i].trim() &&
      !LIST_RE.test(lines[i]) && !/^\s*(#{1,6}\s|\||&gt;|```)/.test(lines[i])
    ) {
      para.push(lines[i++].trim());
    }
    out.push("<p>" + inlineFmt(para.length ? para.join(" ") : lines[i++].trim()) + "</p>");
  }
  return out.join("\n");
}

/** One level of a list, recursing wherever the indent goes deeper. */
function mdList(items, from, depth, fmt) {
  let html = "";
  let tasks = 0;
  let i = from;
  const ordered = items[from].ordered;
  while (i < items.length && items[i].depth >= depth) {
    if (items[i].depth > depth) {
      const sub = mdList(items, i, items[i].depth, fmt);
      // Nest inside the bullet we just closed, so the sub-list belongs to it.
      html = html.replace(/<\/li>$/, sub.html + "</li>");
      i = sub.next;
      continue;
    }
    const task = /^\[( |x|X)\]\s+(.*)$/.exec(items[i].text);
    if (task) {
      tasks++;
      html += '<li><span class="box">' + (task[1] === " " ? "☐" : "☑") + "</span>" + fmt(task[2]) + "</li>";
    } else {
      html += "<li>" + fmt(items[i].text) + "</li>";
    }
    i++;
  }
  const tag = ordered ? "ol" : "ul";
  return { html: "<" + tag + (tasks ? ' class="tasks"' : "") + ">" + html + "</" + tag + ">", next: i };
}

const GH_REF = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(issues|pull)\/(\d+)/;

/** A link, or a chip if it points at an issue or a PR and the text adds nothing. */
function mdLink(href, text, opts) {
  const gh = GH_REF.exec(href);
  if (gh && (text === href || text === gh[1] + "/" + gh[2] + "#" + gh[4])) {
    const repo = gh[1] + "/" + gh[2];
    const label = (repo === opts.repo ? "" : repo) + "#" + gh[4];
    return '<a class="ref' + (gh[3] === "pull" ? " pr" : "") + '" href="' + href +
      '" target="_blank" rel="noopener" title="' + repo + " #" + gh[4] + '">' + label + "</a>";
  }
  if (/^https?:\/\//.test(href)) {
    return '<a href="' + href + '" target="_blank" rel="noopener">' + text + "</a>";
  }
  if (opts.docs) {
    // A link between doc pages stays inside the portal.
    if (/^[\w.-]*\.md(#.*)?$/.test(href) || href.startsWith("#")) {
      return '<a href="#" data-doc="' + href + '">' + text + "</a>";
    }
    return text;
  }
  if (href.startsWith("#")) return text;
  // A relative link inside a brain opens the file here rather than going nowhere.
  const path = mdPath(href, opts);
  if (!path) return text;
  return '<a href="#" data-file="' + path + '">' + text + "</a>";
}

/** Resolve a relative path against the file being read, so ../assets/x.png works. */
function mdPath(href, opts) {
  if (!opts.file || /^(https?:|data:|mailto:)/.test(href)) return null;
  const parts = (opts.file.dir + href.split("#")[0].split("?")[0]).split("/");
  const stack = [];
  for (const p of parts) {
    if (!p || p === ".") continue;
    if (p === "..") stack.pop();
    else stack.push(p);
  }
  return stack.join("/");
}

function mdAsset(src, opts) {
  const path = /^(https?:|data:)/.test(src) ? null : mdPath(src, opts);
  return path ? "/api/file?path=" + encodeURIComponent(opts.file.staffDir + "/" + path) : src;
}

const REF_RE = /(^|[\s(>])([\w.-]+\/[\w.-]+)?#(\d+)\b/g;
// GitHub's own username shape, plus the short aliases the agents answer to.
const AT_RE = /(^|[\s(>])@([a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38})\b/gi;

/* #123, owner/repo#123 and @handle become chips.
   Split on tags and skip anything already inside an anchor, because a markdown link whose
   text is "#113" would otherwise end up as an anchor nested in an anchor. */
export function chips(html, opts = {}) {
  const parts = html.split(/(<[^>]*>)/);
  let inA = 0;
  return parts
    .map((p) => {
      if (p.startsWith("<")) {
        if (/^<a\b/i.test(p)) inA++;
        else if (/^<\/a>/i.test(p)) inA = Math.max(0, inA - 1);
        return p;
      }
      if (inA) return p;
      return p
        .replace(REF_RE, (m, pre, repo, n) => {
          const target = repo || opts.repo;
          if (!target) return m;
          // /issues/N redirects to /pull/N when it is a PR, so one form is always right.
          return pre + '<a class="ref" href="https://github.com/' + target + "/issues/" + n +
            '" target="_blank" rel="noopener" title="' + target + " #" + n + '">' +
            (repo ? repo : "") + "#" + n + "</a>";
        })
        .replace(AT_RE, (m, pre, name) => {
          const who = PEOPLE.get(name.toLowerCase());
          if (!who) {
            return pre + '<a class="at" href="https://github.com/' + name +
              '" target="_blank" rel="noopener">@' + name + "</a>";
          }
          // A mention of someone on this roster goes to them here, not to GitHub.
          return pre + '<a class="at you" href="' + who.href + '" title="' + esc(who.title) +
            '">@' + name + "</a>";
        });
    })
    .join("");
}
