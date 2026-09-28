import { Github } from "./Icons";
import { DOCS, doc, REPO } from "./links";
import { Logo } from "./Logo";

const items = [
  { label: "How it works", href: "/#how" },
  { label: "Portal", href: "/#portal" },
  { label: "Agents", href: "/#agents" },
  { label: "Principles", href: "/#principles" },
  { label: "Case study", href: "/case-study/pip/" },
  { label: "Docs", href: DOCS },
];

export function Nav() {
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-bg/80 backdrop-blur-xl backdrop-saturate-[1.8]">
      <div className="mx-auto flex h-[52px] max-w-[1080px] items-center justify-between px-6">
        <a href="/" aria-label="Roster home">
          <Logo />
        </a>
        <nav className="hidden items-center gap-7 md:flex">
          {items.map((i) => (
            <a key={i.label} href={i.href} className="text-[13px] text-fg-2 transition hover:text-fg">
              {i.label}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-4">
          <a href={REPO} aria-label="GitHub" className="text-fg-2 transition hover:text-fg">
            <Github className="size-[18px]" />
          </a>
          <a
            href={doc("getting-started")}
            className="inline-flex h-7 items-center rounded-full bg-invert px-3.5 text-[12px] font-medium text-on-invert transition hover:opacity-85"
          >
            Get started
          </a>
        </div>
      </div>
    </header>
  );
}
