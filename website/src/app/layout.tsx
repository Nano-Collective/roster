import type { Metadata, Viewport } from "next";
import { Figtree, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

// Figtree is the face Astryx's neutral theme is drawn in.
const figtree = Figtree({ subsets: ["latin"], variable: "--font-figtree", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

const title = "Roster — AI staff for your organisation, run on GitHub";
const description =
  "Run your org on AI staff. Each has a job description, a memory and a daily schedule, all kept as files in GitHub. Their work comes to you as a change to approve. Open source, works with any coding agent.";

export const metadata: Metadata = {
  metadataBase: new URL("https://roster.nanocollective.org"),
  title,
  description,
  openGraph: { title, description, type: "website" },
  twitter: { card: "summary_large_image", title, description },
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#1b1b1b" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The theme on <html> as well as the provider, so its tokens reach the page's own background.
    <html lang="en" data-astryx-theme="neutral" className={`${figtree.variable} ${mono.variable}`}>
      <body className="font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
