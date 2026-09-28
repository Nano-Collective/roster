import { Reveal } from "./Reveal";
import { Section, SectionHead, Soft } from "./Section";

const cmds = [
  ["npx @nanocollective/roster", "Set up, or join, an org in a browser"],
  ["roster init --org your-org", "Ops repo, org layer, merge base"],
  ["roster hire cto", "Repo, workflows, labels, peers"],
  ["roster app cto", "Their GitHub App, install pre-selected"],
  ["roster credential", "The agent's credential, once for the org"],
  ["roster run cto", "One run, followed to the end"],
  ["roster doctor", "Is any of this actually wired up"],
  ["roster portal", "Read every brain, locally"],
  ["roster upgrade", "Framework changes, your edits kept"],
];

export function Commands() {
  return (
    <Section tone="grey">
      <div className="grid grid-cols-1 items-center gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <SectionHead
          label="The CLI"
          title={
            <>
              Browser or terminal. <Soft>Same files.</Soft>
            </>
          }
          lede="Everything the portal does is also a command, doing the same work on the same files. The portal is the shorter road, not the only one."
        />
        <Reveal delay={80}>
          <div className="window">
            <div className="flex h-10 items-center gap-2 border-b border-line px-4">
              <span className="size-3 rounded-full bg-[#ff5f57]" />
              <span className="size-3 rounded-full bg-[#febc2e]" />
              <span className="size-3 rounded-full bg-[#28c840]" />
              <span className="mx-auto text-[12px] font-medium text-fg-2">Terminal</span>
              <span className="w-[52px]" />
            </div>
            <div className="py-2">
              {cmds.map(([c, d]) => (
                <div
                  key={c}
                  className="flex flex-col gap-0.5 px-5 py-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
                >
                  <span className="whitespace-nowrap font-mono text-[13px]">{c}</span>
                  <span className="text-[13px] text-fg-2">{d}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-line px-5 py-3 text-[13px] text-fg-2">
              Nothing changes anything without <span className="font-mono text-fg">--apply</span>.
            </div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
