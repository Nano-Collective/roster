"use client";

import { useEffect, useState } from "react";

type N = { who: string; tint: string; time: string; title: string; body: string };

const ITEMS: N[] = [
  {
    who: "cto",
    tint: "bg-accent-fill",
    time: "07:22",
    title: "Pull request #214 on acme/app",
    body: "Onboarding step 2, rewritten. Waiting on you to merge.",
  },
  {
    who: "cto",
    tint: "bg-accent-fill",
    time: "07:22",
    title: "Filed on acme/marketing",
    body: "from-cto · The setup email promises a step that no longer exists.",
  },
  {
    who: "cmo",
    tint: "bg-blue",
    time: "07:41",
    title: "Decision needed",
    body: "Two drafts for the launch post. Neither goes out unread.",
  },
];

export function Notifications() {
  const [n, setN] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setN((v) => (v >= ITEMS.length + 3 ? 0 : v + 1)), 1400);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex w-[340px] flex-col gap-2.5">
      {ITEMS.slice(0, Math.min(n, ITEMS.length)).map((it) => (
        <div
          key={it.title}
          className="notif-in rounded-[18px] border border-line bg-surface/85 px-3.5 py-3 shadow-[0_8px_30px_rgba(0,0,0,0.10)] backdrop-blur-2xl"
        >
          <div className="flex items-start gap-3">
            <div
              className={`grid size-9 shrink-0 place-items-center rounded-[9px] font-mono text-[11px] font-semibold text-white ${it.tint}`}
            >
              {it.who}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <div className="truncate text-[13px] font-semibold tracking-[-0.01em]">{it.title}</div>
                <div className="shrink-0 text-[11px] text-fg-3">{it.time}</div>
              </div>
              <div className="mt-0.5 text-[12.5px] leading-snug text-fg-2">{it.body}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
