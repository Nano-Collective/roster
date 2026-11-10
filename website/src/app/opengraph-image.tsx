import { ImageResponse } from "next/og";

export const dynamic = "force-static";
export const alt = "Roster — run your org on AI staff";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OG() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 80,
        background: "#ffffff",
        color: "#000000",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        {/* The mark in the light theme's accent, as the site draws it. */}
        <svg width="56" height="56" viewBox="0 0 32 32">
          <rect width="32" height="32" rx="8" fill="#1b1b1b" />
          <path
            d="M11 23V10h6a4 4 0 0 1 0 8h-6m6 0 4.5 5"
            fill="none"
            stroke="#ffffff"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div style={{ fontSize: 40, fontWeight: 600, letterSpacing: -1 }}>Roster</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 84, fontWeight: 700, letterSpacing: -4, lineHeight: 1.02 }}>
          Run your org on
        </div>
        <div
          style={{
            fontSize: 84,
            fontWeight: 700,
            letterSpacing: -4,
            lineHeight: 1.02,
            color: "#000000",
          }}
        >
          AI staff.
        </div>
        <div style={{ marginTop: 28, fontSize: 28, color: "#474747" }}>
          Every job written down in GitHub. Any coding agent. Open source.
        </div>
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 26,
          color: "#000000",
          fontFamily: "monospace",
          background: "#f1f1f1",
          borderRadius: 999,
          padding: "14px 22px",
          alignSelf: "flex-start",
        }}
      >
        npx @nanocollective/roster
      </div>
    </div>,
    size,
  );
}
