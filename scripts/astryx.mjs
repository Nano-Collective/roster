#!/usr/bin/env node
/**
 * The portal in Astryx's clothes, without Astryx's React.
 *
 *   node scripts/astryx.mjs     writes templates/portal/css/astryx.css
 *
 * Astryx (Meta's design system, MIT) ships its components as React and its look as precompiled
 * StyleX: one atomic class per declaration, `.x1ewilqj{background-color:var(--color-accent)}`.
 * The portal is plain modules with no build step, so it cannot render the components — but it
 * does not need to. This renders each one once, here, reads which classes land on which element,
 * pulls those classes' rules out of astryx.css, and writes them back out under the portal's own
 * selectors: Astryx's secondary Button becomes `.ghbtn`, its SideNavItem becomes `.nav`.
 *
 * The declarations are Astryx's, verbatim, so the look is exact. What changes is the selector,
 * and with it the specificity. StyleX pins every rule at ID weight (`:not(#\#)`, two to four
 * times over) so its atoms win wherever they land. Kept, that would also beat every rule the
 * portal writes to lay a control out in context, so it comes off, and the order the boosts
 * encoded — longhands over shorthands, states over the resting look — is kept by sorting on it.
 *
 * Generated, so an upgrade is: bump the two packages, run this, look at the portal.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Badge,
  Button,
  Card,
  IconButton,
  Kbd,
  Selector,
  SideNav,
  SideNavItem,
  SideNavSection,
  TextArea,
  TextInput,
  Theme,
} from "@astryxdesign/core";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Neither package exports its package.json, so they are found where pnpm puts them.
const pkgDir = (name) => join(root, "node_modules", name);
const coreDir = join(pkgDir("@astryxdesign/core"), "dist");
const coreCss = readFileSync(join(coreDir, "astryx.css"), "utf8");
const themeCss = readFileSync(
  join(pkgDir("@astryxdesign/theme-neutral"), "dist", "theme.css"),
  "utf8",
);
const version = JSON.parse(
  readFileSync(join(pkgDir("@astryxdesign/core"), "package.json"), "utf8"),
).version;
const h = React.createElement;

/* ---------- the stylesheet, as a flat list of rules ---------- */

/** Nested blocks into `{ ats, sel, body }`, in file order; @keyframes and @property kept whole. */
function flatten(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [];
  const raw = [];
  const walk = (i, ats) => {
    while (i < src.length) {
      const open = src.indexOf("{", i);
      const close = src.indexOf("}", i);
      const semi = src.indexOf(";", i);
      if (close !== -1 && (open === -1 || close < open) && (semi === -1 || close < semi))
        return close + 1;
      if (open === -1) return src.length;
      if (semi !== -1 && semi < open) {
        i = semi + 1; // `@layer a, b;`
        continue;
      }
      const prelude = src.slice(i, open).trim();
      if (/^@(keyframes|property)/.test(prelude)) {
        let depth = 0;
        let j = open;
        for (; j < src.length; j++) {
          if (src[j] === "{") depth++;
          else if (src[j] === "}" && --depth === 0) break;
        }
        raw.push({ prelude, text: src.slice(i, j + 1).trim() });
        i = j + 1;
      } else if (prelude.startsWith("@")) {
        i = walk(open + 1, prelude.startsWith("@layer") ? ats : [...ats, prelude]);
      } else {
        const end = src.indexOf("}", open);
        rules.push({ ats, sel: prelude, body: src.slice(open + 1, end).trim() });
        i = end + 1;
      }
    }
    return i;
  };
  walk(0, []);
  return { rules, raw };
}

const { rules, raw } = flatten(coreCss);
const ATOM = /\.(x[a-z0-9]+)/g;

/** Rules by the one atomic class each is written for. */
const byClass = new Map();
rules.forEach((r, order) => {
  const atoms = new Set([...r.sel.matchAll(ATOM)].map((m) => m[1]));
  if (atoms.size !== 1 || r.sel.startsWith(":root")) return;
  const [c] = atoms;
  if (!byClass.has(c)) byClass.set(c, []);
  byClass.get(c).push({ ...r, order });
});

/* ---------- the components, rendered once ---------- */

const COMPONENTS = { Badge, Button, Card, IconButton, Kbd, SideNav, TextArea, TextInput };

function elements(name, props, kids) {
  const html = renderToStaticMarkup(
    h(Theme, { theme: "neutral" }, h(COMPONENTS[name], props, kids)),
  );
  return [...html.matchAll(/<([a-z]+)\b([^>]*)>/g)].map((m) => ({
    tag: m[1],
    attrs: m[2],
    classes: (m[2].match(/class="([^"]*)"/)?.[1] ?? "").split(/\s+/).filter(Boolean),
  }));
}

/** The classes on one element of a rendered component, picked by `pick`. */
function classesOf([name, props, kids, pick]) {
  const el = elements(name, props, kids).find(pick);
  if (!el) throw new Error(`${name}: no element matched`);
  return el.classes.filter((c) => byClass.has(c));
}

/** One element's rules, less the properties `skip` names. */
const rulesOf = (spec) =>
  classesOf(spec).flatMap((c) =>
    byClass.get(c).filter((r) => !spec[4]?.some((p) => overlaps(prop(r.body), p))),
  );

const is = (marker) => (e) => e.classes.includes(marker);
const tag = (t) => (e) => e.tag === t;
const field = (e) => e.tag === "div" && /data-size=/.test(e.attrs);
const title = (e) => /\bid="[^"]*-title"/.test(e.attrs);
/** A field's own frame, which the wrapper draws instead. */
const FRAME = ["border", "background-color", "outline", "box-shadow"];

const BUTTON = (variant, isDisabled, size) => [
  "Button",
  { label: "x", variant, isDisabled, size },
  null,
  is("astryx-button"),
];
const BADGE = (variant) => ["Badge", { label: "x", variant }, null, is("astryx-badge")];
const NAVITEM = (isSelected) => [
  "SideNav",
  null,
  h(SideNavSection, { title: "x" }, h(SideNavItem, { label: "x", isSelected })),
  is("astryx-side-nav-item"),
];

/*
 * What the portal calls each thing, and which Astryx element it is.
 *
 *   parts   one element's classes, or several merged with the later winning a property
 *           outright: Astryx draws a field's border on a wrapper round the bare <input>, and
 *           the portal's inputs have no wrapper, so the input wears both. A fifth entry names
 *           properties that element does not contribute.
 *   minus   a variant writes only what its base does not, so `.ghbtn.primary` is the primary
 *           Button's difference from the secondary one, laid over `.ghbtn`.
 *   omit    properties that are the component's layout inside React's markup, not its look.
 */
const TARGETS = [
  { sel: [".ghbtn", ".btn"], parts: [BUTTON("secondary")] },
  {
    sel: [".ghbtn.primary", ".btn.primary"],
    parts: [BUTTON("primary")],
    minus: BUTTON("secondary"),
  },
  { sel: [".ghbtn.danger"], parts: [BUTTON("destructive")], minus: BUTTON("secondary") },
  { sel: [".ghbtn.sm"], parts: [BUTTON("secondary", false, "sm")], minus: BUTTON("secondary") },
  {
    sel: [".ghbtn:disabled", ".btn:disabled", ".iconbtn:disabled"],
    parts: [BUTTON("secondary", true)],
    minus: BUTTON("secondary"),
  },
  {
    sel: [".iconbtn"],
    parts: [["IconButton", { label: "x", icon: "x", variant: "secondary" }, null, tag("button")]],
  },
  { sel: [".chip"], parts: [BADGE("neutral")] },
  { sel: [".chip.hot"], parts: [BADGE("error")], minus: BADGE("neutral") },
  { sel: [".chip.warm"], parts: [BADGE("warning")], minus: BADGE("neutral") },
  { sel: [".chip.cool"], parts: [BADGE("info")], minus: BADGE("neutral") },
  { sel: [".chip.ok"], parts: [BADGE("success")], minus: BADGE("neutral") },
  { sel: ["kbd"], parts: [["Kbd", { keys: "k" }, null, tag("kbd")]] },
  { sel: [".card"], parts: [["Card", null, "x", is("astryx-card")]] },
  { sel: [".nav"], parts: [NAVITEM(false)] },
  { sel: ['.nav[aria-current="true"]'], parts: [NAVITEM(true)], minus: NAVITEM(false) },
  {
    sel: [".sect", ".sectfold"],
    parts: [["SideNav", null, h(SideNavSection, { title: "x" }), title]],
  },
  {
    sel: [
      "input[type=search]",
      "input[type=time]",
      "input[type=text]",
      "input[type=number]",
      "input[type=url]",
      "input[type=email]",
      "input[type=password]",
      "select",
    ],
    parts: [
      ["TextInput", { label: "x", isLabelHidden: true, value: "" }, null, tag("input"), FRAME],
      ["TextInput", { label: "x", isLabelHidden: true, value: "" }, null, field],
    ],
    omit: [
      "display",
      "flex",
      "position",
      "z-index",
      "gap",
      "align-items",
      "isolation",
      "--_field-status-overlap",
    ],
  },
  {
    sel: ["textarea"],
    parts: [
      ["TextArea", { label: "x", isLabelHidden: true, value: "" }, null, field],
      ["TextArea", { label: "x", isLabelHidden: true, value: "" }, null, tag("textarea"), FRAME],
    ],
    omit: [
      "display",
      "flex",
      "position",
      "z-index",
      "gap",
      "align-items",
      "isolation",
      "height",
      "--_field-status-overlap",
    ],
  },
];

/* ---------- the rules, under the portal's selectors ---------- */

const prop = (body) => body.slice(0, body.indexOf(":")).trim();
/** `padding` and `padding-inline` are the same fight; so are `border-width` and `border`. */
const overlaps = (a, b) => a === b || a.startsWith(`${b}-`) || b.startsWith(`${a}-`);

/** Specificity as StyleX wrote it: the boosts first, then the class repeats and pseudo-classes. */
function weight(sel) {
  const ids = (sel.match(/:not\(#\\#\)/g) ?? []).length;
  const rest = sel.replace(/:not\(#\\#\)/g, "").replace(/:where\([^)]*\)/g, "");
  const classes = (rest.match(/[.:[](?!:)/g) ?? []).length;
  return ids * 1000 + classes;
}

function rewrite(r, sels) {
  if (r.sel.includes("astryx-press")) return null; // driven by Astryx's script, which is not here
  const c = [...r.sel.matchAll(ATOM)][0][1];
  const bare = r.sel.replace(/:not\(#\\#\)/g, "").replace(new RegExp(`(\\.${c})+`), "\u0000");
  return sels.map((s) => bare.replace("\u0000", s)).join(",");
}

function emit(t) {
  const minus = new Set(t.minus ? rulesOf(t.minus).map((r) => r.order) : []);
  const sets = t.parts.map((spec) => rulesOf(spec).filter((r) => !minus.has(r.order)));
  // A later part's properties are the ones that stand: drop them from the parts before it.
  const picked = sets.flatMap((set, i) => {
    const later = sets
      .slice(i + 1)
      .flat()
      .map((r) => prop(r.body));
    return set.filter((r) => {
      const p = prop(r.body);
      return !t.omit?.includes(p) && !later.some((q) => overlaps(p, q));
    });
  });
  const seen = new Set();
  return picked
    .filter((r) => !seen.has(r.order) && seen.add(r.order))
    .sort((a, b) => weight(a.sel) - weight(b.sel) || a.order - b.order)
    .map((r) => ({ ats: r.ats, sel: rewrite(r, t.sel), body: r.body }))
    .filter((r) => r.sel);
}

/** Neighbouring rules with the same selector and at-rules become one. */
function print(list) {
  const out = [];
  for (const r of list) {
    const last = out.at(-1);
    if (last && last.sel === r.sel && last.ats.join() === r.ats.join()) last.body.push(r.body);
    else out.push({ ...r, body: [r.body] });
  }
  return out
    .map((r) => {
      const rule = `${r.sel}{${r.body.join(";")}}`;
      return r.ats.reduceRight((inner, at) => `${at}{${inner}}`, rule);
    })
    .join("\n");
}

const components = TARGETS.map((t) => `/* ${t.sel.join(", ")} */\n${print(emit(t))}`).join("\n\n");

/* ---------- components the portal builds itself, verbatim ----------
 *
 * A control the portal draws in its own markup, the dropdown, can wear Astryx's atomic classes
 * as they are: nothing else in the portal styles those elements, so there is no context to
 * leave room for, and the rules go out unchanged, boosts and all. js/astryx-ui.js has the
 * class strings and js/select.js builds the markup from them.
 */

/** A style object in a compiled module, by name: `  itemHighlighted: { kWkggS: "x1lmrjuc" }`. */
function compiledStyle(file, name) {
  const src = readFileSync(join(coreDir, file), "utf8");
  const m = src.match(new RegExp(`\\n  ${name}: \\{([^}]*)\\}`));
  if (!m) throw new Error(`${file}: no style called ${name}`);
  return [...m[1].matchAll(/"([^"]*)"/g)].flatMap((x) => x[1].split(" ")).filter(Boolean);
}

/**
 * Astryx's Selector, mounted and opened. Its list is a layer the client mounts, so a server
 * render has only the trigger: this one runs in jsdom, with the handful of browser APIs Astryx
 * asks for stubbed, which is enough for it to draw. Returns the document, the trigger as it was
 * closed, and the stylesheets Astryx installs at run time (the layer's `@position-try` rules).
 */
async function openSelector() {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM("<!doctype html><html><head></head><body><div></div></body></html>", {
    pretendToBeVisual: true,
  });
  const w = dom.window;
  for (const k of ["window", "document", "navigator", "HTMLElement", "Element", "Node"]) {
    Object.defineProperty(globalThis, k, { value: w[k], configurable: true, writable: true });
  }
  const inert = () => ({ observe() {}, unobserve() {}, disconnect() {} });
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.ResizeObserver = globalThis.ResizeObserver = class {
    constructor() {
      Object.assign(this, inert());
    }
  };
  w.IntersectionObserver = globalThis.IntersectionObserver = w.ResizeObserver;
  for (const m of ["showPopover", "hidePopover", "scrollIntoView"]) {
    w.HTMLElement.prototype[m] = () => {};
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = await import("react-dom/client");
  const doc = w.document;
  const options = [
    { value: "a", label: "a" },
    { value: "b", label: "b" },
  ];
  const root = createRoot(doc.body.firstElementChild);
  await React.act(async () =>
    root.render(
      h(Selector, { label: "x", isLabelHidden: true, options, value: "a", onChange() {} }),
    ),
  );
  const closed = {
    frame: doc.querySelector("[data-variant=input]").className,
    button: doc.querySelector("[role=combobox]").className,
    chevron: doc.querySelector("[data-variant=input] > span[aria-hidden]").className,
  };
  const button = doc.querySelector("[role=combobox]");
  await React.act(async () => {
    button.dispatchEvent(new w.PointerEvent("pointerdown", { bubbles: true }));
    button.click();
  });
  await React.act(() => new Promise((r) => setTimeout(r, 50)));
  const styles = [...doc.head.querySelectorAll("style")].map((s) => s.textContent);
  return { doc, closed, styles };
}

const atoms = (className) =>
  String(className)
    .split(/\s+/)
    .filter((c) => byClass.has(c));

const sel = await openSelector();
const { SELECTOR, LAYER_STYLE } = (() => {
  const d = sel.doc;
  const opts = d.querySelectorAll("[role=option]");
  const picked = opts[0];
  const plain = opts[1];
  const frame = d.querySelector("[data-variant=input]");
  const layer = d.querySelector("[popover]");
  const SELECTOR = {
    frame: atoms(sel.closed.frame),
    button: atoms(sel.closed.button),
    buttonOpen: atoms(d.querySelector("[role=combobox]").className),
    value: atoms(d.querySelector("[role=combobox] > span").className),
    chevron: atoms(sel.closed.chevron),
    chevronOpen: atoms(frame.querySelector(":scope > span[aria-hidden]").className),
    layer: atoms(layer.className),
    layerInner: atoms(layer.firstElementChild.className),
    listbox: atoms(d.querySelector("[role=listbox]").className),
    option: atoms(plain.className),
    optionMain: atoms(plain.children[0].className),
    optionRow: atoms(plain.children[0].firstElementChild.className),
    optionLabelOuter: atoms(plain.children[0].firstElementChild.firstElementChild.className),
    optionLabel: atoms(
      plain.children[0].firstElementChild.firstElementChild.firstElementChild.className,
    ),
    optionEnd: atoms(plain.children[1].className),
    check: atoms(picked.children[1].firstElementChild.className),
    // The states React adds and takes away, read from the module rather than guessed at.
    selected: compiledStyle("Selector/Selector.js", "itemSelected"),
    highlighted: compiledStyle("Selector/Selector.js", "itemHighlighted"),
    keyboard: compiledStyle("Selector/Selector.js", "itemKeyboardHighlighted"),
    disabled: compiledStyle("Selector/Selector.js", "itemDisabled"),
  };
  const anchor = /anchor-name:\s*([^;]+)/.exec(frame.getAttribute("style"))[1].trim();
  // The layer's own inline style, positioned off whichever trigger opened it.
  return { SELECTOR, LAYER_STYLE: layer.getAttribute("style").replaceAll(anchor, "{anchor}") };
})();

const verbatimClasses = new Set(Object.values(SELECTOR).flat());
const verbatim = rules
  .filter((r) => {
    const found = [...r.sel.matchAll(ATOM)].map((m) => m[1]);
    return found.length && found.every((c) => verbatimClasses.has(c));
  })
  .map((r) => r.ats.reduceRight((inner, at) => `${at}{${inner}}`, `${r.sel}{${r.body}}`))
  .join("\n");
const runtime = sel.styles.join("\n");

const ui = `/*
 * Generated by scripts/astryx.mjs from @astryxdesign/core ${version}. Do not edit.
 *
 * Astryx's own class strings for the controls the portal builds in its own markup, element by
 * element, as the React components put them. css/astryx.css carries their rules unchanged.
 * Astryx: Copyright (c) Meta Platforms, Inc. and affiliates. MIT licence.
 */

/** Selector: the trigger, the layer it opens, and a row in its list, with the row's states. */
export const SELECTOR = ${JSON.stringify(
  Object.fromEntries(Object.entries(SELECTOR).map(([k, v]) => [k, v.join(" ")])),
  null,
  2,
)};

/** The layer's inline style: \`{anchor}\` is the trigger's anchor name. */
export const LAYER_STYLE = ${JSON.stringify(LAYER_STYLE)};
`;
writeFileSync(join(root, "templates/portal/js/astryx-ui.js"), ui);

/* The tokens the core defines for itself (sizes, focus ring, easing), and what the rules name. */
const tokens = [
  ...new Set(rules.filter((r) => r.sel.startsWith(":root")).map((r) => r.body.replace(/;+$/, ""))),
].join(";");
const used = (name) =>
  components.includes(name) || tokens.includes(name) || verbatim.includes(name);
const extras = raw
  .filter((x) => used(x.prelude.split(/\s+/)[1]))
  .map((x) => x.text)
  .join("\n");

const out = `/*
 * Generated by scripts/astryx.mjs from @astryxdesign/core and @astryxdesign/theme-neutral
 * ${version}. Do not edit: change the script, or the portal's own stylesheets, and rerun it.
 *
 * Astryx: Copyright (c) Meta Platforms, Inc. and affiliates. MIT licence.
 */

/* ---------- the neutral theme, as published ---------- */
${themeCss.replace(/^\/\*[\s\S]*?\*\/\s*/, "")}
/* ---------- the core's own tokens ----------
   In the layer Astryx gives them, which the theme's comes after: these are the defaults the
   theme overrides, and unlayered they would beat it. */
@layer astryx-base{:root{${tokens}}}
${extras}

/* ---------- components, under the portal's selectors ---------- */
${components}

/* ---------- components the portal builds itself (js/astryx-ui.js), verbatim ---------- */
@layer astryx-base{
${verbatim}
}
/* What Astryx installs at run time: the layer's @position-try fallbacks. */
${runtime}
`;
writeFileSync(join(root, "templates/portal/css/astryx.css"), out);
console.log(`templates/portal/css/astryx.css: ${(out.length / 1024).toFixed(1)} KB`);
