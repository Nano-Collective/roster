import { Badge } from "@astryxdesign/core/Badge";
import { SideNav, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Mark } from "./Logo";

/* The portal's own icons (Lucide, as templates/portal/js/icons.js has them), so the picture
   matches the thing. */
const ICONS: Record<string, string> = {
  inbox:
    '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  issue: '<circle cx="12" cy="12" r="1"/><circle cx="12" cy="12" r="10"/>',
  play: '<path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/>',
  file: '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/>',
  person: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  docs: '<path d="M12 5v16"/><path d="M20 19a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-4a5 5 0 0 0-4 2 5 5 0 0 0-4-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4a5 5 0 0 1 4 2 5 5 0 0 1 4-2z"/>',
  code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
  megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
};
const Icon = ({ name }: { name: string }) => (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    // biome-ignore lint/security/noDangerouslySetInnerHtml: fixed icon paths from this file
    dangerouslySetInnerHTML={{ __html: ICONS[name] }}
  />
);
const Count = ({ n }: { n: string }) => <span className="text-[12px] tabular-nums text-fg-2">{n}</span>;

const nav = [
  { label: "Home", icon: "inbox", n: "3" },
  { label: "Trackers", icon: "issue", n: "8" },
  { label: "Runs", icon: "play" },
  { label: "Org", icon: "file" },
  { label: "Staff", icon: "person" },
  { label: "Docs", icon: "docs" },
];

// Real facts from Pip's CTO's memory/INDEX.md, lightly shortened.
const facts: { section: string; items: { id: string; tag?: string; fact: string; so: string }[] }[] = [
  {
    section: "The gate, and the ways it lies",
    items: [
      {
        id: "ui-needs-will",
        fact: "No runner has a browser or a device.",
        so: "say plainly in the PR body what the gate did not cover. Never imply green covered UI.",
      },
    ],
  },
  {
    section: "The engine and the AI",
    items: [
      {
        id: "the-odds-band-is-honest",
        tag: "measured",
        fact: "The calculator's error bar is the width it claims, from 500 to 20,000 iterations (2026-09-14).",
        so: "it can be defended in public. Do not re-derive it; re-run the script.",
      },
      {
        id: "import-the-subject",
        fact: "A test that retyped three rungs out of venues.ts kept asserting old numbers, green.",
        so: "import the subject, never retype it.",
      },
    ],
  },
];

/**
 * The portal, drawn: its sidebar is Astryx's SideNav, as the real one is. A picture, so `inert`
 * keeps its controls out of the tab order and away from screen readers.
 */
export function PortalMock() {
  return (
    <div className="window text-left" inert>
      <div className="flex min-h-[460px]">
        <aside className="hidden w-[232px] shrink-0 border-r border-line bg-bg-2 sm:block">
          <div className="flex gap-2 px-4 pb-4 pt-3.5">
            <span className="size-3 rounded-full bg-[#ff5f57]" />
            <span className="size-3 rounded-full bg-[#febc2e]" />
            <span className="size-3 rounded-full bg-[#28c840]" />
          </div>
          <SideNav
            style={{ width: "100%", height: "auto", background: "transparent" }}
            header={
              <div className="flex items-center gap-2 px-2 pb-3">
                <Mark size={20} />
                <div className="leading-tight">
                  <div className="text-[13px] font-semibold">Roster</div>
                  <div className="text-[11px] text-fg-2">playpip · 2 staff</div>
                </div>
              </div>
            }
          >
            <SideNavSection title="Portal" isHeaderHidden>
              {nav.map((i) => (
                <SideNavItem
                  key={i.label}
                  label={i.label}
                  icon={<Icon name={i.icon} />}
                  endContent={i.n ? <Count n={i.n} /> : undefined}
                  isSelected={false}
                />
              ))}
            </SideNavSection>
            <SideNavSection title="Staff">
              <SideNavItem
                label="Chief Technology Officer"
                icon={<Icon name="code" />}
                endContent={<span className="font-mono text-[11px] text-fg-3">cto</span>}
              />
              <div className="pl-4">
                {["Brain", "Prompt", "Graph", "What changed", "Health"].map((label, i) => (
                  <SideNavItem key={label} label={label} size="sm" isSelected={i === 0} />
                ))}
              </div>
              <SideNavItem
                label="Chief Marketing Officer"
                icon={<Icon name="megaphone" />}
                endContent={<span className="font-mono text-[11px] text-fg-3">cmo</span>}
              />
            </SideNavSection>
          </SideNav>
        </aside>

        {/* main */}
        <div className="min-w-0 flex-1 bg-surface p-6 sm:p-8">
          <div className="text-[20px] font-semibold tracking-[-0.02em]">Brain</div>
          <div className="mt-0.5 text-[13px] text-fg-2">
            Chief Technology Officer · 142 facts in 8 sections
          </div>
          <div className="mt-5">
            <TextInput
              label="Search facts and files"
              isLabelHidden
              placeholder="Search facts and files"
              value=""
              size="sm"
              width="100%"
              isReadOnly
            />
          </div>
          {facts.map((s) => (
            <div key={s.section} className="mt-6">
              <div className="px-1 pb-2 text-[12px] font-semibold text-fg-2">{s.section}</div>
              <div className="overflow-hidden rounded-xl bg-bg-2">
                {s.items.map((f) => (
                  <div key={f.id} className="border-b border-line px-4 py-3 last:border-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11.5px] text-fg-2">{f.id}</span>
                      {f.tag && <Badge label={f.tag} variant="success" />}
                    </div>
                    <div className="mt-1 text-[14px] tracking-[-0.01em]">{f.fact}</div>
                    <div className="mt-0.5 text-[12.5px] text-fg-2">So: {f.so}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
