import { CopyCommand } from "./CopyCommand";
import { COLLECTIVE, DISCORD, DOCS, doc, NPM, REPO } from "./links";
import { Mark } from "./Logo";

export function FinalCTA() {
  return (
    <section className="border-t border-line">
      <div className="mx-auto max-w-[1080px] px-6 py-24 text-center sm:py-36">
        <div className="flex justify-center">
          <Mark size={56} />
        </div>
        <h2 className="mx-auto mt-8 max-w-[720px] text-[40px] font-semibold leading-[1.06] tracking-[-0.04em] sm:text-[56px]">
          Your first hire is one command away.
        </h2>
        <p className="mx-auto mt-5 max-w-[500px] text-[17px] leading-[1.55] text-fg-2 sm:text-[19px]">
          You need a GitHub organisation, GitHub&apos;s command-line tool (gh), and an account with
          a coding agent such as Claude Code or Codex. The rest is a page in your browser.
        </p>
        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a href={doc("getting-started")} className="btn btn-primary">
            Get started
          </a>
          <CopyCommand />
        </div>
      </div>
    </section>
  );
}

const cols = [
  {
    h: "Product",
    l: [
      ["Getting started", doc("getting-started")],
      ["The portal", doc("portal")],
      ["Choosing an agent", doc("agents")],
      ["Commands", doc("commands")],
    ],
  },
  {
    h: "Learn",
    l: [
      ["Concepts", doc("concepts")],
      ["Writing a charter", doc("writing-a-charter")],
      ["Memory", doc("memory")],
      ["Cost", doc("cost")],
    ],
  },
  {
    h: "Community",
    l: [
      ["GitHub", REPO],
      ["npm", NPM],
      ["Discord", DISCORD],
      ["Nano Collective", COLLECTIVE],
    ],
  },
];

export function Footer() {
  return (
    <footer className="bg-bg-2 text-[12px]">
      <div className="mx-auto max-w-[1080px] px-6">
        <p className="border-b border-line py-5 leading-[1.6] text-fg-2">
          Roster is built by the Nano Collective, a community building AI tooling not for profit
          but for the community. It is in alpha, and things will change.{" "}
          <a href={DOCS} className="link">
            Read the docs
          </a>
          .
        </p>
        <div className="grid grid-cols-2 gap-8 border-b border-line py-8 sm:grid-cols-3">
          {cols.map((c) => (
            <div key={c.h}>
              <div className="font-semibold text-fg">{c.h}</div>
              <ul className="mt-3 space-y-2">
                {c.l.map(([label, href]) => (
                  <li key={label}>
                    <a href={href} className="text-fg-2 transition hover:text-fg hover:underline">
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="flex flex-col justify-between gap-2 py-5 text-fg-2 sm:flex-row">
          <span>Copyright © {new Date().getFullYear()} Nano Collective. MIT licensed.</span>
          <a href={REPO} className="hover:text-fg">
            github.com/Nano-Collective/roster
          </a>
        </div>
      </div>
    </footer>
  );
}
