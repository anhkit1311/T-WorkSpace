import type { SVGProps } from "react";
import "./nexo-logo.css";

/**
 * TDT Brand mark with deep blue #1D4ED8 and red accent #DC2626
 * Matching the exact TDT mark on the top-left of TDTU Internal Portal.
 */
export function NexoMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 70 30"
      height="26"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="TDT"
      {...props}
    >
      <g fontStyle="italic" fontWeight="900" fontFamily="system-ui, -apple-system, sans-serif">
        {/* Red accent ribbon / top swoosh of the first T */}
        <path d="M 3 8 Q 13 6, 25 6 L 22 10 Q 12 10, 6 11 Z" fill="#DC2626" />
        {/* First T in blue #1D4ED8 */}
        <path d="M 7 7 L 25 7 L 23 11 L 18 11 L 13 25 L 8 25 L 13 11 L 7 11 Z" fill="#1D4ED8" />
        {/* Red accent dot on top */}
        <path d="M 21 3 L 28 3 L 25 7 L 18 7 Z" fill="#DC2626" />
        {/* D letter */}
        <path d="M 25 7 L 35 7 Q 44 7, 42 16 Q 40 25, 30 25 L 21 25 L 25 7 Z M 27 21 L 31 21 Q 36 21, 37 16 Q 38 11, 33 11 L 29 11 Z" fill="#1D4ED8" />
        {/* Second T letter */}
        <path d="M 39 7 L 56 7 L 54 11 L 49 11 L 44 25 L 39 25 L 44 11 L 39 11 Z" fill="#1D4ED8" />
      </g>
    </svg>
  );
}

export function NexoLogo() {
  return (
    <span className="nexo-lockup tdtu-brand-lockup" aria-label="TDTU">
      <NexoMark className="tdtu-brand-mark" />
    </span>
  );
}
