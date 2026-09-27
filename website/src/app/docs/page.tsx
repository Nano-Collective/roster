import type { Metadata } from "next";
import { DocPage } from "@/components/DocPage";
import { renderDoc } from "@/lib/docs";

export const metadata: Metadata = {
  title: "Documentation — Roster",
  description: "How to stand up an agent-run org on GitHub, and every reference behind it.",
};

export default async function DocsIndex() {
  const doc = (await renderDoc(""))!;
  return <DocPage doc={doc} />;
}
