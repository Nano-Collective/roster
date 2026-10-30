"use client";

import { useState } from "react";
import { Check, Copy } from "./Icons";
import { SKILL_LINE } from "./links";

export function CopyCommand({ size = "lg" }: { size?: "lg" | "sm" }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(SKILL_LINE);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be refused (insecure context, permissions); the command is on screen anyway.
    }
  };

  const lg = size === "lg";
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy ${SKILL_LINE}`}
      title="Paste into Claude Code, Codex or any coding agent on your computer"
      className={`inline-flex max-w-full items-center rounded-2xl bg-fill sm:rounded-full font-mono text-fg transition hover:bg-fill-2 active:opacity-70 ${
        lg ? "min-h-11 gap-2.5 py-2 pl-5 pr-4 text-[13px] sm:text-[14px]" : "h-8 gap-2.5 pl-3.5 pr-3 text-[12px]"
      }`}
    >
      {/* Shown without the scheme, and wrapping on a phone rather than cutting off the file name.
          The copied line keeps the scheme. */}
      <span className="min-w-0 text-left sm:whitespace-nowrap">{SKILL_LINE.replace("https://", "")}</span>
      {copied ? (
        <Check className="size-4 shrink-0 text-accent" />
      ) : (
        <Copy className="size-4 shrink-0 text-fg-2" />
      )}
    </button>
  );
}
