"use client";

import { SideNav, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { TextInput } from "@astryxdesign/core/TextInput";
import { usePathname } from "next/navigation";
import { useState } from "react";

type Item = { slug: string; title: string; description: string };
type Group = { title: string; docs: Item[] };

const hrefOf = (slug: string) => (slug ? `/docs/${slug}/` : "/docs/");

/** The docs' contents: Astryx's SideNav, one section per group in docs/README.md, with a filter. */
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
    // The column it sits in is already sized and scrolls, so the nav takes its width and height.
    <SideNav
      style={{ width: "100%", height: "auto", background: "transparent" }}
      topContent={
        <div className="mb-2">
          <TextInput
            type="search"
            label="Search the docs"
            isLabelHidden
            placeholder="Search"
            size="sm"
            value={q}
            onChange={setQ}
          />
        </div>
      }
    >
      {shown.map((g) => (
        <SideNavSection key={g.title} title={g.title}>
          {g.docs.map((d) => {
            const href = hrefOf(d.slug);
            const active = path === href || path === href.replace(/\/$/, "");
            return <SideNavItem key={d.slug} label={d.title} href={href} isSelected={active} />;
          })}
        </SideNavSection>
      ))}
      {!shown.length && <p className="px-2.5 text-[13px] text-fg-3">Nothing matches.</p>}
    </SideNav>
  );
}
