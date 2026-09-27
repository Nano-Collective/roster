import type { NextConfig } from "next";

// A static export: Cloudflare Pages serves `out/` as plain files, no server or adapter needed.
const config: NextConfig = {
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
  agentRules: false,
};

export default config;
