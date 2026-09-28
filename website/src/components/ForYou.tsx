import { doc } from "./links";
import { Reveal } from "./Reveal";
import { Section, SectionHead, Soft } from "./Section";

const cols = [
  {
    h: "Who it's for",
    items: [
      "A solo founder, or a small team",
      "Comfortable with GitHub: issues, pull requests, Actions",
      "One person who reads what the staff hand off, and merges it",
    ],
  },
  {
    h: "What you need",
    items: ["gh, signed in", "A GitHub organisation", "A credential for a coding agent"],
  },
  {
    h: "Your first hire",
    items: [
      "About two hours, most of it writing the business and the charter",
      "Every repo, file and label listed before it exists",
      "Doctor says what is proven, and what is not yet",
    ],
  },
];

export function ForYou() {
  return (
    <Section id="for-you" tone="grey">
      <SectionHead
        label="Is it for you"
        title={
          <>
            One person, a lot to run. <Soft>And GitHub already open.</Soft>
          </>
        }
        lede="Roster is for people who would rather read a pull request than a dashboard. You stay the one who decides; the staff do the work in between."
      />

      <div className="mt-14 grid gap-px overflow-hidden rounded-2xl bg-line md:grid-cols-3">
        {cols.map((c, i) => (
          <Reveal key={c.h} delay={i * 70} className="bg-surface">
            <div className="h-full p-6 sm:p-7">
              <div className="text-[13px] font-semibold text-accent">{c.h}</div>
              <ul className="mt-3 space-y-2.5">
                {c.items.map((item) => (
                  <li key={item} className="text-[15px] leading-[1.45] tracking-[-0.01em]">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal delay={100}>
        <div className="mt-4 flex flex-col gap-1 rounded-2xl bg-surface px-6 py-5 sm:flex-row sm:items-baseline sm:gap-6">
          <div className="shrink-0 text-[13px] font-semibold text-blue">Running cost</div>
          <p className="text-[14px] leading-[1.55] text-fg-2">
            <span className="font-medium text-fg">The agents themselves.</span> Pip&apos;s staff run on
            a Claude subscription, through a Claude Code token, so the cost is a flat subscription
            rather than spend per token.{" "}
            <a href={doc("cost")} className="link">
              More on cost
            </a>
          </p>
        </div>
      </Reveal>
    </Section>
  );
}
