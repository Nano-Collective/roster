import type { renderDoc } from "@/lib/docs";
import { hrefOf } from "@/lib/docs";
import { Chevron } from "./Icons";

type Doc = NonNullable<Awaited<ReturnType<typeof renderDoc>>>;

export function DocPage({ doc }: { doc: Doc }) {
  return (
    <div className="flex gap-12">
      <article className="min-w-0 flex-1">
        <h1 className="text-[34px] font-semibold leading-[1.12] tracking-[-0.03em] sm:text-[40px]">
          {doc.meta.title}
        </h1>
        {doc.meta.description && (
          <p className="mt-3 text-[19px] leading-[1.5] text-fg-2">{doc.meta.description}</p>
        )}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: rendered at build time from the repo's own docs */}
        <div className="prose mt-10" dangerouslySetInnerHTML={{ __html: doc.html }} />

        <div className="mt-16 grid grid-cols-1 gap-3 border-t border-line pt-8 sm:grid-cols-2">
          {doc.prev ? (
            <a href={hrefOf(doc.prev.slug)} className="rounded-xl bg-bg-2 px-5 py-4 transition hover:bg-fill">
              <div className="text-[12px] text-fg-2">Previous</div>
              <div className="mt-0.5 text-[15px] font-medium">{doc.prev.title}</div>
            </a>
          ) : (
            <span />
          )}
          {doc.next && (
            <a
              href={hrefOf(doc.next.slug)}
              className="rounded-xl bg-bg-2 px-5 py-4 text-right transition hover:bg-fill"
            >
              <div className="text-[12px] text-fg-2">Next</div>
              <div className="mt-0.5 text-[15px] font-medium">{doc.next.title}</div>
            </a>
          )}
        </div>
        <a href={doc.editUrl} className="link mt-6 inline-flex items-center gap-0.5 text-[13px]">
          Edit this page on GitHub <Chevron className="size-3" />
        </a>
      </article>

      {doc.headings.length > 1 && (
        <aside className="hidden w-[200px] shrink-0 xl:block">
          <div className="sticky top-[84px]">
            <div className="pb-2 text-[12px] font-semibold text-fg-3">On this page</div>
            <ul className="space-y-1.5 border-l border-line">
              {doc.headings.map((h) => (
                <li key={h.id}>
                  <a
                    href={`#${h.id}`}
                    className="-ml-px block border-l border-transparent pl-3 text-[13px] leading-snug text-fg-2 transition hover:border-fg-2 hover:text-fg"
                  >
                    {h.text}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      )}
    </div>
  );
}
