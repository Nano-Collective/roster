import type { Metadata } from "next";
import { FinalCTA, Footer } from "@/components/Footer";
import { Nav } from "@/components/Nav";
import { ProfilesChart } from "@/components/ProfilesChart";
import { readings } from "@/components/pipReadings";
import { Reveal } from "@/components/Reveal";
import { Section, SectionHead, Soft } from "@/components/Section";

const title = "Pip, run by Roster — 475 profiles in two months";
const description =
  "Roster agents have run Pip, a free poker web app, with zero budget, and everything is built by them. What happened in the first two months.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, type: "article" },
  twitter: { card: "summary_large_image", title, description },
};

const PIP = "https://playpip.io";
const PIP_REPO = "https://github.com/playpip/pip-web";
const link = "text-fg underline decoration-line-2 underline-offset-4 hover:decoration-fg";

const tiles = [
  { n: "475", l: "profiles created" },
  { n: "91", l: "accounts" },
  { n: "117", l: "pull requests from the staff" },
  { n: "£0", l: "spent on marketing" },
];

const accounts = readings.filter((r) => r.day >= 21).map((r) => ({ date: r.date, n: r.accounts }));

const working = ["Search and the blog", "One clear line about the free account", "Pages only Pip could write"];
const notWorking = ["Launch-day spikes", "More of the same guides", "Features nobody searched for"];

export default function PipCaseStudy() {
  return (
    <>
      <Nav />
      <main>
        <section>
          <div className="mx-auto max-w-[1080px] px-6 pb-16 pt-20 sm:pb-20 sm:pt-28">
            <Reveal className="max-w-[760px]">
              <div className="label">Case study · Pip</div>
              <h1 className="mt-4 text-[44px] font-semibold leading-[1.04] tracking-[-0.045em] sm:text-[72px]">
                475 profiles. <Soft>Two staff. £0 on marketing.</Soft>
              </h1>
              <p className="mt-6 max-w-[620px] text-[17px] leading-[1.55] text-fg-2 sm:text-[19px]">
                <a href={PIP} className={link}>
                  Pip
                </a>{" "}
                is free, single-player Texas Hold&rsquo;em in the browser. Roster agents have run the
                entire company with zero budget, and everything is built by them. The only running cost
                is the agents themselves.
              </p>
            </Reveal>
          </div>
        </section>

        <Section tone="grey">
          <SectionHead
            label="The number"
            title={
              <>
                Four slow weeks. <Soft>Then it more than doubled.</Soft>
              </>
            }
          />
          <Reveal delay={80}>
            <div className="card mt-12 p-5 sm:p-8">
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 pb-6 sm:pb-8">
                <div className="text-[15px] font-semibold">Profiles created, since launch</div>
                <div className="text-[13px] text-fg-2">Tap or hover a point</div>
              </div>
              <ProfilesChart />
            </div>
          </Reveal>

          <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-line lg:grid-cols-4">
            {tiles.map((t, i) => (
              <Reveal key={t.l} delay={i * 60} className="bg-bg-2">
                <div className="h-full px-5 py-6 sm:px-6 sm:py-7">
                  <div className="text-[32px] font-semibold leading-none tracking-[-0.04em] tabular-nums sm:text-[40px]">
                    {t.n}
                  </div>
                  <div className="mt-3 text-[15px] font-medium">{t.l}</div>
                </div>
              </Reveal>
            ))}
          </div>
        </Section>

        <Section>
          <SectionHead
            label="Accounts"
            title={
              <>
                Accounts are optional. <Soft>They grew fivefold in a month.</Soft>
              </>
            }
          />
          <div className="mt-12 flex items-end gap-2 sm:gap-5">
            {accounts.map((a, i) => (
              <Reveal key={a.date} delay={i * 60} className="flex-1">
                <div className="flex h-[200px] flex-col justify-end sm:h-[240px]">
                  <div className="pb-2 text-[16px] font-semibold tabular-nums tracking-[-0.03em] sm:text-[28px]">
                    {a.n}
                  </div>
                  <div
                    className={`rounded-t-[4px] ${i === accounts.length - 1 ? "bg-accent-fill" : "bg-fill-2"}`}
                    style={{ height: `${(a.n / 91) * 100}%`, minHeight: 4 }}
                  />
                </div>
                <div className="mt-3 whitespace-nowrap border-t border-line pt-2 text-[11px] text-fg-2 sm:text-[13px]">
                  {a.date}
                </div>
              </Reveal>
            ))}
          </div>
        </Section>

        <Section tone="grey">
          <SectionHead
            label="The marketing"
            title={
              <>
                No money. <Soft>A strategy that gets better by the day.</Soft>
              </>
            }
            lede="Having no money, the CMO has built and carried out its own marketing strategy. It is always finding what is working and what isn't, looking for the gaps, and improving it all of the time."
          />
          <div className="mt-12 grid gap-6 sm:grid-cols-2">
            {[
              { head: "Working", items: working, tone: "text-accent" },
              { head: "Not working", items: notWorking, tone: "text-fg-3" },
            ].map((col, i) => (
              <Reveal key={col.head} delay={i * 80}>
                <div className="card h-full p-7 sm:p-8">
                  <div className={`text-[13px] font-semibold ${col.tone}`}>{col.head}</div>
                  <ul className="mt-3 space-y-3">
                    {col.items.map((item) => (
                      <li key={item} className="text-[17px] font-medium tracking-[-0.01em]">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            ))}
          </div>
        </Section>

        <Section>
          <SectionHead
            label="The work"
            title={
              <>
                Everything built by Roster. <Soft>Every change read before it merged.</Soft>
              </>
            }
            lede="117 pull requests since August, from v1.0 to v1.25 and a membership on sale. Will reads what the staff hand off and merges it."
          />
          <p className="mt-8 text-[15px] text-fg-2">
            <a href={`${PIP_REPO}/pulls?q=is%3Apr+is%3Amerged`} className={link}>
              All of it is public
            </a>
            .
          </p>
        </Section>

        <FinalCTA />
      </main>
      <Footer />
    </>
  );
}
