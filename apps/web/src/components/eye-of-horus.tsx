/** The wedjat: brow, almond eye, pupil, and the falcon-cheek teardrop and spiral. Drawn in currentColor. */
export function EyeOfHorusIcon({ className }: { className?: string }) {
  return <svg className={className} viewBox="0 0 64 40" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6 7 Q30 1 58 7" />
    <path d="M5 18 C16 8 38 7 50 15 L61 15" />
    <path d="M9 19 C20 26 38 26 49 18" />
    <circle cx="29" cy="16.5" r="5" fill="currentColor" stroke="none" />
    <path d="M23 24 L21 37" />
    <path d="M34 24 C35 32 43 35 46 31 C48 28 44 25.5 42 28.5" />
  </svg>;
}

/** Icon plus wordmark, used on the welcome page and over the globe. */
export default function EyeOfHorusBrand({ className }: { className?: string }) {
  return <span className={`brand${className ? ` ${className}` : ""}`}>
    <EyeOfHorusIcon className="brand-icon" />
    <span className="brand-name">Eye of Horus</span>
  </span>;
}
