import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import type { Element, Root } from "hast";
import { toString as hastToString } from "hast-util-to-string";
import rehypePrettyCode from "rehype-pretty-code";
import rehypeSlug from "rehype-slug";
import rehypeStringify from "rehype-stringify";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { visit } from "unist-util-visit";

// The site reads the repo's own docs/ at build time, so the website can never disagree with them.
const DIR = join(process.cwd(), "..", "docs");
const BLOB = "https://github.com/Nano-Collective/roster/blob/main";

export type DocMeta = { slug: string; file: string; title: string; description: string; order: number };
export type Heading = { id: string; text: string };
export type Group = { title: string; docs: DocMeta[] };

const slugOf = (file: string) => (file === "README.md" ? "" : file.replace(/\.md$/, ""));
export const hrefOf = (slug: string) => (slug ? `/docs/${slug}/` : "/docs/");

let cache: DocMeta[] | undefined;

export function allDocs(): DocMeta[] {
  if (cache) return cache;
  cache = readdirSync(DIR)
    .filter((f) => f.endsWith(".md"))
    .map((file) => {
      const { data } = matter(readFileSync(join(DIR, file), "utf8"));
      return {
        slug: slugOf(file),
        file,
        title: String(data.title ?? file),
        description: String(data.description ?? ""),
        order: Number(data.sidebar_order ?? 99),
      };
    })
    .sort((a, b) => a.order - b.order);
  return cache;
}

/** The sidebar follows the README's own sections, so reordering the README reorders the site. */
export function groups(): Group[] {
  const docs = allDocs();
  const bySlug = new Map(docs.map((d) => [d.slug, d]));
  const readme = matter(readFileSync(join(DIR, "README.md"), "utf8")).content;
  const out: Group[] = [{ title: "Start here", docs: [bySlug.get("")!] }];
  const seen = new Set([""]);

  for (const section of readme.split(/^## /m).slice(1)) {
    const title = section.split("\n")[0]!.trim();
    const links = [...section.matchAll(/\]\(([\w-]+)\.md\)/g)].map((m) => m[1]!);
    const list = links.flatMap((s) => {
      const d = bySlug.get(s);
      if (!d || seen.has(s)) return [];
      seen.add(s);
      return [d];
    });
    if (list.length) out.push({ title, docs: list });
  }
  const rest = docs.filter((d) => !seen.has(d.slug));
  if (rest.length) out.push({ title: "More", docs: rest });
  return out;
}

function rewriteLinks() {
  return (tree: Root) => {
    visit(tree, "element", (el: Element) => {
      if (el.tagName === "a" && typeof el.properties.href === "string") {
        const href = el.properties.href;
        const doc = href.match(/^(?:\.\/)?([\w-]+)\.md(#.*)?$/);
        if (doc) el.properties.href = hrefOf(slugOf(`${doc[1]}.md`)) + (doc[2] ?? "");
        else if (!/^(https?:|mailto:|#|\/)/.test(href))
          el.properties.href = `${BLOB}/docs/${href.replace(/^\.\//, "")}`;
      }
      if (el.tagName === "img" && typeof el.properties.src === "string") {
        const src = el.properties.src;
        if (src.startsWith("images/")) el.properties.src = `/docs/${src}`;
        el.properties.loading = "lazy";
      }
      if (el.tagName === "table") {
        // Wrap nothing here; the wrapper is added in CSS via display:block overflow on small screens.
        el.properties.className = ["doc-table"];
      }
    });
  };
}

function collectHeadings(into: Heading[]) {
  return () => (tree: Root) => {
    visit(tree, "element", (el: Element) => {
      if (el.tagName === "h2" && typeof el.properties.id === "string")
        into.push({ id: el.properties.id, text: hastToString(el) });
    });
  };
}

export async function renderDoc(slug: string) {
  const meta = allDocs().find((d) => d.slug === slug);
  if (!meta) return undefined;
  const { content } = matter(readFileSync(join(DIR, meta.file), "utf8"));
  // The page draws its own title from the frontmatter, so the file's leading heading is dropped.
  const body = content.replace(/^\s*# .*\n/, "");
  const headings: Heading[] = [];

  const html = String(
    await unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkRehype)
      .use(rehypeSlug)
      .use(rewriteLinks)
      .use(collectHeadings(headings))
      .use(rehypePrettyCode, {
        theme: { light: "github-light", dark: "github-dark-dimmed" },
        keepBackground: false,
        defaultLang: "plaintext",
      })
      .use(rehypeStringify)
      .process(body),
  );

  const docs = allDocs();
  const flat = groups().flatMap((g) => g.docs);
  const i = flat.findIndex((d) => d.slug === slug);
  return {
    meta,
    html,
    headings,
    prev: i > 0 ? flat[i - 1] : undefined,
    next: i >= 0 && i < flat.length - 1 ? flat[i + 1] : undefined,
    editUrl: `${BLOB}/docs/${meta.file}`,
    count: docs.length,
  };
}
