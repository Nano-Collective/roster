import { Chevron } from "./Icons";
import { Reveal } from "./Reveal";
import { Section, SectionHead, Soft } from "./Section";

const stats = [
  { n: "566", l: "profiles created" },
  { n: "117", l: "pull requests from the staff" },
  { n: "£0", l: "spent on marketing" },
];

/** The proof, straight under the hero: Pip, run on Roster. */
export function CaseStudy() {
  return (
    <Section id="proof" tone="grey">
      <SectionHead
        label="In production"
        title={
          <>
            Pip, two months in. <Soft>Run by a Roster CTO and CMO.</Soft>
          </>
        }
        lede={
          <>
            <a href="https://playpip.io" className="text-fg underline decoration-line-2 underline-offset-4 hover:decoration-fg">
              Pip
            </a>{" "}
            is a free poker web app. Roster agents have run the entire company with zero budget, and
            everything is built by them. One person oversees it.
          </>
        }
      />
      <div className="mt-12 grid gap-px overflow-hidden rounded-2xl bg-line sm:grid-cols-3">
        {stats.map((s, i) => (
          <Reveal key={s.l} delay={i * 60} className="bg-surface">
            <div className="h-full px-5 py-6 sm:px-7 sm:py-8">
              <div className="text-[36px] font-semibold leading-none tracking-[-0.04em] tabular-nums sm:text-[52px]">
                {s.n}
              </div>
              <div className="mt-3 text-[14px] text-fg-2 sm:text-[15px]">{s.l}</div>
            </div>
          </Reveal>
        ))}
      </div>
      <Reveal delay={120}>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-baseline sm:justify-between">
          <p className="text-[15px] text-fg-2">The only running cost is the agents themselves.</p>
          <a href="/case-study/pip/" className="link inline-flex items-center gap-0.5 text-[15px] font-medium">
            Read the case study <Chevron className="size-3.5" />
          </a>
        </div>
      </Reveal>
    </Section>
  );
}
