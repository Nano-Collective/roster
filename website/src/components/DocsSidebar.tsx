"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";

type Item = { slug: string; title: string; description: string };
type Group = { title: string; docs: Item[] };

const hrefOf = (slug: string) => (slug ? `/docs/${slug}/` : "/docs/");

export function DocsSidebar({ groups }: { groups: Group[] }) {
  const path = usePathname();
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();

  const shown = groups
    .map((g) => ({
      ...g,
      docs: g.docs.filter(
        (d) => !needle || `${d.title} ${d.description}`.toLowerCase().includes(needle),
      ),
    }))
    .filter((g) => g.docs.length);

  return (
    <nav aria-label="Documentation">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search"
        aria-label="Search the docs"
        className="mb-6 h-8 w-full rounded-lg bg-fill px-3 text-[13px] text-fg outline-none placeholder:text-fg-3 focus:ring-2 focus:ring-blue/40"
      />
      {shown.map((g) => (
        <div key={g.title} className="mb-6">
          <div className="px-2.5 pb-1.5 text-[12px] font-semibold text-fg-3">{g.title}</div>
          <ul className="space-y-px">
            {g.docs.map((d) => {
              const href = hrefOf(d.slug);
              const active = path === href || path === href.replace(/\/$/, "");
              return (
                <li key={d.slug}>
                  <a
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={`block rounded-md px-2.5 py-[5px] text-[13.5px] transition ${
                      active ? "bg-fill font-medium text-fg" : "text-fg-2 hover:text-fg"
                    }`}
                  >
                    {d.title}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {!shown.length && <p className="px-2.5 text-[13px] text-fg-3">Nothing matches.</p>}
    </nav>
  );
}
