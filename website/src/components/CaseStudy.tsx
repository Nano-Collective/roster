import { Reveal } from "./Reveal";
import { Section, SectionHead, Soft } from "./Section";

const stats = [
  { n: "475", l: "profiles created" },
  { n: "91", l: "accounts" },
  { n: "£0", l: "spent on marketing" },
];

export function CaseStudy() {
  return (
    <Section id="case-study" tone="grey">
      <SectionHead
        label="Case study"
        title={
          <>
            Pip, two months in. <Soft>Run by a CTO and a CMO on Roster.</Soft>
          </>
        }
        lede="A free poker web app. Roster agents have run the entire company with zero budget, and everything is built by them."
      />
      <Reveal delay={80}>
        <a
          href="/case-study/pip/"
          className="card group mt-12 flex flex-col gap-8 p-7 transition hover:shadow-[var(--shadow-lg)] sm:p-10 md:flex-row md:items-end md:justify-between"
        >
          <div className="grid grid-cols-3 gap-6 sm:gap-12">
            {stats.map((s) => (
              <div key={s.l}>
                <div className="text-[36px] font-semibold leading-none tracking-[-0.04em] tabular-nums sm:text-[56px]">
                  {s.n}
                </div>
                <div className="mt-2 text-[13px] text-fg-2 sm:text-[15px]">{s.l}</div>
              </div>
            ))}
          </div>
          <span className="text-[15px] font-medium text-blue">
            Read the case study <span className="inline-block transition group-hover:translate-x-0.5">›</span>
          </span>
        </a>
      </Reveal>
    </Section>
  );
}
