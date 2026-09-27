"use client";

import { useState } from "react";
import { Check, Copy } from "./Icons";
import { COMMAND } from "./links";

export function CopyCommand({ size = "lg" }: { size?: "lg" | "sm" }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(COMMAND);
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
      aria-label={`Copy ${COMMAND}`}
      className={`inline-flex items-center gap-2.5 rounded-full bg-fill font-mono text-fg transition hover:bg-fill-2 active:opacity-70 ${
        lg ? "h-11 pl-5 pr-4 text-[14px]" : "h-8 pl-3.5 pr-3 text-[12px]"
      }`}
    >
      <span className="whitespace-nowrap">{COMMAND}</span>
      {copied ? (
        <Check className="size-4 text-accent" />
      ) : (
        <Copy className="size-4 text-fg-2" />
      )}
    </button>
  );
}
