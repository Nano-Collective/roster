import { Reveal } from "./Reveal";
import { Section, SectionHead, Soft } from "./Section";

function Card({ title, body, children }: { title: string; body: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="card flex h-full flex-col p-7 sm:p-8">
      <h3 className="text-[21px] font-semibold tracking-[-0.025em]">{title}</h3>
      <p className="mt-2 text-[15px] leading-[1.55] text-fg-2">{body}</p>
      {children && <div className="mt-7 flex-1">{children}</div>}
    </div>
  );
}

function Composition() {
  const layers = ["org/operating.md", "org/guardrails.md", "org/voice.md", "org/business.md"];
  return (
    <div className="overflow-hidden rounded-xl bg-bg-2 font-mono text-[12.5px]">
      {layers.map((l) => (
        <div key={l} className="border-b border-line px-4 py-2.5 text-fg-2">
          {l}
        </div>
      ))}
      <div className="border-b border-line px-4 py-2.5 text-fg">cto/CHARTER.md</div>
      <div className="border-b border-line px-4 py-2.5 text-fg">prompts/daily.md</div>
      <div className="px-4 py-2.5 font-sans text-[13px] font-medium text-accent">
        = the prompt, composed at run time
      </div>
    </div>
  );
}

function Plan() {
  const rows: [string, string, string][] = [
    ["+", "your-org/cmo", "private repo"],
    ["+", "staff.yaml", "manifest"],
    ["+", "memory/INDEX.md", "empty memory"],
    ["+", "cmo-daily.yaml", "07:00 schedule"],
    ["~", "from-cto", "label on the peer"],
  ];
  return (
    <div className="overflow-hidden rounded-xl bg-bg-2">
      <div className="border-b border-line px-4 py-2.5 font-mono text-[12.5px] text-fg-2">roster hire cmo</div>
      {rows.map(([s, f, d]) => (
        <div key={f} className="flex items-baseline gap-3 border-b border-line px-4 py-2 last:border-0">
          <span className={`font-mono text-[12.5px] ${s === "+" ? "text-accent" : "text-blue"}`}>{s}</span>
          <span className="font-mono text-[12.5px]">{f}</span>
          <span className="ml-auto text-[12.5px] text-fg-2">{d}</span>
        </div>
      ))}
      <div className="bg-orange-fill/10 px-4 py-2.5 text-[12.5px] text-orange">
        Install the App yourself. GitHub asks a person to choose the repos.
      </div>
    </div>
  );
}

function Doctor() {
  const rows = [
    { s: "OK", c: "text-accent", t: "Callers reachable" },
    { s: "OK", c: "text-accent", t: "Agent credential on cto" },
    { s: "OK", c: "text-accent", t: "Branch protection on product repos" },
    { s: "Unproven", c: "text-orange", t: "cmo-daily has never run" },
    { s: "You", c: "text-blue", t: "Install cmo on your-org/app" },
  ];
  return (
    <div className="overflow-hidden rounded-xl bg-bg-2">
      {rows.map((r) => (
        <div key={r.t} className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-2.5 last:border-0">
          <span className="truncate text-[13px]">{r.t}</span>
          <span className={`shrink-0 text-[12.5px] font-medium ${r.c}`}>{r.s}</span>
        </div>
      ))}
    </div>
  );
}

const news: [string, string][] = [
  ["Runs", "Every run in the portal, with its outcome, duration and cost where known."],
  ["Alerts", "When a run, or any workflow, fails silently, you hear about it."],
  ["Shared priorities", "org/priorities.md, read by every staff member."],
  ["Memory budgets", "roster lint flags a memory that outgrows its budget."],
  ["Branch protection", "doctor checks your product repos have it."],
  ["Example charters", "A CTO, a CMO and Support, to start from."],
];

export function Features() {
  return (
    <Section tone="grey">
      <SectionHead
        label="Built to be trusted"
        title={
          <>
            Autonomy you can read. <Soft>And diff, and undo.</Soft>
          </>
        }
        lede="Every behaviour traces back to a file. When someone asks why it did that, the answer is a line in a repo you own."
      />

      <div className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-2">
        <Reveal>
          <Card
            title="Composable prompts"
            body="Org policy, the charter and the run kind, stacked. A role extends the org without forking it."
          >
            <Composition />
          </Card>
        </Reveal>
        <Reveal delay={70}>
          <Card
            title="The plan, then the apply"
            body={
              <>
                Nothing changes anything without <span className="font-mono text-[14px] text-fg">--apply</span>.
                Every file, repo and label is listed before it exists.
              </>
            }
          >
            <Plan />
          </Card>
        </Reveal>
        <Reveal>
          <Card
            title="Honest health"
            body="A workflow that has never run has proved nothing. So doctor says unproven, not fine."
          >
            <Doctor />
          </Card>
        </Reveal>
        <Reveal delay={70}>
          <Card
            title="Memory that stays small"
            body="One line per fact, and the argument in a note. Deleting is the maintenance, and roster lint holds each memory to a size budget."
          >
            <div className="flex flex-wrap items-end gap-x-10 gap-y-6 pt-2">
              <div>
                <div className="text-[44px] font-semibold leading-none tracking-[-0.045em] sm:text-[56px]">10,000</div>
                <div className="mt-2 text-[13px] text-fg-2">words to boot, today</div>
              </div>
              <div>
                <div className="text-[44px] font-semibold leading-none tracking-[-0.045em] text-fg-3 sm:text-[56px]">52,000</div>
                <div className="mt-2 text-[13px] text-fg-2">with a narrative status file</div>
              </div>
            </div>
            {/* a real line from Pip's CMO's memory/INDEX.md, lightly shortened */}
            <div className="mt-7 rounded-xl bg-bg-2 px-4 py-3">
              <div className="font-mono text-[11.5px] text-fg-2">cmo · count-not-percentage</div>
              <div className="mt-1 text-[14px] tracking-[-0.01em]">A rate off a small sample is not a number.</div>
              <div className="mt-0.5 text-[12.5px] text-fg-2">So: print &ldquo;7 of 21&rdquo;, never &ldquo;33%&rdquo;.</div>
            </div>
          </Card>
        </Reveal>
      </div>

      <Reveal>
        <div className="card mt-5 grid grid-cols-1 gap-6 p-7 sm:p-8 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
          <div>
            <h3 className="text-[21px] font-semibold tracking-[-0.025em]">Upgrades are merges</h3>
            <p className="mt-2 max-w-[560px] text-[15px] leading-[1.55] text-fg-2">
              The machinery is vendored with a recorded merge base, so framework changes arrive as
              a three-way merge. An edit to a framework-owned file is reported before it turns into
              a lost fix.
            </p>
          </div>
          <div className="w-fit rounded-full bg-bg-2 px-5 py-2.5 font-mono text-[13px]">roster upgrade</div>
        </div>
      </Reveal>

      <Reveal>
        <div className="card mt-5 p-7 sm:p-8">
          <h3 className="text-[21px] font-semibold tracking-[-0.025em]">New in the alpha</h3>
          <div className="mt-6 grid gap-x-10 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
            {news.map(([t, b]) => (
              <div key={t} className="border-t border-line pt-4">
                <div className="text-[15px] font-semibold tracking-[-0.01em]">{t}</div>
                <p className="mt-1 text-[14px] leading-[1.5] text-fg-2">{b}</p>
              </div>
            ))}
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
