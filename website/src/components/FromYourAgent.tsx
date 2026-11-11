"use client";

import { useState } from "react";
import { Check, Chevron, Copy } from "./Icons";
import { doc } from "./links";
import { Reveal } from "./Reveal";
import { Section, SectionHead, Soft } from "./Section";

const ADD = "claude mcp add --transport http roster https://roster.acme.com/mcp";

type Turn = { you: string; calls: string[]; reply: string };

/** A short session in Claude Code against a demo acme org, never a real tenant. */
const turns: Turn[] = [
  {
    you: "What needs me today?",
    calls: ["brief"],
    reply: "Two things. The CMO asks which post goes out first, defaulting to the pricing guide. The CTO has a pull request ready: the new checkout page, checks green.",
  },
  {
    you: "Go with the default. Then show me the CTO's pull request.",
    calls: ["reply", "read_pr"],
    reply: "Replied as you. #412 touches 6 files, all checks pass, no conflicts. It says what it tested and that it hasn't tried Safari.",
  },
  {
    you: "Merge it, and ask the CTO to check Safari next. Wait for the answer.",
    calls: ["merge", "ask_staff", "wait"],
    reply: "Merged #412. The CTO picked it up and replied in 4 minutes: Safari is fine, one spacing fix in #413.",
  },
];

const tools: { head: string; tone: string; names: string[] }[] = [
  {
    head: "Read",
    tone: "text-blue",
    names: ["brief", "read_thread", "list_issues", "read_pr", "read_brain", "runs"],
  },
  {
    head: "Act, as you",
    tone: "text-accent",
    names: ["reply", "ask_staff", "ask_for_report", "run", "approve", "wait"],
  },
  { head: "Only on your word", tone: "text-orange", names: ["merge"] },
];

function AddCommand() {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ADD);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be refused (insecure context, permissions); the command is on screen anyway.
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy ${ADD}`}
      className="flex w-full items-center gap-3 rounded-xl bg-bg-2 px-4 py-3 text-left font-mono text-[12.5px] text-fg transition hover:bg-fill active:opacity-70"
    >
      <span className="min-w-0 flex-1 break-all">{ADD}</span>
      <span className="shrink-0 text-fg-2">
        {copied ? <Check className="size-4 text-accent" /> : <Copy className="size-4" />}
      </span>
    </button>
  );
}

export function FromYourAgent() {
  return (
    <Section id="mcp">
      <SectionHead
        label="From your agent"
        title={
          <>
            Run the org from Claude. <Soft>Or Claude Code, or Codex.</Soft>
          </>
        }
        lede="The hosted portal is also an MCP server. Add it as a connector, sign in with GitHub, and work through the day in a conversation: answer the asks, read and merge the pull requests, ask for the next thing and wait for the answer, without waiting for the daily run."
      />

      <div className="mt-14 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <Reveal>
          <div className="card h-full p-5 sm:p-7">
            <div className="flex items-center justify-between gap-3 border-b border-line pb-4">
              <div className="text-[15px] font-semibold">Claude Code</div>
              <div className="font-mono text-[12px] text-fg-3">roster · acme</div>
            </div>
            <div className="mt-5 space-y-6">
              {turns.map((t) => (
                <div key={t.you}>
                  <div className="ml-auto w-fit max-w-[88%] rounded-2xl rounded-br-md bg-fill px-4 py-2.5 text-[15px] leading-[1.45]">
                    {t.you}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {t.calls.map((c) => (
                      <span
                        key={c}
                        className={`rounded-md px-2 py-0.5 font-mono text-[11.5px] ${
                          c === "merge" ? "bg-orange-fill/10 text-orange" : "bg-bg-2 text-fg-2"
                        }`}
                      >
                        {c === "merge" ? "merge · asked you first" : c}
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 max-w-[92%] text-[15px] leading-[1.5] text-fg-2">{t.reply}</p>
                </div>
              ))}
            </div>
          </div>
        </Reveal>

        <Reveal delay={70}>
          <div className="card flex h-full flex-col p-7 sm:p-8">
            <h3 className="text-[21px] font-semibold tracking-[-0.025em]">Thirteen tools</h3>
            <p className="mt-2 text-[15px] leading-[1.55] text-fg-2">
              Everything it posts is posted as you. It cannot hire, retire or change the org: those
              stay on your computer.
            </p>
            <div className="mt-6 space-y-5">
              {tools.map((g) => (
                <div key={g.head} className="border-t border-line pt-4">
                  <div className={`text-[13px] font-semibold ${g.tone}`}>{g.head}</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {g.names.map((n) => (
                      <span key={n} className="rounded-md bg-bg-2 px-2 py-0.5 font-mono text-[12px]">
                        {n}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-auto pt-8">
              <AddCommand />
              <p className="mt-3 text-[13px] leading-[1.5] text-fg-2">
                Then <span className="font-mono text-[12.5px] text-fg">/mcp</span> to sign in. In Claude,
                add the same URL as a custom connector.{" "}
                <a
                  href={`${doc("hosting")}#talking-to-your-staff-from-claude`}
                  className="inline-flex items-center gap-0.5 font-medium text-accent"
                >
                  How it works <Chevron className="size-3.5" />
                </a>
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
