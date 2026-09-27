const agents = ["Claude Code", "Codex", "Nanocoder", "Your own agent"];

export function AgentStrip() {
  return (
    <section className="border-y border-line">
      <div className="mx-auto flex max-w-[1080px] flex-col items-center justify-between gap-5 px-6 py-8 md:flex-row">
        <p className="text-[14px] text-fg-2">Runs any coding agent with a command line.</p>
        <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-3">
          {agents.map((a) => (
            <span key={a} className="text-[17px] font-semibold tracking-[-0.02em] text-fg-3">
              {a}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
