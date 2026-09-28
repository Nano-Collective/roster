"use client";

import { useState } from "react";
import { Reveal } from "./Reveal";
import { Section, SectionHead, Soft } from "./Section";

const onGithub = [
  {
    title: "Work arrives as a pull request",
    body: "Read the diff, merge it or leave a review. That is the approval.",
  },
  {
    title: "Decisions arrive as issues",
    body: "Anything that needs you is an issue with the question in it. Answer in a comment.",
  },
  {
    title: "Mention them to talk",
    body: "@ a staff member on any issue or pull request and they get to work on it straight away.",
  },
];

const screens: { label: string; body: string; src: string; dark?: string }[] = [
  {
    label: "Brain",
    body: "A staff member's facts, notes and files in one place, because they were always the same thing.",
    src: "/screens/brain.jpg",
    dark: "/screens/brain-dark.jpg",
  },
  {
    label: "Prompt",
    body: "The exact text they're sent, composed by your own compose.mjs, with every layer and where it came from.",
    src: "/screens/prompt.jpg",
    dark: "/screens/prompt-dark.jpg",
  },
  {
    label: "Org",
    body: "org.yaml and every shared file, editable in place. Saving commits and pushes.",
    src: "/screens/org.jpg",
  },
  {
    label: "Staff",
    body: "Hire someone. Only the handle is required, and you see the plan before anything exists.",
    src: "/screens/staff.jpg",
  },
  {
    label: "Graph",
    body: "How a mind is put together: every fact, note and file, and what points at what.",
    src: "/screens/graph.jpg",
  },
];

export function Showcase() {
  const [active, setActive] = useState(0);
  const s = screens[active]!;

  return (
    <Section id="portal" tone="grey">
      <SectionHead
        center
        label="The portal"
        title={
          <>
            Every brain, readable. <Soft>On your machine.</Soft>
          </>
        }
        lede="A local app over the checked-out repos. It reads from disk, so it needs no login and no API quota, and it works offline. When it writes, it writes as you."
      />

      <Reveal delay={80}>
        <div className="mx-auto mt-12 flex w-fit max-w-full overflow-x-auto rounded-[10px] bg-fill-2 p-[3px]">
          {screens.map((x, i) => (
            <button
              key={x.label}
              type="button"
              onClick={() => setActive(i)}
              className={`rounded-[8px] px-4 py-1 text-[13px] font-medium transition sm:px-6 ${
                i === active ? "bg-surface text-fg shadow-[0_1px_3px_rgba(0,0,0,0.12)]" : "text-fg-2"
              }`}
            >
              {x.label}
            </button>
          ))}
        </div>
        <p className="mx-auto mt-5 max-w-[520px] text-center text-[15px] leading-[1.5] text-fg-2">{s.body}</p>

        {/* On a phone the full screenshot shrinks to unreadable, so it keeps a legible
            width and pans sideways instead; tapping opens it full size to pinch-zoom. */}
        <div className="window mx-auto mt-10">
          <div key={s.src} className="overflow-x-auto overscroll-x-contain sm:overflow-visible">
            <a
              href={s.src}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => {
                const img = e.currentTarget.querySelector("img");
                if (img?.currentSrc) e.currentTarget.href = img.currentSrc;
              }}
              className="block w-[860px] sm:w-full"
            >
              <picture>
                {s.dark && <source srcSet={s.dark} media="(prefers-color-scheme: dark)" />}
                {/* biome-ignore lint/performance/noImgElement: static export, images are unoptimised */}
                <img
                  src={s.src}
                  alt={`The Roster portal, ${s.label} screen`}
                  width={1432}
                  height={707}
                  className="fade-up block h-auto w-full"
                  style={{ animationDuration: "400ms" }}
                />
              </picture>
            </a>
          </div>
        </div>
        <p className="mt-4 text-center text-[13px] text-fg-3 sm:hidden">Swipe to look around · tap to open full size</p>
      </Reveal>

      {/* the portal is optional: everything it shows is on GitHub too */}
      <Reveal delay={80}>
        <div className="mx-auto mt-24 max-w-[720px] text-center">
          <h3 className="text-[28px] font-semibold leading-[1.15] tracking-[-0.03em] sm:text-[36px]">
            Or never open it. <Soft>Run the whole org from GitHub.</Soft>
          </h3>
          <p className="mt-4 text-[17px] leading-[1.55] text-fg-2">
            The portal is a nicer way to read. Everything it shows lives in your repos, so the whole
            org is manageable straight from GitHub, on the web or your phone.
          </p>
        </div>
      </Reveal>
      <div className="mt-12 grid gap-px overflow-hidden rounded-2xl bg-line md:grid-cols-3">
        {onGithub.map((g, i) => (
          <Reveal key={g.title} delay={i * 70} className="bg-bg-2">
            <div className="h-full p-6 md:pr-8">
              <div className="text-[17px] font-semibold tracking-[-0.02em]">{g.title}</div>
              <p className="mt-2 text-[14px] leading-[1.55] text-fg-2">{g.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}
