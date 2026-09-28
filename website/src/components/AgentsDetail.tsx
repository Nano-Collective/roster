import { Reveal } from "./Reveal";
import { Section, SectionHead, Soft } from "./Section";

const K = ({ children }: { children: React.ReactNode }) => <span className="text-purple">{children}</span>;
const V = ({ children }: { children: React.ReactNode }) => <span className="text-blue">{children}</span>;
const C = ({ children }: { children: React.ReactNode }) => <span className="text-fg-3">{children}</span>;

export function AgentsDetail() {
  return (
    <Section id="agents">
      <div className="grid grid-cols-1 items-center gap-14 lg:grid-cols-2">
        <div>
          <SectionHead
            label="Any coding agent"
            title={
              <>
                Bring the agent. <Soft>Keep the org.</Soft>
              </>
            }
            lede="Roster composes a prompt and hands it over. A runner is three facts: how to install it, how to run it, and which secret holds its credential. Presets ship for Claude Code, Codex and Nanocoder."
          />
          <Reveal delay={80}>
            <div className="mt-8 flex w-fit rounded-[10px] bg-fill-2 p-[3px] text-[13px] font-medium">
              <span className="px-4 py-1 text-fg-2">read-only</span>
              <span className="px-4 py-1 text-fg-2">workspace</span>
              <span className="rounded-[8px] bg-surface px-4 py-1 shadow-[0_1px_3px_rgba(0,0,0,0.12)]">full</span>
            </div>
            <p className="mt-3 text-[14px] text-fg-2">
              One word for how much freedom it gets. Each agent hears it in its own flags.
            </p>
          </Reveal>
        </div>

        <Reveal delay={100}>
          <div className="overflow-hidden rounded-2xl bg-bg-2">
            <div className="border-b border-line px-5 py-3 text-[12.5px] font-medium text-fg-2">org.yaml</div>
            <pre className="overflow-x-auto px-5 py-5 font-mono text-[13px] leading-[1.85]">
              <code>
                <K>org</K>: your-org{"\n"}
                <K>agent</K>:{"\n"}
                {"  "}
                <K>id</K>: <V>codex</V>
                {"\n"}
                {"  "}
                <K>permissions</K>: <V>full</V>
                {"\n\n"}
                <C># or anything with a command line</C>
                {"\n"}
                <K>agent</K>:{"\n"}
                {"  "}
                <K>id</K>: <V>my-agent</V>
                {"\n"}
                {"  "}
                <K>install</K>: cargo install my-agent{"\n"}
                {"  "}
                <K>run</K>: my-agent --headless &lt; &quot;$AGENT_PROMPT_FILE&quot;{"\n"}
                {"  "}
                <K>token_env</K>: MY_AGENT_TOKEN
              </code>
            </pre>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
