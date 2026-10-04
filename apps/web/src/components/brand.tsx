/** Working name; change it here (and in app/layout.tsx metadata) if it changes. */
export const PRODUCT_NAME = "Eye of Horus";

/**
 * A simplified wedjat (Eye of Horus): brow, almond eye with iris, and the drop and curl
 * beneath. Line art in currentColor, so it takes the surrounding text colour.
 */
export function BrandMark({ size = 22 }: { size?: number }) {
  return <svg className="brand-mark" viewBox="0 0 64 40" width={size * 1.6} height={size} aria-hidden="true"
    fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9 Q30 1 58 7" />
    <path d="M6 20 Q30 6 54 18 Q32 30 6 20 Z" />
    <circle cx="29" cy="18.5" r="5" fill="currentColor" stroke="none" />
    <path d="M54 18 H62" />
    <path d="M24 26 L21 37" />
    <path d="M34 26 Q39 36 46 33 Q50 30 46 28" />
  </svg>;
}

/** Mark plus name. `size` sets the mark height; the name scales with it via CSS. */
export function Wordmark({ size = 18, className = "" }: { size?: number; className?: string }) {
  return <span className={`wordmark ${className}`.trim()} style={{ fontSize: Math.round(size * 0.8) }}>
    <BrandMark size={size} />
    <span>{PRODUCT_NAME}</span>
  </span>;
}
