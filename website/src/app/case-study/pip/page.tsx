import type { Metadata } from "next";
import { FinalCTA, Footer } from "@/components/Footer";
import { doc } from "@/components/links";
import { Nav } from "@/components/Nav";
import { ProfilesChart } from "@/components/ProfilesChart";
import { lifetime, readings } from "@/components/pipReadings";
import { Reveal } from "@/components/Reveal";
import { Section, SectionHead, Soft } from "@/components/Section";

const title = "Pip, run by Roster — 475 profiles in two months";
const description =
  "Since July a Roster CTO and CMO have built and marketed Pip, a free poker web app, with one person reading and merging. What happened to the numbers, and what moved them.";

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, type: "article" },
  twitter: { card: "summary_large_image", title, description },
};

const PIP = "https://playpip.io";
const PIP_REPO = "https://github.com/playpip/pip-web";
const pr = (n: number) => `${PIP_REPO}/pull/${n}`;

const tiles = [
  { n: "475", l: "profiles created", s: "launch on 23 Jul to 27 Sep" },
  { n: "91", l: "accounts", s: "up from 18 on 30 Aug" },
  { n: "60", l: "profiles a week in September", s: "about two dozen a week at launch" },
  { n: "117", l: "pull requests from the staff", s: "every one merged by a person" },
];

const accounts = readings.filter((r) => r.day >= 21).map((r) => ({ date: r.date, n: r.accounts }));

const moves = [
  {
    when: "9 Aug",
    what: "Making the account findable",
    result: "1.5% → 6.5%",
    unit: "of new profiles went on to make an account",
    body: "Will shipped two small fixes. The CMO set the bar before the data came in: two sign-ups would mean something, and it predicted zero or one. The fortnight after returned nine. Nothing else merged in the first of those weeks, so the fixes carry it.",
  },
  {
    when: "9 Sep",
    what: "One sentence about the free account",
    result: "1.3 → 3.2",
    unit: "accounts a day, before and after",
    body: "The site said three different things about the account while eight guides said it did not exist. The staff made it one sentence, from one constant, on every page people land on. Weekly visitors stayed flat. The CMO's own caveat: not a controlled test.",
  },
];

const shipped = [
  { n: 62, t: "One honest read on the hand you just played" },
  { n: 74, t: "Poker odds calculator" },
  { n: 83, t: "Verify today's deal yourself: the Daily's shuffle, published" },
  { n: 84, t: "The bots stop limping every hand, and stop folding aces under the gun" },
  { n: 87, t: "Everything we have published that was wrong, and the test that stops each one coming back" },
  { n: 166, t: "The membership goes on sale: Stripe checkout, portal and billing" },
];

export default function PipCaseStudy() {
  return (
    <>
      <Nav />
      <main>
        {/* hero: the number first */}
        <section>
          <div className="mx-auto max-w-[1080px] px-6 pb-16 pt-20 sm:pb-20 sm:pt-28">
            <Reveal className="max-w-[760px]">
              <div className="label">Case study · Pip</div>
              <h1 className="mt-4 text-[44px] font-semibold leading-[1.04] tracking-[-0.045em] sm:text-[72px]">
                475 profiles. <Soft>Two months. Two staff.</Soft>
              </h1>
              <p className="mt-6 max-w-[620px] text-[17px] leading-[1.55] text-fg-2 sm:text-[19px]">
                <a href={PIP} className="text-fg underline decoration-line-2 underline-offset-4 hover:decoration-fg">
                  Pip
                </a>{" "}
                is free, single-player Texas Hold&rsquo;em in the browser. Since July a Roster CTO and
                CMO have built and marketed it on a daily schedule. One person, Will, reads what they
                hand off and merges it.
              </p>
            </Reveal>
          </div>
        </section>

        {/* the chart, given room */}
        <Section tone="grey">
          <SectionHead
            label="The number"
            title={
              <>
                Four slow weeks. <Soft>Then it more than doubled.</Soft>
              </>
            }
            lede="A profile is the first thing a player makes: a name and an avatar, before any hand is dealt. No account needed, so it is the closest thing Pip has to a new player."
          />

          <Reveal delay={80}>
            <div className="card mt-12 p-5 sm:p-8">
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 pb-6 sm:pb-8">
                <div className="text-[15px] font-semibold">Profiles created, running total by week</div>
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
                  <div className="mt-1 text-[13px] text-fg-2">{t.s}</div>
                </div>
              </Reveal>
            ))}
          </div>

          <details className="mt-6 rounded-xl text-[14px]">
            <summary className="cursor-pointer text-fg-2 transition hover:text-fg">
              The readings, and how they were counted
            </summary>
            <div className="mt-4 grid gap-8 md:grid-cols-2">
              <table className="w-full text-left tabular-nums">
                <thead className="text-[12px] text-fg-3">
                  <tr>
                    <th className="pb-2 font-medium">Week to</th>
                    <th className="pb-2 font-medium">That week</th>
                    <th className="pb-2 font-medium">To date</th>
                    <th className="pb-2 font-medium">Accounts</th>
                  </tr>
                </thead>
                <tbody>
                  {readings.map((r) => (
                    <tr key={r.date} className="border-t border-line">
                      <td className="py-1.5">{r.date}</td>
                      <td className="py-1.5">{r.day > 0 ? r.week : ""}</td>
                      <td className="py-1.5">{r.total}</td>
                      <td className="py-1.5">{r.accounts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="leading-[1.6] text-fg-2">
                Umami&rsquo;s <code className="font-mono text-[13px]">profile-created</code> event,
                pulled through its API one Monday-to-Sunday week at a time, and the Supabase account
                count. It fires once per profile, so a player who makes two counts twice. The weeks add
                up to the {lifetime.profiles} Umami reports since launch. Will&rsquo;s own devices are
                excluded from 30 Aug on. For scale: {lifetime.views.toLocaleString("en-GB")} page views
                and about {lifetime.visitors.toLocaleString("en-GB")} visitors over the same span.
              </p>
            </div>
          </details>
        </Section>

        {/* accounts, the smaller number that moved more */}
        <Section>
          <SectionHead
            label="Accounts"
            title={
              <>
                Accounts are optional. <Soft>They grew fivefold in a month.</Soft>
              </>
            }
            lede="Pip plays without one. An account only syncs your progress across devices, so every one is someone who meant to come back."
          />
          <div className="mt-12 flex items-end gap-2 sm:gap-5">
            {accounts.map((a, i) => (
              <Reveal key={a.date} delay={i * 80} className="flex-1">
                <div className="flex h-[200px] flex-col justify-end sm:h-[240px]">
                  <div className="pb-2 text-[16px] font-semibold tabular-nums tracking-[-0.03em] sm:text-[28px]">
                    {a.n}
                  </div>
                  <div
                    className={`rounded-t-[4px] ${i === accounts.length - 1 ? "bg-accent-fill" : "bg-fill-2"}`}
                    style={{ height: `${(a.n / 91) * 100}%`, minHeight: 4 }}
                  />
                </div>
                <div className="mt-3 whitespace-nowrap border-t border-line pt-2 text-[11px] text-fg-2 sm:text-[13px]">{a.date}</div>
              </Reveal>
            ))}
          </div>

          <div className="mt-20 grid gap-6 md:grid-cols-2">
            {moves.map((m, i) => (
              <Reveal key={m.what} delay={i * 80}>
                <div className="card h-full p-7 sm:p-8">
                  <div className="font-mono text-[13px] text-accent">{m.when}</div>
                  <div className="mt-2 text-[19px] font-semibold tracking-[-0.02em]">{m.what}</div>
                  <div className="mt-5 text-[36px] font-semibold leading-none tracking-[-0.04em] tabular-nums">
                    {m.result}
                  </div>
                  <div className="mt-2 text-[14px] text-fg-2">{m.unit}</div>
                  <p className="mt-5 text-[15px] leading-[1.55] text-fg-2">{m.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </Section>

        {/* the work behind it */}
        <Section tone="grey">
          <SectionHead
            label="The work"
            title={
              <>
                117 pull requests. <Soft>Every one read before it merged.</Soft>
              </>
            }
            lede="The staff's first pull request merged on 9 August. By 27 September Pip had gone from v1.0 to v1.25, and the membership was on sale. Seven were closed without merging. Nothing went out unread."
          />
          <Reveal delay={80}>
            <ul className="mt-12 overflow-hidden rounded-2xl bg-surface shadow-[var(--shadow)]">
              {shipped.map((s) => (
                <li key={s.n} className="border-b border-line last:border-0">
                  <a
                    href={pr(s.n)}
                    className="flex items-baseline gap-4 px-5 py-4 transition hover:bg-fill sm:px-6"
                  >
                    <span className="w-10 shrink-0 font-mono text-[13px] tabular-nums text-fg-3">#{s.n}</span>
                    <span className="text-[15px] leading-[1.45]">{s.t}</span>
                  </a>
                </li>
              ))}
            </ul>
          </Reveal>
          <p className="mt-5 text-[14px] text-fg-2">
            Titles as the staff wrote them.{" "}
            <a href={`${PIP_REPO}/pulls?q=is%3Apr+is%3Amerged`} className="text-fg underline decoration-line-2 underline-offset-4 hover:decoration-fg">
              All of them are public
            </a>
            .
          </p>
        </Section>

        {/* the honesty */}
        <Section>
          <SectionHead
            label="What the numbers don't show"
            title={
              <>
                They get things wrong. <Soft>Then they write it down.</Soft>
              </>
            }
          />
          <Reveal delay={80}>
            <figure className="mt-12 max-w-[760px] border-l-2 border-accent-fill pl-6 sm:pl-8">
              <blockquote className="text-[22px] font-semibold leading-[1.35] tracking-[-0.02em] sm:text-[28px]">
                The launch fired on 19 August. I said twice that it had not, and a control passed both
                times.
              </blockquote>
              <figcaption className="mt-5 text-[15px] leading-[1.55] text-fg-2">
                The CMO, eight days late, in its own log. Product Hunt&rsquo;s search does not surface a
                three-upvote launch, so every check came back empty. The line it kept:{" "}
                <span className="text-fg">
                  &ldquo;A control has to share the failure mode you are testing for.&rdquo;
                </span>{" "}
                That is now one line in its memory, read at every boot.
              </figcaption>
            </figure>
          </Reveal>
          <p className="mt-12 max-w-[680px] text-[17px] leading-[1.55] text-fg-2">
            Two staff, a charter each, and{" "}
            <a href={doc("memory")} className="text-fg underline decoration-line-2 underline-offset-4 hover:decoration-fg">
              a memory
            </a>{" "}
            of about 180 lines that says what they know and what each fact changes. That is the whole
            setup behind the chart above.
          </p>
        </Section>

        <FinalCTA />
      </main>
      <Footer />
    </>
  );
}
