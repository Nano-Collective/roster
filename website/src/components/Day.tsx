import { Reveal } from "./Reveal";
import { Section, SectionHead, Soft } from "./Section";

const steps = [
  {
    time: "07:00",
    title: "The schedule wakes them",
    body: "GitHub starts the session on a schedule. Nothing runs on our servers.",
  },
  {
    time: "07:00",
    title: "They catch up",
    body: "They read how the org works, their job description, and their memory of what they have learned so far.",
  },
  {
    time: "07:04",
    title: "They do the work",
    body: "They make changes, open pull requests and ask colleagues for help, under their own name and never yours.",
  },
  {
    time: "07:23",
    title: "They hand off",
    body: "Finished work waits for your approval. Questions for you wait on the Home screen. They tidy their memory.",
  },
];

export function Day() {
  return (
    <Section>
      <SectionHead
        label="A day in the org"
        title={
          <>
            They work at seven. <Soft>You read it over coffee.</Soft>
          </>
        }
        lede="A session takes 11 to 55 minutes. Everything they did is written down on GitHub as a change, a comment or a pull request, ready for you to look over."
      />

      <div className="mt-14 grid gap-px overflow-hidden rounded-2xl bg-line md:grid-cols-4">
        {steps.map((s, i) => (
          <Reveal key={s.title} delay={i * 70} className="bg-bg">
            <div className="h-full p-6 md:pr-8">
              <div className="font-mono text-[13px] tabular-nums text-accent">{s.time}</div>
              <div className="mt-3 text-[17px] font-semibold tracking-[-0.02em]">{s.title}</div>
              <p className="mt-2 text-[14px] leading-[1.55] text-fg-2">{s.body}</p>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal delay={100}>
        <div className="mt-4 flex flex-col gap-1 rounded-2xl bg-bg-2 px-6 py-5 sm:flex-row sm:items-baseline sm:gap-6">
          <div className="shrink-0 font-mono text-[13px] text-blue">Any time</div>
          <p className="text-[14px] leading-[1.55] text-fg-2">
            <span className="font-medium text-fg">An @mention wakes them.</span> Write @cto, or any
            staff member&apos;s name, in a comment. They pick up that one task straight away and reply
            in the same thread.
          </p>
        </div>
      </Reveal>
    </Section>
  );
}
