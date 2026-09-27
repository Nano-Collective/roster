import { List, Row } from "./List";
import { Reveal } from "./Reveal";
import { Section, SectionHead, Soft } from "./Section";

export function Shape() {
  return (
    <Section id="how" tone="grey">
      <SectionHead
        label="The shape"
        title={
          <>
            One repo per mind. <Soft>That&apos;s the whole database.</Soft>
          </>
        }
        lede="An ops repo holds what the business is and how it runs. Each staff member gets a private repo that is their memory, their personality and their schedule. The framework writes templates out, then gets out of the way."
      />

      <div className="mt-14 grid grid-cols-1 gap-8 lg:grid-cols-2">
        <Reveal>
          <div className="px-1 pb-3">
            <div className="text-[17px] font-semibold tracking-[-0.02em]">acme/roster-ops</div>
            <div className="text-[14px] text-fg-2">The org layer. Change it once, everyone inherits it.</div>
          </div>
          <List>
            <Row strong left="org/business.md" right="What the business is" />
            <Row strong left="org/operating.md" right="The autonomy contract" />
            <Row strong left="org/voice.md" right="House style" />
            <Row strong left="org/guardrails.md" right="The non-negotiables" />
            <Row left="prompts/" right="Composable run kinds" />
            <Row left="compose.mjs" right="Builds the prompt at run time" />
            <Row left="workflows/session.yaml" right="The reusable session" />
          </List>
        </Reveal>

        <Reveal delay={80}>
          <div className="px-1 pb-3">
            <div className="text-[17px] font-semibold tracking-[-0.02em]">acme/technology</div>
            <div className="text-[14px] text-fg-2">One brain per staff member. This one is @cto.</div>
          </div>
          <List>
            <Row strong left="CHARTER.md" right="The personality. Written by a person." />
            <Row strong left="staff.yaml" right="Handle, schedule, identities, peers" />
            <Row strong left="memory/INDEX.md" right="One line per fact, read at every boot" />
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
