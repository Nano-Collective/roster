/* The Connectors screen: outside services the staff can use in their runs.
 *
 * What is connected, as cards, and what can be, as a grid. Picking one opens a sheet with how
 * to get its key, the key, who gets it, and Save. A key is checked with the service before it is
 * stored, goes to GitHub as a secret, and is never shown again. A service that only signs in
 * (Notion) signs in through the hosted portal instead.
 */

import { getConnectors, post } from "../api.js";
import { sheet } from "../dialog.js";
import { el, toClipboard } from "../dom.js";
import { icon } from "../icons.js";
import { render } from "../router.js";
import { S } from "../state.js";

/* The last answer, so a repaint after Save does not flash an empty screen. */
let last = null;

export function viewConnectors(m) {
  m.append(el("h1", { textContent: "Connectors" }));
  const notice = signInNotice();
  if (notice) m.append(notice);
  const body = el("div");
  m.append(body);
  if (last) draw(body, last);
  else body.append(el("p", { className: "sub", textContent: "Loading…" }));
  getConnectors()
    .then((d) => {
      if (d.error) throw new Error(d.error);
      last = d;
      body.replaceChildren();
      draw(body, d);
    })
    .catch((err) => body.replaceChildren(el("p", { className: "err", textContent: String(err.message || err) })));
}

/** A sign-in that came back with a problem says so once, from the URL it came back to. */
function signInNotice() {
  const q = (location.hash.split("?")[1] ?? "");
  const e = new URLSearchParams(q).get("e");
  if (!e) return null;
  history.replaceState?.(null, "", location.hash.replace(/\?.*$/, ""));
  return el("p", { className: "err connerr", textContent: e });
}

function draw(body, d) {
  const have = new Set(d.connectors.map((c) => c.catalogue ?? c.id));

  if (d.connectors.length) {
    const list = el("div", { className: "connlist" });
    for (const c of d.connectors) list.append(row(c, d));
    body.append(el("h2", { className: "connhead", textContent: "Connected" }), list);
  }

  const grid = el("div", { className: "conngrid" });
  for (const e of d.catalogue) {
    if (have.has(e.id)) continue;
    // One Notion, whichever this portal can do: signing in where it keeps sign-ins, a key elsewhere.
    if (e.auth === "oauth" && !d.signIn) continue;
    if (e.id === "notion-key" && d.signIn && !have.has("notion-key")) continue;
    const card = el("button", { className: "conncard" }, [
      el("span", { className: "connicon" }, [icon("plug")]),
      el("span", {}, [el("b", { textContent: shortName(e) }), el("small", { textContent: e.summary })]),
    ]);
    card.onclick = () => open(e, null, d);
    grid.append(card);
  }
  const own = el("button", { className: "conncard" }, [
    el("span", { className: "connicon" }, [icon("plug")]),
    el("span", {}, [el("b", { textContent: "Custom server" }), el("small", { textContent: "Any MCP server, by its URL." })]),
  ]);
  own.onclick = () => openCustom(d);
  grid.append(own);
  body.append(el("h2", { className: "connhead", textContent: d.connectors.length ? "Add another" : "Add a service" }), grid);
  body.append(...ownAgent());
}

/* --------------------- this portal as an MCP server, elsewhere --------------------- */

/** How to add this portal's MCP server to Claude Code, Codex, Claude or anything else. */
function ownAgent() {
  const head = el("h2", { className: "connhead", textContent: "Connect your own agent" });
  if (!S.hosted) {
    return [head, el("p", { className: "sub", textContent: "Needs the hosted portal: roster portal deploy." })];
  }
  const url = location.origin + "/mcp";
  // Named after the org, so a second Roster in the same agent gets tools of its own.
  const slug = String(S.data?.name ?? S.data?.org ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const name = slug ? "roster-" + slug : "roster";
  const rows = [
    ["Claude Code", `claude mcp add --transport http ${name} ${url}`, "Then run /mcp and sign in."],
    ["Codex", `codex mcp add ${name} --url ${url} && codex mcp login ${name}`, ""],
    ["Claude", url, "Settings → Connectors → Add custom connector."],
    ["Anything else", url, ""],
  ];
  const list = el("div", { className: "connlist" });
  for (const [label, text, then] of rows) {
    const copy = el("button", { className: "ghbtn", textContent: "Copy" });
    copy.onclick = () => toClipboard(text, copy, "Copy");
    list.append(
      el("div", { className: "connrow connmcp" }, [
        el("div", { className: "conntext" }, [
          el("b", { textContent: label }),
          el("code", { textContent: text }),
          then ? el("small", { textContent: then }) : null,
        ].filter(Boolean)),
        copy,
      ]),
    );
  }
  return [head, el("p", { className: "sub", textContent: "Sign in with GitHub when it asks." }), list];
}

/** "Notion (integration key)" is only Notion where it is the one Notion on offer. */
function shortName(e) {
  return e.name.replace(/ \(.*\)$/, "");
}

function row(c, d) {
  const e = d.catalogue.find((x) => x.id === (c.catalogue ?? c.id));
  const status = c.problem
    ? el("span", { className: "chip hot", textContent: "Needs fixing" })
    : c.auth === "oauth"
      ? c.signedIn
        ? el("span", { className: "chip ok", textContent: "Signed in" })
        : el("span", { className: "chip warm", textContent: "Not signed in" })
      : c.keys === "stored"
        ? el("span", { className: "chip ok", textContent: "Key stored" })
        : c.keys === "unknown"
          ? el("span", { className: "chip", textContent: "Key not checked" })
          : el("span", { className: "chip warm", textContent: c.keys === "partial" ? "Key on some repos" : "No key" });

  const who = el("div", { className: "connwho" });
  for (const h of c.staff) who.append(el("span", { className: "chip", textContent: h }));
  if (c.readOnly) who.append(el("span", { className: "chip cool", textContent: "read only" }));

  const edit = el("button", { className: "ghbtn", textContent: "Edit" });
  edit.onclick = () => open(e ?? custom(c), c, d);
  edit.disabled = !d.canWrite || (!e && Boolean(c.problem));
  const remove = el("button", { className: "ghbtn", textContent: "Remove" });
  remove.disabled = !d.canWrite;
  remove.onclick = () => confirmRemove(c, remove);

  return el("div", { className: "connrow" }, [
    el("span", { className: "connicon" }, [icon("plug")]),
    el("div", { className: "conntext" }, [
      el("b", { textContent: c.name }),
      c.problem ? el("span", { className: "err", textContent: c.problem }) : who,
    ]),
    status,
    el("div", { className: "row connacts" }, [edit, remove]),
  ]);
}

/** A server the catalogue does not describe: who has it, and its key when it takes one. */
function custom(c) {
  const fields = c.auth === "key" && c.secrets.length === 1 ? [{ id: "token", label: c.secrets[0].label, secret: true }] : [];
  return { id: c.id, name: c.name, summary: c.url ?? "", fields, steps: [], auth: c.auth };
}

/* --------------------------- a server of your own ---------------------------- */

function openCustom(d) {
  let box = null;
  const node = customForm(d, () => box?.close());
  box = sheet({ node, onClose: () => {} });
  if (!box) document.querySelector("#main")?.append(node);
}

function customForm(d, close) {
  const out = el("div", { className: "connform" });
  out.append(el("h2", { className: "sheettitle", textContent: "Connect a custom server" }));

  const input = (placeholder, type = "text") => el("input", { type, autocomplete: "off", spellcheck: false, placeholder });
  const name = input("acme");
  const url = input("https://mcp.acme.dev/mcp");
  const header = input("Authorization");
  header.value = "Authorization";
  const key = input("Bearer …", "password");
  const field = (label, node) => el("label", { className: "field" }, [el("span", { textContent: label }), node]);
  out.append(el("div", { className: "setupform" }, [field("Name", name), field("URL", url)]));

  // How it signs in: a key in a header, the hosted portal's sign-in, or nothing.
  let auth = "key";
  const keyFields = el("div", { className: "setupform" }, [field("Header", header), field("Value", key)]);
  const choices = el("div", { className: "connstaff" });
  for (const [value, label] of [["key", "Key"], ["oauth", "Sign in"], ["none", "No key"]]) {
    if (value === "oauth" && !d.signIn) continue;
    const radio = el("input", { type: "radio", name: "connauth", checked: value === auth });
    radio.onchange = () => {
      auth = value;
      keyFields.hidden = auth !== "key";
      save.textContent = auth === "oauth" ? "Sign in" : "Save";
    };
    choices.append(el("label", { className: "conntick" }, [radio, el("span", { textContent: label })]));
  }
  out.append(el("h3", { className: "connsub", textContent: "Sign-in" }), choices, keyFields);

  const picked = new Set(d.staff.length === 1 ? [d.staff[0].handle] : []);
  out.append(el("h3", { className: "connsub", textContent: "Who can use it" }), staffPicker(d, picked));

  const status = el("div");
  const cancel = el("button", { className: "ghbtn", textContent: "Cancel" });
  cancel.onclick = close;
  const save = el("button", { className: "ghbtn primary", textContent: "Save" });
  save.disabled = !d.canWrite;
  const fail = (msg) => status.replaceChildren(el("p", { className: "err", textContent: msg }));
  save.onclick = async () => {
    const id = name.value.trim().toLowerCase();
    if (!id) return fail("Give it a name.");
    if (!picked.size) return fail("Pick at least one staff member.");
    if (auth === "key" && !key.value.trim()) return fail("Paste the key, or pick No key.");
    const label = save.textContent;
    save.disabled = true;
    save.textContent = auth === "oauth" ? "Opening…" : "Saving…";
    try {
      if (auth === "oauth") {
        const r = await post({ id, staff: [...picked], custom: { url: url.value.trim() } }, "/api/connectors/signin");
        location.href = r.url;
        return;
      }
      await post(
        {
          id,
          staff: [...picked],
          custom: { url: url.value.trim(), header: header.value.trim() },
          values: { token: auth === "key" ? key.value.trim() : "" },
        },
        "/api/connectors/save",
      );
      last = null;
      close();
      render();
    } catch (err) {
      save.disabled = false;
      save.textContent = label;
      fail(String(err.message || err));
    }
  };

  out.append(status, el("div", { className: "row connfoot" }, [save, cancel]));
  return out;
}

function staffPicker(d, picked) {
  const who = el("div", { className: "connstaff" });
  for (const s of d.staff) {
    const box = el("input", { type: "checkbox", checked: picked.has(s.handle) });
    box.onchange = () => (box.checked ? picked.add(s.handle) : picked.delete(s.handle));
    who.append(el("label", { className: "conntick" }, [box, el("span", { textContent: s.name })]));
  }
  return who;
}

async function confirmRemove(c, btn) {
  if (btn.dataset.sure !== "1") {
    btn.dataset.sure = "1";
    btn.textContent = "Remove " + c.name + "?";
    btn.classList.add("danger");
    return;
  }
  btn.disabled = true;
  btn.textContent = "Removing…";
  try {
    await post({ id: c.id }, "/api/connectors/remove");
    last = null;
    render();
  } catch (err) {
    btn.textContent = String(err.message || err);
  }
}

/* --------------------------------- the sheet --------------------------------- */

function open(e, c, d) {
  let box = null;
  const node = form(e, c, d, () => box?.close());
  box = sheet({ node, onClose: () => {} });
  if (!box) document.querySelector("#main")?.append(node);
}

function form(e, c, d, close) {
  const out = el("div", { className: "connform" });
  out.append(el("h2", { className: "sheettitle", textContent: (c ? "" : "Connect ") + shortName(e) }));
  if (!c || !c.known) out.append(el("p", { className: "sub", textContent: e.summary }));

  const oauth = e.auth === "oauth";
  if (!c && e.steps.length && !oauth) {
    const ol = el("ol", { className: "connsteps" });
    for (const s of e.steps) ol.append(el("li", { textContent: s }));
    out.append(ol);
    if (e.link) {
      out.append(
        el("a", { className: "ghbtn", href: e.link, target: "_blank", rel: "noopener", textContent: "Open " + shortName(e) }),
      );
    }
  }

  const fields = el("div", { className: "setupform" });
  const inputs = {};
  for (const f of e.fields) {
    const input = el("input", {
      type: f.secret ? "password" : "text",
      autocomplete: "off",
      spellcheck: false,
      placeholder: f.secret && c ? "Leave empty to keep the stored key" : f.required ? "" : "Optional",
      value: f.secret ? "" : (c?.settings?.[f.id] ?? ""),
    });
    inputs[f.id] = { input, f };
    fields.append(el("label", { className: "field" }, [el("span", { textContent: f.label }), input]));
  }
  if (e.fields.length) out.append(fields);

  const checked = el("div", { className: "conncheck" });
  const secretInputs = Object.values(inputs).filter((x) => x.f.secret);
  if (e.canCheck && secretInputs.length) {
    const check = el("button", { className: "ghbtn", textContent: "Check key" });
    check.onclick = async () => {
      check.disabled = true;
      check.textContent = "Checking…";
      try {
        const r = await post({ id: e.id, values: valuesOf(inputs) }, "/api/connectors/check");
        checked.replaceChildren(result(r));
      } catch (err) {
        checked.replaceChildren(el("p", { className: "err", textContent: String(err.message || err) }));
      } finally {
        check.disabled = false;
        check.textContent = "Check key";
      }
    };
    out.append(el("div", { className: "row" }, [check]), checked);
  }

  const picked = new Set(c ? c.staff : (e.suggest ?? []).filter((h) => d.staff.some((s) => s.handle === h)));
  if (!picked.size && d.staff.length === 1) picked.add(d.staff[0].handle);
  out.append(el("h3", { className: "connsub", textContent: "Who can use it" }), staffPicker(d, picked));

  let ro = null;
  if (e.readOnly) {
    ro = el("input", { type: "checkbox", checked: Boolean(c?.readOnly) });
    out.append(el("label", { className: "conntick" }, [ro, el("span", { textContent: "Read only" })]));
  }

  const status = el("div");
  const cancel = el("button", { className: "ghbtn", textContent: "Cancel" });
  cancel.onclick = close;
  const save = el("button", { className: "ghbtn primary" });

  if (oauth && !c?.signedIn) {
    save.textContent = "Sign in to " + e.name;
    save.disabled = !d.signIn || !d.canWrite;
    if (!d.signIn) {
      out.append(el("p", { className: "sub", textContent: "Signing in needs the hosted portal." }));
    }
    save.onclick = async () => {
      if (!picked.size) return status.replaceChildren(el("p", { className: "err", textContent: "Pick at least one staff member." }));
      save.disabled = true;
      save.textContent = "Opening " + e.name + "…";
      try {
        const r = await post({ id: e.id, staff: [...picked], readOnly: Boolean(ro?.checked) }, "/api/connectors/signin");
        location.href = r.url;
      } catch (err) {
        save.disabled = false;
        save.textContent = "Sign in to " + e.name;
        status.replaceChildren(el("p", { className: "err", textContent: String(err.message || err) }));
      }
    };
  } else {
    save.textContent = "Save";
    save.disabled = !d.canWrite;
    save.onclick = async () => {
      if (!picked.size) return status.replaceChildren(el("p", { className: "err", textContent: "Pick at least one staff member." }));
      save.disabled = true;
      save.textContent = "Saving…";
      try {
        await post(
          {
            id: e.id,
            staff: [...picked],
            readOnly: Boolean(ro?.checked),
            settings: settingsOf(inputs),
            values: valuesOf(inputs, true),
          },
          "/api/connectors/save",
        );
        last = null;
        close();
        render();
      } catch (err) {
        save.disabled = false;
        save.textContent = "Save";
        status.replaceChildren(el("p", { className: "err", textContent: String(err.message || err) }));
      }
    };
  }

  out.append(status, el("div", { className: "row connfoot" }, [save, cancel]));
  if (!d.canWrite) out.append(el("p", { className: "sub", textContent: "You are view-only, so you cannot change connectors." }));
  return out;
}

function result(r) {
  if (r.state === "ok") return el("p", { className: "okline", textContent: "The key works." });
  if (r.state === "limited") return el("p", { className: "okline", textContent: r.note });
  if (r.state === "rejected") return el("p", { className: "err", textContent: r.note });
  return el("p", { className: "sub", textContent: r.note });
}

/** Every field's value, for checking; only the keys, for storing. */
function valuesOf(inputs, keysOnly = false) {
  const out = {};
  for (const [id, { input, f }] of Object.entries(inputs)) {
    if (keysOnly && !f.secret) continue;
    out[id] = String(input.value ?? "").trim();
  }
  return out;
}

function settingsOf(inputs) {
  const out = {};
  for (const [id, { input, f }] of Object.entries(inputs)) if (!f.secret) out[id] = String(input.value ?? "").trim();
  return out;
}
