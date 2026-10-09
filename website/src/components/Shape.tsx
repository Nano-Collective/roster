import { List, Row } from "./List";
import { Reveal } from "./Reveal";
import { Section, SectionHead, Soft } from "./Section";

export function Shape() {
  return (
    <Section id="how" tone="grey">
      <SectionHead
        label="How it works"
        title={
          <>
            Everything they know is a file. <Soft>In a GitHub repo you own.</Soft>
          </>
        }
        lede="One shared repo holds what the business is and how it runs. Each staff member gets their own private repo with their job description, memory and schedule. Change a file and you change how they work."
      />

      <div className="mt-14 grid grid-cols-1 gap-8 lg:grid-cols-2">
        <Reveal>
          <div className="px-1 pb-3">
            <div className="text-[17px] font-semibold tracking-[-0.02em]">your-org/roster-ops</div>
            <div className="text-[14px] text-fg-2">The org layer. Change it once, everyone inherits it.</div>
          </div>
          <List>
            <Row strong left="org/business.md" right="What the business is" />
            <Row strong left="org/operating.md" right="What they can do without asking" />
            <Row strong left="org/voice.md" right="House style" />
            <Row strong left="org/guardrails.md" right="The non-negotiables" />
            <Row strong left="org/priorities.md" right="What matters now, read by everyone" />
            <Row left="prompts/" right="Composable run kinds" />
            <Row left="compose.mjs" right="Builds the prompt at run time" />
            <Row left="workflows/session.yaml" right="The reusable session" />
          </List>
        </Reveal>

        <Reveal delay={80}>
          <div className="px-1 pb-3">
            <div className="text-[17px] font-semibold tracking-[-0.02em]">your-org/cto</div>
            <div className="text-[14px] text-fg-2">One brain per staff member. This one is @cto.</div>
          </div>
          <List>
            <Row strong left="CHARTER.md" right="Their job description. Written by you." />
            <Row strong left="staff.yaml" right="Handle, schedule, identities, peers" />
            <Row strong left="memory/INDEX.md" right="One line per thing they have learned" />
            <Row left="memory/notes/" right="The argument behind a fact" />
            <Row left="log/decisions.md" right="Why things were decided" />
            <Row left=".github/workflows/" right="Three callers, about 40 lines each" />
          </List>
        </Reveal>
      </div>

      <Reveal delay={120}>
        <p className="mt-10 text-center text-[14px] text-fg-2">
          The Roster package itself is{" "}
          <span className="font-medium text-fg">never a runtime dependency</span> of your org. A
          run at 07:00 does not depend on npm.
        </p>
      </Reveal>
    </Section>
  );
}
