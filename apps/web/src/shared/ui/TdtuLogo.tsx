import type { SVGProps } from "react";

export function TdtuLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 120 40"
      height="30"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="TDTU"
      className="tdtu-logo"
      {...props}
    >
      {/* TDTU stylized typography */}
      <g fontStyle="italic" fontWeight="900" fontFamily="system-ui, -apple-system, sans-serif">
        {/* Red accent ribbon / top swoosh of the first T */}
        <path
          d="M 6 12 Q 18 10, 32 10 L 29 15 Q 16 15, 9 16 Z"
          fill="#DC2626"
        />
        {/* First T in deep blue */}
        <path
          d="M 12 10 L 32 10 L 30 15 L 23 15 L 18 32 L 12 32 L 17 15 L 12 15 Z"
          fill="currentColor"
        />
        {/* Red accent dot / diamond on top */}
        <path
          d="M 28 6 L 36 6 L 33 10 L 25 10 Z"
          fill="#DC2626"
        />
        {/* D letter */}
        <path
          d="M 33 10 L 44 10 Q 55 10, 52 21 Q 50 32, 38 32 L 27 32 L 33 10 Z M 35 27 L 40 27 Q 46 27, 47 21 Q 48 15, 42 15 L 38 15 Z"
          fill="currentColor"
        />
        {/* Second T letter */}
        <path
          d="M 48 10 L 68 10 L 66 15 L 59 15 L 54 32 L 48 32 L 53 15 L 48 15 Z"
          fill="currentColor"
        />
        {/* U letter */}
        <path
          d="M 67 10 L 73 10 L 70 23 Q 68 28, 73 28 Q 78 28, 80 23 L 83 10 L 89 10 L 85 23 Q 82 32, 72 32 Q 63 32, 65 23 Z"
          fill="currentColor"
        />
      </g>
    </svg>
  );
}
