import { Reveal } from "./Reveal";
import { Section, SectionHead, Soft } from "./Section";

const steps = [
  {
    time: "07:00",
    title: "The schedule wakes them",
    body: "A GitHub Actions cron calls the session in your ops repo. No server of ours in the path.",
  },
  {
    time: "07:00",
    title: "They boot from memory",
    body: "Org layer, charter and run kind, composed. Then memory/INDEX.md, one line per fact.",
  },
  {
    time: "07:04",
    title: "They do the work",
    body: "Edit, commit, open pull requests, file asks with a peer. As their own GitHub App, never as you.",
  },
  {
    time: "07:23",
    title: "They hand off",
    body: "Finished work waits for you to merge. Decisions wait in your Inbox. Memory is pruned.",
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
        lede="A session boots, works and hands off in 11 to 55 minutes. Everything it did is a commit, a comment or a pull request you can read."
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
            <span className="font-medium text-fg">@mention wakes them.</span> Name a staff member in
            a comment on their tracker and it&apos;s a task, not a session: focused, on a shorter
            ceiling, answered on the thread.
          </p>
        </div>
      </Reveal>
    </Section>
  );
}
