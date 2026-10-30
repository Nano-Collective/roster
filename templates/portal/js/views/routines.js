/* The Routines screen: when each staff member wakes, and what they do then.
 *
 * Every staff member has a daily round. A routine is one more wake-up with its own job: a time,
 * a name, and what to do in the person's own words. Saving writes the staff member's
 * staff.yaml, routines/<id>.md and the daily caller in one commit, as you.
 */

import { post } from "../api.js";
import { sheet } from "../dialog.js";
import { el, grow } from "../dom.js";
import { icon } from "../icons.js";
import { render } from "../router.js";

/* The last answer, so a repaint after Save does not flash an empty screen. */
let last = null;

export function viewRoutines(m) {
  const add = el("button", { className: "ghbtn primary", textContent: "New routine" });
  m.append(el("div", { className: "routhead" }, [el("h1", { textContent: "Routines" }), add]));
  const body = el("div");
  m.append(body);
  if (last) draw(body, last, add);
  else body.append(el("p", { className: "sub", textContent: "Loading…" }));
  fetch("/api/routines")
    .then((r) => r.json())
    .then((d) => {
      if (d.error) throw new Error(d.error);
      last = d;
      body.replaceChildren();
      draw(body, d, add);
    })
    .catch((err) => body.replaceChildren(el("p", { className: "err", textContent: String(err.message || err) })));
}

function draw(body, d, add) {
  add.onclick = () => edit(d, null, null);
  add.disabled = !d.staff.length;
  if (!d.staff.length) {
    body.append(el("p", { className: "sub", textContent: "Hire a staff member first." }));
    return;
  }
  for (const s of d.staff) {
    const list = el("div", { className: "connlist routlist" });
    list.append(dailyRow(s, d));
    for (const r of s.routines) list.append(routineRow(s, r, d));
    const more = el("button", { className: "routadd" }, [icon("plus"), el("span", { textContent: "Add a routine for " + s.name })]);
    more.onclick = () => edit(d, s, null);
    list.append(more);
    body.append(el("h2", { className: "connhead", textContent: s.name }), list);
  }
}

function dailyRow(s, d) {
  const change = el("button", { className: "ghbtn", textContent: "Change time" });
  change.onclick = () => editDaily(d, s);
  return el("div", { className: "connrow routrow" }, [
    el("span", { className: "connicon" }, [icon("refresh")]),
    el("div", { className: "conntext" }, [
      el("b", { textContent: "Daily round" }),
      el("span", { className: "routwhen", textContent: s.dailyWhen }),
    ]),
    el("div", { className: "row connacts" }, [change]),
  ]);
}

function routineRow(s, r, d) {
  const run = el("button", { className: "ghbtn", textContent: "Run now" });
  run.onclick = () => runNow(s, r, run);
  const change = el("button", { className: "ghbtn", textContent: "Edit" });
  change.onclick = () => edit(d, s, r);
  const remove = el("button", { className: "ghbtn", textContent: "Remove" });
  remove.onclick = () => confirmRemove(s, r, remove);
  return el("div", { className: "connrow routrow" }, [
    el("span", { className: "connicon" }, [icon("clock")]),
    el("div", { className: "conntext" }, [
      el("b", { textContent: r.title }),
      el("span", { className: "routwhen", textContent: r.when }),
      r.body ? el("span", { className: "routbody", textContent: r.body }) : null,
    ].filter(Boolean)),
    el("div", { className: "row connacts" }, [run, change, remove]),
  ]);
}

async function runNow(s, r, btn) {
  btn.disabled = true;
  btn.textContent = "Starting…";
  try {
    const res = await post({ staff: s.handle, routine: r.id }, "/api/run/start");
    btn.replaceWith(el("a", { className: "ghbtn", href: res.url, target: "_blank", rel: "noopener", textContent: "Started" }));
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Run now";
    btn.title = String(err.message || err);
  }
}

async function confirmRemove(s, r, btn) {
  if (btn.dataset.sure !== "1") {
    btn.dataset.sure = "1";
    btn.textContent = "Remove " + r.title + "?";
    btn.classList.add("danger");
    return;
  }
  btn.disabled = true;
  btn.textContent = "Removing…";
  try {
    await save(s, s.daily, s.routines.filter((x) => x.id !== r.id));
    last = null;
    render();
  } catch (err) {
    btn.textContent = String(err.message || err);
  }
}

/** One staff member's whole schedule, as the server wants it. */
function save(s, daily, routines) {
  return post(
    {
      staff: s.handle,
      daily,
      routines: routines.map((r) => ({ id: r.id, title: r.title, body: r.body, schedule: r.schedule })),
    },
    "/api/routines/save",
  );
}

/* --------------------------------- editors --------------------------------- */

function edit(d, s, r) {
  let box = null;
  const node = routineForm(d, s, r, () => box?.close());
  box = sheet({ node, onClose: () => {} });
  if (!box) document.querySelector("#main")?.append(node);
}

function editDaily(d, s) {
  let box = null;
  const close = () => box?.close();
  const out = el("div", { className: "routform" });
  out.append(el("h2", { className: "sheettitle", textContent: s.name + "'s daily round" }));
  const when = whenField(s.daily);
  out.append(when.node);
  const status = el("div");
  const ok = el("button", { className: "ghbtn primary", textContent: "Save" });
  const cancel = el("button", { className: "ghbtn", textContent: "Cancel" });
  cancel.onclick = close;
  ok.onclick = async () => {
    ok.disabled = true;
    ok.textContent = "Saving…";
    try {
      await save(s, when.value(), s.routines);
      last = null;
      close();
      render();
    } catch (err) {
      ok.disabled = false;
      ok.textContent = "Save";
      status.replaceChildren(el("p", { className: "err", textContent: String(err.message || err) }));
    }
  };
  out.append(status, el("div", { className: "row connfoot" }, [ok, cancel]));
  box = sheet({ node: out, onClose: () => {} });
  if (!box) document.querySelector("#main")?.append(out);
}

function routineForm(d, s, r, close) {
  const out = el("div", { className: "routform" });
  out.append(el("h2", { className: "sheettitle", textContent: r ? r.title : "New routine" }));

  let who = s ?? d.staff[0];
  const pick = el("div", { className: "routwho" });
  if (!r) {
    for (const p of d.staff) {
      const chip = el("button", { className: "routchip" + (p === who ? " on" : ""), textContent: p.name, type: "button" });
      chip.onclick = () => {
        who = p;
        for (const c of pick.children) c.classList.toggle("on", c === chip);
        say();
      };
      pick.append(chip);
    }
    out.append(field("Who", pick));
  }

  const name = el("input", { type: "text", value: r?.title ?? "", placeholder: "Monday plan", spellcheck: true });
  out.append(field("Name", name));

  const when = whenField(r?.schedule ?? "0 9 * * 1");
  out.append(when.node);

  const todo = el("textarea", {
    className: "routtodo",
    value: r?.body ?? "",
    rows: 8,
    placeholder: "Plan the week. Read last week's status issue and this month's priorities, then open one issue per thing to ship this week, ranked.",
  });
  out.append(field("What to do", todo));

  const preview = el("div", { className: "routpreview" });
  out.append(preview);
  const say = () => {
    const text = todo.value.trim();
    preview.replaceChildren(
      el("span", { className: "connicon" }, [icon("clock")]),
      el("div", {}, [
        el("b", { textContent: describe(when.value()) + ", " + who.name + " wakes up and:" }),
        el("p", { textContent: text || "…" }),
      ]),
    );
  };
  name.oninput = say;
  todo.oninput = () => {
    grow(todo);
    say();
  };
  when.onchange(say);
  say();

  const status = el("div");
  const ok = el("button", { className: "ghbtn primary", textContent: "Save" });
  const cancel = el("button", { className: "ghbtn", textContent: "Cancel" });
  cancel.onclick = close;
  ok.onclick = async () => {
    const next = { id: r?.id, title: name.value.trim(), body: todo.value, schedule: when.value() };
    if (!next.title) return status.replaceChildren(el("p", { className: "err", textContent: "Give it a name." }));
    if (!next.body.trim()) return status.replaceChildren(el("p", { className: "err", textContent: "Say what to do." }));
    ok.disabled = true;
    ok.textContent = "Saving…";
    try {
      const routines = r ? who.routines.map((x) => (x.id === r.id ? next : x)) : [...who.routines, next];
      await save(who, who.daily, routines);
      last = null;
      close();
      render();
    } catch (err) {
      ok.disabled = false;
      ok.textContent = "Save";
      status.replaceChildren(el("p", { className: "err", textContent: String(err.message || err) }));
    }
  };
  out.append(status, el("div", { className: "row connfoot" }, [ok, cancel]));
  return out;
}

function field(label, control) {
  return el("div", { className: "field routfield" }, [el("span", { textContent: label }), control]);
}

/* --------------------------------- the time --------------------------------- */

const DAYS = [
  ["1", "Mon"],
  ["2", "Tue"],
  ["3", "Wed"],
  ["4", "Thu"],
  ["5", "Fri"],
  ["6", "Sat"],
  ["0", "Sun"],
];

/**
 * When, as days and a time, or a day of the month, rather than as cron. The value is still a
 * cron, because that is what goes in the workflow. A cron the picker cannot show is kept as
 * typed, in a box of its own.
 */
function whenField(cron) {
  const parsed = parseCron(cron);
  const listeners = [];
  const changed = () => {
    for (const f of listeners) f();
    said.textContent = describe(value()) + local(time.value);
  };

  const repeat = el("select");
  repeat.append(
    el("option", { value: "week", textContent: "Days of the week" }),
    el("option", { value: "month", textContent: "Day of the month" }),
    el("option", { value: "cron", textContent: "Cron" }),
  );
  repeat.value = parsed.kind;

  const days = new Set(parsed.days);
  const dayRow = el("div", { className: "routdays" });
  for (const [v, label] of DAYS) {
    const chip = el("button", { className: "routchip" + (days.has(v) ? " on" : ""), textContent: label, type: "button" });
    chip.onclick = () => {
      days.has(v) ? days.delete(v) : days.add(v);
      chip.classList.toggle("on", days.has(v));
      changed();
    };
    dayRow.append(chip);
  }
  const dom = el("input", { type: "number", min: "1", max: "28", value: String(parsed.dom), style: "width:80px" });
  const time = el("input", { type: "time", step: "60", value: parsed.time, style: "width:130px" });
  const raw = el("input", { type: "text", value: cron, spellcheck: false, placeholder: "0 9 * * 1" });
  const said = el("small", { className: "routsaid" });

  const domRow = el("div", { className: "row" }, [el("span", { className: "meta", textContent: "Day" }), dom]);
  const timeRow = el("div", { className: "row" }, [time, el("span", { className: "meta", textContent: "UTC" })]);
  const show = () => {
    dayRow.hidden = repeat.value !== "week";
    domRow.hidden = repeat.value !== "month";
    timeRow.hidden = repeat.value === "cron";
    raw.hidden = repeat.value !== "cron";
  };
  repeat.onchange = () => {
    show();
    changed();
  };
  for (const input of [dom, time, raw]) input.oninput = changed;

  function value() {
    if (repeat.value === "cron") return raw.value.trim();
    const [h, m] = (time.value || "09:00").split(":").map(Number);
    if (repeat.value === "month") return `${m} ${h} ${Math.min(28, Math.max(1, Number(dom.value) || 1))} * *`;
    const picked = DAYS.map(([v]) => v).filter((v) => days.has(v));
    return `${m} ${h} * * ${dayList(picked)}`;
  }

  show();
  said.textContent = describe(value()) + local(time.value);
  const node = el("div", { className: "field routfield" }, [
    el("span", { textContent: "When" }),
    el("div", { className: "routwhenpick" }, [repeat, dayRow, domRow, timeRow, raw, said]),
  ]);
  return { node, value, onchange: (f) => listeners.push(f) };
}

/** Days for cron, in its own short forms where there is one. */
function dayList(picked) {
  const set = new Set(picked);
  if (set.size === 0 || set.size === 7) return "*";
  if (set.size === 5 && ["1", "2", "3", "4", "5"].every((d) => set.has(d))) return "1-5";
  return [...set].map(Number).sort((a, b) => a - b).join(",");
}

export function parseCron(cron) {
  const [min, hour, dom, mon, dow] = String(cron).trim().split(/\s+/);
  const plain = /^\d+$/.test(min ?? "") && /^\d+$/.test(hour ?? "") && mon === "*";
  const time = plain ? `${hour.padStart(2, "0")}:${min.padStart(2, "0")}` : "09:00";
  if (plain && dom === "*") {
    const days =
      dow === "*" ? ["0", "1", "2", "3", "4", "5", "6"] : dow === "1-5" ? ["1", "2", "3", "4", "5"] : /^[0-6](,[0-6])*$/.test(dow) ? dow.split(",") : null;
    if (days) return { kind: "week", days, time, dom: 1 };
  }
  if (plain && /^\d+$/.test(dom ?? "") && dow === "*") return { kind: "month", days: ["1"], time, dom: Number(dom) };
  return { kind: "cron", days: ["1"], time, dom: 1 };
}

const DAY_NAME = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The same words the server gives a schedule, so the preview and the list agree. */
export function describe(cron) {
  const p = parseCron(cron);
  const at = "at " + p.time + " UTC";
  if (p.kind === "month") return `On the ${ordinal(p.dom)} of each month ${at}`;
  if (p.kind === "cron") return cron || "No time yet";
  const d = cron.trim().split(/\s+/)[4];
  if (d === "*") return "Every day " + at;
  if (d === "1-5") return "Weekdays " + at;
  if (d === "0,6" || d === "6,0") return "Weekends " + at;
  const names = p.days.map((x) => DAY_NAME[Number(x)] + "s");
  return (names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names.at(-1) : names[0]) + " " + at;
}

function ordinal(n) {
  const tens = n % 100;
  return n + (tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th"));
}

/** What that UTC time is where the person reading it is, when the two differ. */
function local(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const at = new Date(Date.UTC(2026, 0, 5, h, m));
  const here = at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  return here === hhmm ? "" : " · " + here + " where you are";
}
