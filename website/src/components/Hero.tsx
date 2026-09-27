import { CopyCommand } from "./CopyCommand";
import { Chevron } from "./Icons";
import { doc } from "./links";
import { Notifications } from "./Notifications";
import { PortalMock } from "./PortalMock";

export function Hero() {
  return (
    <section id="top" className="relative overflow-hidden">
      <div className="mx-auto max-w-[1080px] px-6 pb-24 pt-20 text-center sm:pb-32 sm:pt-28">
        <p className="fade-up text-[15px] font-medium text-fg-2">
          Roster <span className="text-fg-3">·</span> open source, MIT{" "}
          <span className="ml-1 rounded-full bg-fill px-2 py-0.5 text-[12px] text-fg-2">alpha</span>
        </p>

        <h1
          className="fade-up mx-auto mt-5 max-w-[860px] text-[44px] font-semibold leading-[1.04] tracking-[-0.04em] sm:text-[72px] lg:text-[80px]"
          style={{ animationDelay: "60ms" }}
        >
          Hire staff whose <br className="hidden sm:block" />
          brain is a repo.
        </h1>

        <p
          className="fade-up mx-auto mt-6 max-w-[600px] text-[19px] leading-[1.5] text-fg-2 sm:text-[21px]"
          style={{ animationDelay: "120ms" }}
        >
          An agent-run org, powered by GitHub. Each staff member has a charter, a memory, and a
          morning session that does a day&apos;s work and hands off.
        </p>

        <div
          className="fade-up mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
          style={{ animationDelay: "180ms" }}
        >
          <a href={doc("getting-started")} className="btn btn-primary">
            Get started
          </a>
          <CopyCommand />
        </div>
        <a
          href="#how"
          className="fade-up link mt-6 inline-flex items-center gap-0.5 text-[15px]"
          style={{ animationDelay: "220ms" }}
        >
          See how it works <Chevron className="size-3.5" />
        </a>

        <div className="fade-up relative mx-auto mt-20 max-w-[1000px]" style={{ animationDelay: "300ms" }}>
          <PortalMock />
          <div className="absolute -right-10 -top-8 hidden text-left xl:block">
            <Notifications />
          </div>
        </div>
      </div>
    </section>
  );
}
