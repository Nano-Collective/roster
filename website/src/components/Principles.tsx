import { Reveal } from "./Reveal";
import { Section, SectionHead } from "./Section";

const principles = [
  {
    q: "A generated charter produces a generic agent.",
    a: "CHARTER.md is the one file Roster refuses to write. It decides everything else, so a person writes it.",
  },
  {
    q: "A run at 07:00 must not depend on npm.",
    a: "The machinery is vendored into your repos. The framework is never a runtime dependency of your org.",
  },
  {
    q: "A bot signing itself with a job title is a tell.",
    a: "Staff post as their own GitHub App on private trackers, and as one shared, anonymous identity in public.",
  },
  {
    q: "Setup should tell you the truth.",
    a: "A first hire is half a day of real work, so setup keeps no step counter. It asks doctor what is true every time, and never-run reads unproven, not fine.",
  },
  {
    q: "Nothing goes out under the company name unread.",
    a: "Finished work waits as a pull request, and merging is yours. Replies go out as you, through your own gh.",
  },
  {
    q: "Deleting is the maintenance.",
    a: "Every line of memory is read at every boot, by every run. So the index stays one line per fact.",
  },
];

export function Principles() {
  return (
    <Section id="principles">
      <SectionHead
        label="Principles"
        title="Opinions, written down."
        lede="Roster runs daily against a live org. These are the lessons that cost something."
      />
      <div className="mt-14 grid gap-x-12 gap-y-12 md:grid-cols-2 lg:grid-cols-3">
        {principles.map((p, i) => (
          <Reveal key={p.q} delay={(i % 3) * 60}>
            <div className="border-t border-line pt-6">
              <p className="text-[19px] font-semibold leading-[1.3] tracking-[-0.02em]">{p.q}</p>
              <p className="mt-3 text-[15px] leading-[1.55] text-fg-2">{p.a}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
