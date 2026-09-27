import type { ReactNode } from "react";

/** An iOS grouped list: one rounded panel, hairlines between rows. */
export function List({ children }: { children: ReactNode }) {
  return <div className="overflow-hidden rounded-2xl bg-surface shadow-[var(--shadow)]">{children}</div>;
}

export function Row({ left, right, strong }: { left: ReactNode; right?: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-b border-line px-5 py-3 last:border-0">
      <span className={`font-mono text-[13px] ${strong ? "text-fg" : "text-fg-2"}`}>{left}</span>
      {right && <span className="text-right text-[13px] text-fg-2">{right}</span>}
    </div>
  );
}
