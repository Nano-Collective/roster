export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" className="fill-accent-fill" />
      <path
        d="M11 23V10h6a4 4 0 0 1 0 8h-6m6 0 4.5 5"
        fill="none"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="inline-flex items-center gap-2">
      <Mark />
      <span className="text-[17px] font-semibold tracking-[-0.02em]">Roster</span>
    </span>
  );
}
