type P = { className?: string };
const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const Github = ({ className }: P) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.04 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.58.23 2.75.11 3.04.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
  </svg>
);
export const Arrow = ({ className }: P) => (
  <svg className={className} viewBox="0 0 24 24" {...base} aria-hidden="true">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);
export const Copy = ({ className }: P) => (
  <svg className={className} viewBox="0 0 24 24" {...base} aria-hidden="true">
    <rect x="9" y="9" width="11" height="11" rx="2.5" />
    <path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15" />
  </svg>
);
export const Check = ({ className }: P) => (
  <svg className={className} viewBox="0 0 24 24" {...base} strokeWidth={2} aria-hidden="true">
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);
export const Brain = ({ className }: P) => (
  <svg className={className} viewBox="0 0 24 24" {...base} aria-hidden="true">
    <path d="M6 3h9l3 3v15H6z" />
    <path d="M15 3v3h3M9 11h6M9 15h6M9 7h3" />
  </svg>
);
export const Clock = ({ className }: P) => (
  <svg className={className} viewBox="0 0 24 24" {...base} aria-hidden="true">
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);
export const Layers = ({ className }: P) => (
  <svg className={className} viewBox="0 0 24 24" {...base} aria-hidden="true">
    <path d="m12 3 9 5-9 5-9-5 9-5Z" />
    <path d="m3 13 9 5 9-5" />
  </svg>
);
export const Shield = ({ className }: P) => (
  <svg className={className} viewBox="0 0 24 24" {...base} aria-hidden="true">
    <path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);
export const Pulse = ({ className }: P) => (
  <svg className={className} viewBox="0 0 24 24" {...base} aria-hidden="true">
    <path d="M3 12h4l2.5-6 5 12L17 12h4" />
  </svg>
);
export const Branch = ({ className }: P) => (
  <svg className={className} viewBox="0 0 24 24" {...base} aria-hidden="true">
    <circle cx="6" cy="5" r="2" />
    <circle cx="6" cy="19" r="2" />
    <circle cx="18" cy="8" r="2" />
    <path d="M6 7v10M18 10c0 4-6 3-11.5 7.5" />
  </svg>
);
export const Inbox = ({ className }: P) => (
  <svg className={className} viewBox="0 0 24 24" {...base} aria-hidden="true">
    <path d="M3 13h5l1.5 3h5L16 13h5" />
    <path d="M5.5 5h13L21 13v6H3v-6z" />
  </svg>
);
export const At = ({ className }: P) => (
  <svg className={className} viewBox="0 0 24 24" {...base} aria-hidden="true">
    <circle cx="12" cy="12" r="3.5" />
    <path d="M15.5 12v1.5a2.5 2.5 0 0 0 5 0V12a8.5 8.5 0 1 0-3.5 6.9" />
  </svg>
);
export const Chevron = ({ className }: P) => (
  <svg className={className} viewBox="0 0 24 24" {...base} strokeWidth={2.2} aria-hidden="true">
    <path d="m9 5 7 7-7 7" />
  </svg>
);
