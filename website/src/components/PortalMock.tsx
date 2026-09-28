import { Mark } from "./Logo";

const nav = [
  { label: "Inbox", n: "3" },
  { label: "Pending work", n: "1" },
  { label: "Org" },
  { label: "Staff" },
  { label: "Docs" },
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

export function PortalMock() {
  return (
    <div className="window text-left">
      <div className="flex min-h-[460px]">
        {/* sidebar, Finder-style */}
        <aside className="hidden w-[220px] shrink-0 border-r border-line bg-bg-2 px-3 pb-4 pt-3.5 sm:block">
          <div className="flex gap-2 pb-5 pl-1">
            <span className="size-3 rounded-full bg-[#ff5f57]" />
            <span className="size-3 rounded-full bg-[#febc2e]" />
            <span className="size-3 rounded-full bg-[#28c840]" />
          </div>
          <div className="flex items-center gap-2 px-2 pb-4">
            <Mark size={20} />
            <div className="leading-tight">
              <div className="text-[13px] font-semibold">Roster</div>
              <div className="text-[11px] text-fg-2">playpip · 2 staff</div>
            </div>
          </div>
          <div className="space-y-px">
            {nav.map((i) => (
              <div
                key={i.label}
                className="flex items-center justify-between rounded-md px-2 py-[5px] text-[13px]"
              >
                {i.label}
                {i.n && <span className="text-[12px] tabular-nums text-fg-2">{i.n}</span>}
              </div>
            ))}
          </div>
          <div className="mt-5 px-2 pb-1 text-[11px] font-semibold text-fg-3">Staff</div>
          <div className="flex items-center justify-between gap-2 rounded-md px-2 py-[5px] text-[13px]">
            <span className="truncate">Chief Technology Officer</span>
            <span className="font-mono text-[11px] text-fg-3">cto</span>
          </div>
          <div className="space-y-px pl-3">
            {["Brain", "Prompt", "Graph", "What changed", "Health"].map((s, i) => (
              <div
                key={s}
                className={`rounded-md px-2 py-[4px] text-[12.5px] ${
                  i === 0 ? "bg-fill-2 font-medium text-fg" : "text-fg-2"
                }`}
              >
                {s}
              </div>
            ))}
          </div>
          <div className="mt-px flex items-center justify-between gap-2 rounded-md px-2 py-[5px] text-[13px]">
            <span className="truncate">Chief Marketing Officer</span>
            <span className="font-mono text-[11px] text-fg-3">cmo</span>
          </div>
        </aside>

        {/* main */}
        <div className="min-w-0 flex-1 bg-surface p-6 sm:p-8">
          <div className="text-[20px] font-semibold tracking-[-0.02em]">Brain</div>
          <div className="mt-0.5 text-[13px] text-fg-2">
            Chief Technology Officer · 142 facts in 8 sections
          </div>
          <div className="mt-5 flex h-8 items-center rounded-lg bg-fill px-3 text-[13px] text-fg-3">
            Search facts and files
          </div>
          {facts.map((s) => (
            <div key={s.section} className="mt-6">
              <div className="px-1 pb-2 text-[12px] font-semibold text-fg-2">{s.section}</div>
              <div className="overflow-hidden rounded-xl bg-bg-2">
                {s.items.map((f) => (
                  <div key={f.id} className="border-b border-line px-4 py-3 last:border-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11.5px] text-fg-2">{f.id}</span>
                      {f.tag && (
                        <span className="rounded-full bg-accent-soft px-2 py-px text-[10.5px] font-medium text-accent">
                          {f.tag}
                        </span>
                      )}
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
