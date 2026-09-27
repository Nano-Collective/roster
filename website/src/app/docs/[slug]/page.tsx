import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocPage } from "@/components/DocPage";
import { allDocs, renderDoc } from "@/lib/docs";

type Props = { params: Promise<{ slug: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return allDocs()
    .filter((d) => d.slug)
    .map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const d = allDocs().find((x) => x.slug === slug);
  return d ? { title: `${d.title} — Roster docs`, description: d.description } : {};
}

export default async function Doc({ params }: Props) {
  const { slug } = await params;
  const doc = await renderDoc(slug);
  if (!doc) notFound();
  return <DocPage doc={doc} />;
}
