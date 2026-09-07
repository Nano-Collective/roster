/* The link graph: one node per memory section, fanning out into its facts. */

import { el, esc } from "../dom.js";
import { icon } from "../icons.js";
import { inline } from "../md.js";
import { render } from "../router.js";
import { S, staff } from "../state.js";

/* An edge key joins two node ids, so it needs a character no id can contain — a group id
   is a section name, and spaces and punctuation are all in play. Written as an escape
   rather than the literal character it used to be, which made every tool treat this file
   as binary and quietly refuse to grep it. */
const SEP = "\u0000";

export function viewGraph(m) {
  const s = staff();
  m.append(el("h1", { textContent: s.handle.toUpperCase() + " · graph" }));
  m.append(el("p", { className: "sub", innerHTML:
    "One node per group, sized by what it holds. <b>Click a group to fan its facts outwards</b>; " +
    "click it again to fold them back. <b>Click a fact</b> to read it." }));

  const wrap = el("div", { className: "graphwrap" });
  wrap.append(el("canvas", { id: "graph" }));
  m.append(wrap);
  requestAnimationFrame(() => drawGraph(wrap.querySelector("#graph"), wrap, s));
}

/* A two-level graph.
 *
 * Group nodes are placed deterministically on a ring and do not drift: a top level that
 * rearranges itself every time you open something is impossible to build a mental map of.
 * Opening a group fans its members OUTWARD, away from the centre, so they never land in
 * among the other groups. Only members open the sheet; a group click just opens or folds. */
function drawGraph(canvas, wrap, s) {
  const factBySlug = new Map(s.facts.map((f) => [f.slug, f]));
  const kindOf = (id) => factBySlug.has(id) ? "fact"
    : id.startsWith("#") ? "issue" : s.notes.includes(id) ? "note" : "file";
  const groupOf = (id) => {
    const f = factBySlug.get(id);
    if (f) return f.section || "Ungrouped";
    const k = kindOf(id);
    return k === "note" ? "Notes" : k === "issue" ? "Issues" : "Files";
  };

  const ids = new Set(s.facts.map((f) => f.slug));
  for (const l of s.links) { ids.add(l.from); ids.add(l.to); }

  const members = new Map();
  for (const id of ids) {
    const g = groupOf(id);
    if (!members.has(g)) members.set(g, []);
    members.get(g).push(id);
  }
  const groups = [...members.keys()].sort((a, b) => members.get(b).length - members.get(a).length);

  const PALETTE = ["#7cc7a4","#7aa2f7","#c99bd6","#d8a657","#6fc3c9","#e07b7b","#b3c46b","#e0a1c0","#9d9ff5","#8fb0d9"];
  const colour = new Map(groups.map((g, i) => [g, PALETTE[i % PALETTE.length]]));

  // The ring grows with the number of groups so they never crowd, and each group keeps its
  // angle for the life of the view. That angle is also the direction its members fan out in.
  const RING = Math.max(340, groups.length * 84);
  // Each group owns one slice of the circle. A fan wider than its own slice sweeps across
  // the neighbours, which is exactly what it was doing.
  const SECTOR = (Math.PI * 2) / groups.length;
  const groupNodes = new Map(groups.map((g, i) => {
    const angle = (i / groups.length) * Math.PI * 2 - Math.PI / 2;
    return [g, { id: g, group: g, isGroup: true, angle, count: members.get(g).length,
                 x: Math.cos(angle) * RING, y: Math.sin(angle) * RING, vx: 0, vy: 0, pinned: true }];
  }));

  const radius = (n) => n.isGroup ? 16 + Math.sqrt(n.count) * 3.6 : 5.5;

  /* Fan a group's members outward along its own angle, in shells, so a big group becomes a
     wedge pointing away from the middle rather than a ball sitting on its neighbours. */
  function fanAnchor(g, i) {
    const gn = groupNodes.get(g);
    const n = members.get(g).length;
    const perShell = Math.max(4, Math.ceil(Math.sqrt(n) * 1.15));
    const shell = Math.floor(i / perShell);
    const inShell = i % perShell;
    const count = Math.min(perShell, n - shell * perShell);
    // Never wider than the group's own slice, so one fan can never reach into another.
    const spread = SECTOR * 0.66;
    const t = count === 1 ? 0 : (inShell / (count - 1) - 0.5) * spread;
    const a = gn.angle + t;
    // Well clear of the ring, and each shell steps a long way further out.
    const r = RING + radius(gn) + 210 + shell * 96;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  }

  const memberNodes = new Map();
  for (const g of groups) {
    members.get(g).forEach((id, i) => {
      const gn = groupNodes.get(g);
      memberNodes.set(id, { id, group: g, isGroup: false, kind: kindOf(id),
        x: gn.x, y: gn.y, vx: 0, vy: 0, home: fanAnchor(g, i), pinned: false });
    });
  }

  const expanded = new Set();
  const hidden = new Set();
  const resolve = (id) => (expanded.has(groupOf(id)) ? memberNodes.get(id) : groupNodes.get(groupOf(id)));
  // Group nodes stay on screen when open, as a hollow marker, so there is always something
  // to click to fold them back.
  const shown = () => groups.filter((g) => !hidden.has(g))
    .flatMap((g) => (expanded.has(g) ? [groupNodes.get(g), ...members.get(g).map((id) => memberNodes.get(id))] : [groupNodes.get(g)]));

  function activeEdges() {
    const acc = new Map();
    for (const l of s.links) {
      const a = resolve(l.from), b = resolve(l.to);
      if (!a || !b || a === b) continue;
      if (hidden.has(a.group) || hidden.has(b.group)) continue;
      const key = a.id < b.id ? a.id + SEP + b.id : b.id + SEP + a.id;
      const e = acc.get(key) ?? { a, b, weight: 0, authored: 0 };
      e.weight++; if (!l.inferred) e.authored++;
      acc.set(key, e);
    }
    return [...acc.values()];
  }

  let edges = [];
  let alpha = 1;
  const degree = new Map();
  function recompute() {
    edges = activeEdges();
    degree.clear();
    for (const e of edges) {
      degree.set(e.a, (degree.get(e.a) ?? 0) + e.weight);
      degree.set(e.b, (degree.get(e.b) ?? 0) + e.weight);
    }
    alpha = 1;
  }
  const neighbours = (n) => edges.filter((e) => e.a === n || e.b === n).map((e) => (e.a === n ? e.b : e.a));

  function toggle(g) {
    if (expanded.has(g)) {
      expanded.delete(g);
      // Fold members back to their group so reopening reads as unfolding, not teleporting.
      for (const id of members.get(g)) {
        const mn = memberNodes.get(id), gn = groupNodes.get(g);
        mn.x = gn.x; mn.y = gn.y; mn.vx = mn.vy = 0; mn.pinned = false;
      }
      if (selected && groupOf(selected.id) === g) { selected = null; paintSheet(); }
    } else {
      expanded.add(g);
    }
    recompute();
  }

  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  let tx = 0, ty = 0, scale = 0.8;
  let selected = null, hover = null, drag = null, panning = false, lx = 0, ly = 0, moved = 0;
  const ctx = canvas.getContext("2d");

  const search = el("input", { type: "search", placeholder: "Find a fact..." });
  search.oninput = () => {
    const q = search.value.trim().toLowerCase();
    if (!q) return;
    const id = [...ids].find((x) => x.toLowerCase().includes(q));
    if (!id) return;
    if (!expanded.has(groupOf(id))) toggle(groupOf(id));
    selected = memberNodes.get(id);
    centreOn(selected);
    paintSheet();
  };
  wrap.append(el("div", { className: "gtools" }, [
    search,
    el("button", { textContent: "open all", onclick: () => { for (const g of groups) if (!expanded.has(g)) toggle(g); } }),
    el("button", { textContent: "close all", onclick: () => { for (const g of [...expanded]) toggle(g); } }),
    el("button", { textContent: "fit", onclick: fit }),
  ]));

  const legend = el("div", { className: "legend" });
  for (const g of groups) {
    const row = el("div", { className: "on" });
    row.innerHTML = '<i style="background:' + colour.get(g) + '"></i>' +
      esc(g.length > 26 ? g.slice(0, 25) + "..." : g) +
      ' <b style="color:var(--ink-faint);font-weight:400">' + members.get(g).length + "</b>";
    row.onclick = () => {
      hidden.has(g) ? hidden.delete(g) : hidden.add(g);
      row.className = hidden.has(g) ? "" : "on";
      recompute();
    };
    legend.append(row);
  }
  wrap.append(legend);

  /* The sheet is for facts only. A group click expands; it never opens a panel. */
  let sheet = null;
  function paintSheet() {
    sheet?.remove();
    sheet = null;
    if (!selected || selected.isGroup) return;
    const n = selected;
    const f = factBySlug.get(n.id);
    sheet = el("aside", { className: "sheet" });
    const shut = el("button", { className: "x", title: "Close",
      onclick: () => { selected = null; paintSheet(); } });
    shut.append(icon("close"));
    sheet.append(shut);
    sheet.insertAdjacentHTML("beforeend",
      '<div class="skind" style="color:' + colour.get(n.group) + '">' + esc(n.group) + "</div>" +
      "<h4>" + esc(n.id) + "</h4>" +
      (f ? "<p>" + inline(f.statement) + "</p>" +
           (f.consequence ? '<p class="so"><b>So:</b> ' + inline(f.consequence) + "</p>" : "")
         : '<p class="meta">' + esc(n.kind) + " referenced by this brain</p>"));

    const links = neighbours(n);
    if (links.length) {
      sheet.append(el("div", { className: "sect", style: "padding:16px 0 4px", textContent: links.length + " linked" }));
      for (const other of links.slice(0, 20)) {
        sheet.append(el("button", { className: "lk", textContent: other.id, onclick: () => {
          if (other.isGroup) { if (!expanded.has(other.id)) toggle(other.id); return; }
          selected = other; centreOn(other); paintSheet();
        } }));
      }
    }
    const row = el("div", { className: "row", style: "margin-top:18px" });
    if (f) row.append(el("button", { className: "lk", style: "width:auto", textContent: "open in memory",
      onclick: () => { S.openFile = "fact:" + n.id; S.fileQuery = ""; S.view = "brain"; render(); } }));
    if (n.kind === "note") row.append(el("button", { className: "lk", style: "width:auto", textContent: "open note",
      onclick: () => { S.openFile = "memory/notes/" + n.id; S.fileQuery = ""; S.view = "brain"; render(); } }));
    sheet.append(row);
    wrap.append(sheet);
  }

  function size() {
    const r = canvas.getBoundingClientRect();
    const dpr = devicePixelRatio || 1;
    canvas.width = r.width * dpr; canvas.height = r.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return r;
  }
  let rect = size();
  addEventListener("resize", () => { rect = size(); });

  function centreOn(n) { tx = -n.x * scale; ty = -n.y * scale; }
  function fit() {
    const vis = shown();
    if (!vis.length) return;
    const xs = vis.map((n) => n.x), ys = vis.map((n) => n.y);
    const minx = Math.min(...xs), miny = Math.min(...ys);
    const w = Math.max(...xs) - minx || 1, h = Math.max(...ys) - miny || 1;
    scale = Math.min(1.6, Math.max(0.12, Math.min(rect.width / (w + 260), rect.height / (h + 260))));
    tx = -(minx + w / 2) * scale;
    ty = -(miny + h / 2) * scale;
  }

  function step() {
    if (alpha < 0.004) return;
    alpha *= 0.988;
    const vis = shown();
    const loose = vis.filter((n) => !n.isGroup);

    // Only members are simulated. Groups hold the frame.
    for (let i = 0; i < loose.length; i++) {
      const a = loose[i];
      for (let j = i + 1; j < loose.length; j++) {
        const b = loose[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy || 0.01;
        if (d2 > 40000) continue;
        const d = Math.sqrt(d2);
        const overlap = radius(a) + radius(b) + 15 - d;
        const f = 900 / d2 + (overlap > 0 ? overlap * 0.42 : 0);
        const ux = dx / d, uy = dy / d;
        a.vx -= ux * f; a.vy -= uy * f; b.vx += ux * f; b.vy += uy * f;
      }
      // Keep clear of every group node, so a fan never drifts back over the ring.
      for (const g of groups) {
        const gn = groupNodes.get(g);
        const dx = a.x - gn.x, dy = a.y - gn.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const gap = radius(gn) + 26;
        if (d < gap) { const f = (gap - d) * 0.5; a.vx += (dx / d) * f; a.vy += (dy / d) * f; }
      }
    }
    for (const e of edges) {
      // Only members of the same group attract. A cross-group spring drags a fact out of its
      // own fan and across the picture, which is most of what made this unreadable.
      if (e.a.isGroup || e.b.isGroup || e.a.group !== e.b.group) continue;
      const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y;
      const d = Math.hypot(dx, dy) || 0.01;
      const f = (d - 120) * 0.004;
      const ux = dx / d, uy = dy / d;
      e.a.vx += ux * f; e.a.vy += uy * f; e.b.vx -= ux * f; e.b.vy -= uy * f;
    }
    for (const n of loose) {
      // The fan position is the strong term: it is what keeps a group's facts together and
      // out on their own side of the picture.
      n.vx += (n.home.x - n.x) * 0.09;
      n.vy += (n.home.y - n.y) * 0.09;
      if (n.pinned || n === drag) { n.vx = n.vy = 0; continue; }
      n.x += (n.vx *= 0.72); n.y += (n.vy *= 0.72);
    }
  }

  function draw() {
    if (!document.body.contains(canvas)) return;
    step();
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.save();
    ctx.translate(rect.width / 2 + tx, rect.height / 2 + ty);
    ctx.scale(scale, scale);

    const near = selected ? new Set([selected, ...neighbours(selected)]) : null;
    const labelBoxes = [];

    // A faint spoke from an open group to its own fan, so the ownership is obvious.
    for (const g of groups) {
      if (!expanded.has(g) || hidden.has(g)) continue;
      const gn = groupNodes.get(g);
      ctx.strokeStyle = colour.get(g); ctx.globalAlpha = 0.14;
      ctx.lineWidth = 1 / scale;
      for (const id of members.get(g)) {
        const mn = memberNodes.get(id);
        ctx.beginPath(); ctx.moveTo(gn.x, gn.y); ctx.lineTo(mn.x, mn.y); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    for (const e of edges) {
      const lit = !near || (near.has(e.a) && near.has(e.b));
      ctx.strokeStyle = near && lit ? css("--accent") : css("--line");
      ctx.globalAlpha = near ? (lit ? 0.95 : 0.07) : 0.62;
      ctx.lineWidth = Math.min(6, 0.8 + Math.log2(e.weight + 1) * 1.25) / Math.max(1, scale * 0.8);
      ctx.beginPath(); ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(e.b.x, e.b.y); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const painted = shown().sort((a, b) => (b.isGroup ? b.count : 0) - (a.isGroup ? a.count : 0));
    for (const n of painted) {
      const r = radius(n);
      const dim = near && !near.has(n);
      ctx.globalAlpha = dim ? 0.13 : 1;

      if (n.isGroup) {
        const open = expanded.has(n.id);
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 7);
        if (open) {
          // Hollow while open: the group is still here, and still the thing you click to fold.
          ctx.fillStyle = css("--panel"); ctx.fill();
          ctx.strokeStyle = colour.get(n.group); ctx.lineWidth = 2.4 / scale; ctx.stroke();
          ctx.fillStyle = colour.get(n.group);
        } else {
          ctx.fillStyle = colour.get(n.group); ctx.fill();
          ctx.fillStyle = css("--bg");
        }
        ctx.font = "600 " + Math.max(9, r * 0.6) + "px ui-monospace,monospace";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(String(n.count), n.x, n.y + 0.5);
        ctx.textBaseline = "alphabetic";
        const text = n.id.length > 24 ? n.id.slice(0, 23) + "..." : n.id;
        const fs = Math.max(10, 12 / scale);
        ctx.font = "600 " + fs + "px -apple-system,system-ui,sans-serif";
        const w = ctx.measureText(text).width;
        const bx = n.x - w / 2, by = n.y + r + 6, bh = fs * 1.25;
        const clashes = labelBoxes.some((o) =>
          bx < o.x + o.w + 8 && bx + w + 8 > o.x && by < o.y + o.h + 4 && by + bh + 4 > o.y);
        if (!clashes || n === hover) {
          labelBoxes.push({ x: bx, y: by, w, h: bh });
          ctx.textAlign = "center";
          ctx.fillStyle = css(n === hover ? "--ink" : "--ink-dim");
          ctx.fillText(text, n.x, by + fs);
        }
        ctx.textAlign = "left";
      } else {
        ctx.fillStyle = colour.get(n.group) ?? css("--ink-faint");
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 7); ctx.fill();
        if (n === selected || n === hover || scale > 1.05) {
          ctx.fillStyle = css(n === selected || n === hover ? "--ink" : "--ink-dim");
          ctx.font = Math.max(9, 10.5 / scale) + "px ui-monospace,monospace";
          ctx.fillText(n.id.length > 26 ? n.id.slice(0, 25) + "..." : n.id, n.x + r + 4, n.y + 3.5);
        }
      }
      if (n === selected || n === hover) {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = css("--ink"); ctx.lineWidth = 1.5 / scale;
        ctx.beginPath(); ctx.arc(n.x, n.y, r + 4, 0, 7); ctx.stroke();
      }
    }
    ctx.restore();
    requestAnimationFrame(draw);
  }
  recompute();
  fit();
  draw();

  const toWorld = (ev) => {
    const r = canvas.getBoundingClientRect();
    return { x: (ev.clientX - r.left - r.width / 2 - tx) / scale,
             y: (ev.clientY - r.top - r.height / 2 - ty) / scale };
  };
  const at = (ev) => {
    const p = toWorld(ev);
    // Members first: an open group's node must never swallow a click meant for a fact.
    const vis = shown();
    return vis.filter((n) => !n.isGroup).find((n) => Math.hypot(n.x - p.x, n.y - p.y) < radius(n) + 6)
        ?? vis.filter((n) => n.isGroup).find((n) => Math.hypot(n.x - p.x, n.y - p.y) < radius(n) + 5);
  };

  canvas.onpointerdown = (ev) => {
    canvas.setPointerCapture?.(ev.pointerId);
    moved = 0; lx = ev.clientX; ly = ev.clientY;
    const n = at(ev);
    if (n) { drag = n; if (!n.isGroup) n.pinned = true; alpha = Math.max(alpha, 0.3); }
    else { panning = true; canvas.classList.add("grabbing"); }
  };
  canvas.onpointermove = (ev) => {
    moved += Math.abs(ev.clientX - lx) + Math.abs(ev.clientY - ly);
    if (drag) { const p = toWorld(ev); drag.x = p.x; drag.y = p.y; drag.vx = drag.vy = 0; }
    else if (panning) { tx += ev.clientX - lx; ty += ev.clientY - ly; }
    else {
      const h = at(ev);
      if (h !== hover) { hover = h; canvas.classList.toggle("onnode", !!h); }
    }
    lx = ev.clientX; ly = ev.clientY;
  };
  canvas.onpointerup = (ev) => {
    canvas.releasePointerCapture?.(ev.pointerId);
    if (moved < 4) {
      const n = at(ev);
      if (!n) { selected = null; paintSheet(); }
      else if (n.isGroup) toggle(n.id);        // groups only ever open or fold
      else { selected = n === selected ? null : n; paintSheet(); }
    }
    drag = null; panning = false;
    canvas.classList.remove("grabbing");
  };
  canvas.ondblclick = (ev) => { const n = at(ev); if (n && !n.isGroup) { n.pinned = false; alpha = Math.max(alpha, 0.4); } };
  canvas.onwheel = (ev) => {
    ev.preventDefault();
    scale = Math.min(3.5, Math.max(0.1, scale * (ev.deltaY < 0 ? 1.12 : 0.89)));
  };
}
