import type { CSSProperties } from "react";
import { Mark } from "./Logo";

/** Pip's chip, its app icon. */
export function PipChip({ size = 28 }: { size?: number }) {
  return (
    // biome-ignore lint/performance/noImgElement: static export, no image optimiser
    <img src="/pip/icon.png" alt="" width={size} height={size} className="rounded-[22%]" />
  );
}

/** Pip × Roster, side by side. Roster keeps its own green inside Pip's scope. */
export function PipLockup() {
  return (
    <span className="inline-flex items-center gap-2.5 text-[15px] font-semibold tracking-[-0.01em]">
      <PipChip size={28} />
      Pip
      <span className="font-normal text-fg-3">×</span>
      <span className="inline-flex" style={{ "--accent-fill": "#30d158" } as CSSProperties}>
        <Mark size={24} />
      </span>
      Roster
    </span>
  );
}

type Card = { rank: string; suit: string; red?: boolean } | "back";

/** A small fan of Pip's cards, dealt in once. Decoration only. */
export function PipCards({
  cards,
  width = 72,
  className = "",
}: {
  cards: Card[];
  width?: number;
  className?: string;
}) {
  const mid = (cards.length - 1) / 2;
  return (
    <div className={`flex ${className}`} aria-hidden="true">
      {cards.map((c, i) => {
        const tilt = (i - mid) * 7;
        const style = {
          "--w": `${width}px`,
          marginLeft: i === 0 ? 0 : -width * 0.38,
          transform: `rotate(${tilt}deg) translateY(${Math.abs(i - mid) * 6}px)`,
          animationDelay: `${200 + i * 90}ms`,
        } as CSSProperties;
        return c === "back" ? (
          <div key={`back-${i}`} className="pip-card pip-deal" data-back="" style={style} />
        ) : (
          <div
            key={c.rank + c.suit}
            className="pip-card pip-deal"
            data-red={c.red ? "" : undefined}
            style={style}
          >
            <span>{c.rank}</span>
            <span className="suit">{c.suit}</span>
          </div>
        );
      })}
    </div>
  );
}
