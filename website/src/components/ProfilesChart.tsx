"use client";

import { useState } from "react";
import { readings } from "./pipReadings";

const DAYS = 70;
const MAX = 520;
const ticksY = [0, 100, 200, 300, 400, 500];
const ticksX = [readings[0], readings[3], readings[6], readings[10]];
const last = readings[readings.length - 1];

const x = (day: number) => (day / DAYS) * 100;
const y = (total: number) => 100 - (total / MAX) * 100;

export function ProfilesChart() {
  const [active, setActive] = useState<number | null>(null);
  const line = readings.map((r) => `${x(r.day)},${y(r.total)}`).join(" ");
  const area = `0,100 ${line} 100,100`;
  const a = active === null ? null : readings[active];

  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const day = ((e.clientX - box.left) / box.width) * DAYS;
    let best = 0;
    readings.forEach((r, i) => {
      if (Math.abs(r.day - day) < Math.abs(readings[best].day - day)) best = i;
    });
    setActive(best);
  }

  return (
    <figure className="m-0">
      <div className="relative ml-9 mr-2 h-[240px] sm:ml-10 sm:h-[340px]">
        {/* gridlines and their labels */}
        {ticksY.map((t) => (
          <div key={t} className="absolute inset-x-0 border-t border-line" style={{ top: `${y(t)}%` }}>
            <span className="absolute -left-9 -translate-y-1/2 text-right font-mono text-[11px] tabular-nums text-fg-3 sm:-left-10 w-7 sm:w-8">
              {t}
            </span>
          </div>
        ))}

        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 size-full overflow-visible"
          aria-hidden="true"
        >
          <polygon points={area} fill="var(--accent-soft)" />
          <polyline
            points={line}
            fill="none"
            stroke="var(--accent-fill)"
            strokeWidth={2}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
          {a && (
            <line
              x1={x(a.day)}
              x2={x(a.day)}
              y1={0}
              y2={100}
              stroke="var(--line-2)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {readings.map((r, i) => (
          <span
            key={r.date}
            className={`absolute size-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-bg transition-transform ${
              i === readings.length - 1 ? "bg-accent" : "bg-accent-fill"
            } ${active === i ? "scale-150" : ""}`}
            style={{ left: `${x(r.day)}%`, top: `${y(r.total)}%` }}
          />
        ))}

        {/* the headline point is labelled; the rest live in the tooltip */}
        <div
          className="absolute -translate-x-full -translate-y-[130%] pr-1 text-right"
          style={{ left: `${x(DAYS)}%`, top: `${y(last.total)}%` }}
        >
          <span className="text-[13px] font-semibold tabular-nums">{last.total}</span>
        </div>

        {/* hover and touch layer, larger than any mark */}
        <div
          className="absolute -inset-y-2 inset-x-0 cursor-crosshair touch-none"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setActive(null)}
        />

        {a && (
          <div
            className={`pointer-events-none absolute z-10 w-[168px] rounded-xl bg-surface px-3 py-2 text-[12px] shadow-[var(--shadow-lg)] ${
              a.total > 300 ? "" : "-translate-y-full"
            }`}
            style={{
              left: `clamp(0px, calc(${x(a.day)}% - 84px), calc(100% - 168px))`,
              top: `calc(${y(a.total)}% ${a.total > 300 ? "+ 16px" : "- 16px"})`,
            }}
          >
            <div className="text-fg-2">{a.day > 0 ? `Week to ${a.date}` : a.date}</div>
            <div className="text-[15px] font-semibold tabular-nums">{a.total} profiles</div>
            <div className="mt-0.5 leading-snug text-fg-2">
              {a.day > 0 && <span className="tabular-nums">+{a.week} that week. </span>}
              {a.note}
            </div>
          </div>
        )}
      </div>

      <div className="relative ml-9 mr-2 mt-2 h-4 sm:ml-10">
        {ticksX.map((r, i) => (
          <span
            key={r.date}
            className={`absolute whitespace-nowrap text-[11px] text-fg-3 ${
              i === 0 ? "" : i === ticksX.length - 1 ? "-translate-x-full" : "-translate-x-1/2"
            }`}
            style={{ left: `${x(r.day)}%` }}
          >
            {r.date}
          </span>
        ))}
      </div>

      <figcaption className="sr-only">
        Profiles created on Pip, week by week: about two dozen a week from launch on 23 July to
        mid-August, then 42 to 83 a week, reaching 475 by 27 September.
      </figcaption>
    </figure>
  );
}
