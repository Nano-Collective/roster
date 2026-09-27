import { ImageResponse } from "next/og";

export const dynamic = "force-static";
export const alt = "Roster — hire staff whose brain is a repo";
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
        color: "#1d1d1f",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            background: "#34c759",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#ffffff",
            fontSize: 34,
            fontWeight: 700,
          }}
        >
          r
        </div>
        <div style={{ fontSize: 40, fontWeight: 600, letterSpacing: -1 }}>Roster</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 84, fontWeight: 700, letterSpacing: -4, lineHeight: 1.02 }}>
          Hire staff whose
        </div>
        <div
          style={{
            fontSize: 84,
            fontWeight: 700,
            letterSpacing: -4,
            lineHeight: 1.02,
            color: "#1d1d1f",
          }}
        >
          brain is a repo.
        </div>
        <div style={{ marginTop: 28, fontSize: 28, color: "#6e6e73" }}>
          An agent-run org, powered by GitHub. Any coding agent. Open source.
        </div>
      </div>
      <div
        style={{
          display: "flex",
          fontSize: 26,
          color: "#1d1d1f",
          fontFamily: "monospace",
          background: "#f2f2f7",
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
