import { DocsSidebar } from "@/components/DocsSidebar";
import { Footer } from "@/components/Footer";
import { Nav } from "@/components/Nav";
import { groups } from "@/lib/docs";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const g = groups().map((x) => ({
    title: x.title,
    docs: x.docs.map(({ slug, title, description }) => ({ slug, title, description })),
  }));
  return (
    <>
      <Nav />
      <div className="mx-auto flex max-w-[1240px] gap-12 px-6">
        <aside className="hidden w-[232px] shrink-0 lg:block">
          <div className="sticky top-[52px] max-h-[calc(100vh-52px)] overflow-y-auto py-10 pr-2">
            <DocsSidebar groups={g} />
          </div>
        </aside>
        <main className="min-w-0 flex-1 py-10 sm:py-14">
          <details className="mb-8 rounded-xl bg-bg-2 lg:hidden">
            <summary className="cursor-pointer list-none px-4 py-3 text-[14px] font-medium">
              Browse the docs
            </summary>
            <div className="px-2 pb-2">
              <DocsSidebar groups={g} />
            </div>
          </details>
          {children}
        </main>
      </div>
      <Footer />
    </>
  );
}
