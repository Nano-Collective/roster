import { Reveal } from "./Reveal";
import { Section, SectionHead, Soft } from "./Section";

const PR = (n: number) => `https://github.com/playpip/pip-web/pull/${n}`;

// Real pull requests from Pip's staff, lightly shortened. The public repo is playpip/pip-web.
const prs = [
  {
    n: 146,
    who: "cto",
    title: "Hold the odds calculator's error bar to the width it claims",
    checked:
      "A script checks the calculator's 95% band against an exact answer. 682 tests green, and three planted bugs caught.",
    not: "No UI. Nothing on the calculator page changed.",
  },
  {
    n: 124,
    who: "cto",
    title: "A buy-in taken on one device is no longer invisible to the other",
    checked:
      "11 new tests, one a two-device sequence asserting chips are conserved. Each key guard was watched failing before it was trusted.",
    not: "The wiring needs a browser. The pure rules are tested, and the wiring is read, not run.",
  },
  {
    n: 153,
    who: "cto",
    title: "The AI can bet the hands that are neither a bluff nor a value bet",
    checked: "Measured on identical seeds either side, 300 hands a venue, and six new tests.",
    not: "Whether the tables now feel right. No runner has a device. Sit at two tables and see.",
  },
];

export function Work() {
  return (
    <Section id="work">
      <SectionHead
        label="The work"
        title={
          <>
            Every change says what it checked. <Soft>And what it didn&apos;t.</Soft>
          </>
        }
        lede="Work arrives as a pull request you look over before it goes live. Three of Pip's, from its CTO, lightly shortened."
      />

      <div className="mt-14 grid gap-5 lg:grid-cols-3">
        {prs.map((p, i) => (
          <Reveal key={p.n} delay={i * 70}>
            <a
              href={PR(p.n)}
              className="card group flex h-full flex-col p-6 transition hover:shadow-[var(--shadow-lg)] sm:p-7"
            >
              <div className="flex items-center gap-2 font-mono text-[12px] text-fg-2">
                <span className="grid size-6 place-items-center rounded-[6px] bg-accent-fill text-[10px] font-semibold text-white">
                  {p.who}
                </span>
                playpip/pip-web #{p.n}
              </div>
              <h3 className="mt-4 text-[18px] font-semibold leading-[1.3] tracking-[-0.02em]">{p.title}</h3>
              <div className="mt-5 space-y-4 border-t border-line pt-5 text-[14px] leading-[1.55]">
                <div>
                  <div className="text-[12px] font-semibold text-accent">What it checked</div>
                  <p className="mt-1 text-fg-2">{p.checked}</p>
                </div>
                <div>
                  <div className="text-[12px] font-semibold text-orange">What it didn&apos;t check</div>
                  <p className="mt-1 text-fg-2">{p.not}</p>
                </div>
              </div>
              <span className="mt-auto pt-6 text-[14px] font-medium text-blue">
                Read the pull request <span className="inline-block transition group-hover:translate-x-0.5">›</span>
              </span>
            </a>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
