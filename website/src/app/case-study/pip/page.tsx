import type { Metadata } from "next";
import { FinalCTA, Footer } from "@/components/Footer";
import { Chevron } from "@/components/Icons";
import { Nav } from "@/components/Nav";
import { PipCards, PipLockup } from "@/components/Pip";
import { ProfilesChart } from "@/components/ProfilesChart";
import { lifetime } from "@/components/pipReadings";
import { Reveal } from "@/components/Reveal";
import { Section, SectionHead, Soft } from "@/components/Section";

const title = "Pip, run by Roster — 676 profiles in twelve weeks";
const description =
  "Roster agents have run Pip, a free poker web app, with zero budget, and everything is built by them. What happened in the first twelve weeks.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, type: "article" },
  twitter: { card: "summary_large_image", title, description },
};

const PIP = "https://playpip.io";
const PIP_REPO = "https://github.com/playpip/pip-web";
const PRS = 156;
const link = "text-fg underline decoration-line-2 underline-offset-4 hover:decoration-fg";

const tiles = [
  { n: lifetime.profiles.toLocaleString("en-GB"), l: "profiles created" },
  { n: lifetime.firstHands.toLocaleString("en-GB"), l: "players dealt their first hand" },
  { n: String(PRS), l: "pull requests from the staff" },
  { n: "£0", l: "spent on marketing" },
];

const milestones = [
  { date: "23 Jul", head: "Announced", body: "Posted on r/SideProject. 25 profiles that week.", art: "/pip/daily.jpg" },
  { date: "9 Aug", head: "The staff take over", body: "The CTO's first pull requests merge.", art: "/pip/rail.jpg" },
  { date: "27 Sep", head: "Membership on sale", body: "Lessons, checkout and billing, built by the staff.", art: "/pip/venues.jpg" },
  { date: "11 Oct", head: "Multiplayer", body: "Private rooms with friends, live.", art: "/pip/multiplayer.jpg" },
];

const working = ["Search and the blog", "One clear line about the free account", "Pages only Pip could write"];
const notWorking = ["Launch-day spikes", "More of the same guides", "Features nobody searched for"];

export default function PipCaseStudy() {
  return (
    <>
      <Nav />
      <main>
        <div className="pip">
          <section className="pip-dark relative overflow-hidden">
            {/* a pool of Pip's lavender under the table */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute left-1/2 top-[55%] h-[640px] w-[1100px] -translate-x-1/2 rounded-full opacity-60 blur-3xl"
              style={{ background: "radial-gradient(closest-side, rgba(124,140,240,0.35), transparent)" }}
            />
            <div className="relative mx-auto max-w-[1080px] px-6 pb-20 pt-16 sm:pb-28 sm:pt-24">
              <PipCards
                width={124}
                className="absolute right-10 top-36 hidden rotate-[6deg] xl:flex"
                cards={[{ rank: "A", suit: "♥", red: true }, { rank: "K", suit: "♠" }, "back"]}
              />
              <Reveal className="max-w-[760px]">
                <PipLockup />
                <div className="label mt-10">Case study</div>
                <h1 className="mt-4 text-[44px] font-semibold leading-[1.04] tracking-[-0.045em] sm:text-[72px]">
                  676 profiles. <Soft>Two staff. £0 on marketing.</Soft>
                </h1>
                <p className="mt-6 max-w-[620px] text-[17px] leading-[1.55] text-fg-2 sm:text-[19px]">
                  <a href={PIP} className={link}>
                    Pip
                  </a>{" "}
                  is free Texas Hold&rsquo;em in the browser. Roster agents have run the entire company
                  with zero budget, and everything is built by them. The only running cost is access to
                  a coding agent, and on a subscription plan that is flat.
                </p>
                <div className="mt-8 flex flex-wrap items-center gap-3">
                  <a href={PIP} className="btn bg-[#7c8cf0] text-black hover:opacity-90">
                    Play Pip
                  </a>
                  <a href={PIP_REPO} className="btn bg-white/10 text-white hover:bg-white/15">
                    Read the code
                  </a>
                </div>
              </Reveal>

              <Reveal delay={120} className="relative mt-16 sm:mt-20">
                <div className="overflow-hidden rounded-[18px] shadow-[0_0_0_1px_rgba(255,255,255,0.1),0_40px_120px_-20px_rgba(124,140,240,0.35)]">
                  <picture>
                    <source srcSet="/pip/table-phone.jpg" media="(max-width: 639px)" />
                    {/* biome-ignore lint/performance/noImgElement: static export, images are unoptimised */}
                    <img
                      src="/pip/table-desktop.jpg"
                      alt="A hand of Pip at the Friends' Garage table: the flop and turn down, Fold, Check and Bet below"
                      width={1600}
                      height={900}
                      className="block h-auto w-full"
                    />
                  </picture>
                </div>
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
            <p className="mt-4 text-[13px] text-fg-3">
              To 11 October 2026. {lifetime.views.toLocaleString("en-GB")} page views from{" "}
              {lifetime.visitors.toLocaleString("en-GB")} visitors since launch.
            </p>
          </Section>

          <Section>
            <SectionHead
              label="Twelve weeks"
              title={
                <>
                  Launch to multiplayer. <Soft>Shipped by two AI staff.</Soft>
                </>
              }
            />
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {milestones.map((m, i) => (
                <Reveal key={m.head} delay={i * 70}>
                  <div className="card h-full overflow-hidden">
                    {/* biome-ignore lint/performance/noImgElement: static export, images are unoptimised */}
                    <img src={m.art} alt="" width={640} height={640} className="block aspect-[4/3] w-full object-cover" />
                    <div className="p-5">
                      <div className="text-[13px] font-semibold tabular-nums text-accent">{m.date}</div>
                      <div className="mt-1 text-[17px] font-semibold tracking-[-0.01em]">{m.head}</div>
                      <p className="mt-1.5 text-[15px] leading-[1.45] text-fg-2">{m.body}</p>
                    </div>
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

          <section className="pip-dark relative overflow-hidden">
            <div className="relative mx-auto grid max-w-[1080px] items-center gap-12 px-6 py-24 sm:py-32 lg:grid-cols-[1fr_auto]">
              <SectionHead
                label="The work"
                title={
                  <>
                    Everything built by Roster. <Soft>Every change read before it merged.</Soft>
                  </>
                }
                lede={`${PRS} pull requests since August, from v1.0 to v1.27, a membership on sale and multiplayer. One person oversees it, reading what the staff hand off and merging it.`}
              />
              <PipCards
                width={96}
                className="justify-center lg:pr-6"
                cards={[
                  { rank: "A", suit: "♣" },
                  { rank: "5", suit: "♦", red: true },
                  { rank: "6", suit: "♠" },
                ]}
              />
              <p className="text-[15px] text-fg-2 lg:col-span-2">
                <a href={`${PIP_REPO}/pulls?q=is%3Apr+is%3Amerged`} className={link}>
                  All of it is public
                </a>
                . Start with{" "}
                <a href="/#work" className={link}>
                  three of them
                </a>
                , or{" "}
                <a href={PIP} className="inline-flex items-center gap-0.5 font-medium text-accent">
                  deal yourself in <Chevron className="size-3.5" />
                </a>
              </p>
            </div>
          </section>
        </div>
        <FinalCTA />
      </main>
      <Footer />
    </>
  );
}
