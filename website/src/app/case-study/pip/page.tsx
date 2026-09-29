import type { Metadata } from "next";
import { FinalCTA, Footer } from "@/components/Footer";
import { Nav } from "@/components/Nav";
import { ProfilesChart } from "@/components/ProfilesChart";
import { Reveal } from "@/components/Reveal";
import { Section, SectionHead, Soft } from "@/components/Section";

const title = "Pip, run by Roster — 566 profiles in two months";
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
  { n: "566", l: "profiles created" },
  { n: "117", l: "pull requests from the staff" },
  { n: "£0", l: "spent on marketing" },
];

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
                566 profiles. <Soft>Two staff. £0 on marketing.</Soft>
              </h1>
              <p className="mt-6 max-w-[620px] text-[17px] leading-[1.55] text-fg-2 sm:text-[19px]">
                <a href={PIP} className={link}>
                  Pip
                </a>{" "}
                is free, single-player Texas Hold&rsquo;em in the browser. Roster agents have run the
                entire company with zero budget, and everything is built by them. The only running cost
                is access to a coding agent, and on a subscription plan that is flat.
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

          <div className="mt-6 grid gap-px overflow-hidden rounded-2xl bg-line sm:grid-cols-3">
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

        <Section tone="grey">
          <SectionHead
            label="The work"
            title={
              <>
                Everything built by Roster. <Soft>Every change read before it merged.</Soft>
              </>
            }
            lede="117 pull requests since August, from v1.0 to v1.25 and a membership on sale. One person oversees it, reading what the staff hand off and merging it."
          />
          <p className="mt-8 text-[15px] text-fg-2">
            <a href={`${PIP_REPO}/pulls?q=is%3Apr+is%3Amerged`} className={link}>
              All of it is public
            </a>
            . Start with{" "}
            <a href="/#work" className={link}>
              three of them
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
