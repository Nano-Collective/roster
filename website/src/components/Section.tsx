import type { ReactNode } from "react";
import { Reveal } from "./Reveal";

export function SectionHead({
  label,
  title,
  lede,
  center = false,
}: {
  label: string;
  title: ReactNode;
  lede?: ReactNode;
  center?: boolean;
}) {
  return (
    <Reveal className={center ? "mx-auto max-w-[720px] text-center" : "max-w-[680px]"}>
      <div className="label">{label}</div>
      <h2 className="mt-3 text-[34px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[48px]">
        {title}
      </h2>
      {lede && <p className="mt-5 text-[17px] leading-[1.55] text-fg-2 sm:text-[19px]">{lede}</p>}
    </Reveal>
  );
}

/** The second, quieter half of a two-tone headline. */
export function Soft({ children }: { children: ReactNode }) {
  return <span className="text-fg-3">{children}</span>;
}

export function Section({
  id,
  tone = "plain",
  children,
}: {
  id?: string;
  tone?: "plain" | "grey";
  children: ReactNode;
}) {
  return (
    <section id={id} className={`scroll-mt-14 ${tone === "grey" ? "bg-bg-2" : ""}`}>
      <div className="mx-auto max-w-[1080px] px-6 py-24 sm:py-32">{children}</div>
    </section>
  );
}
