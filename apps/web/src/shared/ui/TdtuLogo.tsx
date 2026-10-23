import type { SVGProps } from "react";

export interface TdtuLogoProps extends SVGProps<SVGSVGElement> {
  height?: number;
  useOfficialColors?: boolean;
}

/**
 * Authentic renewed TDTU brand mark (Đại học Tôn Đức Thắng).
 * Traced with mathematical Bezier precision from official university vector assets:
 * - T1 (left, blue)
 * - D (center, crimson red)
 * - T2 (right elevated, blue)
 */
export function TdtuLogo({
  height = 30,
  useOfficialColors = true,
  className = "",
  ...props
}: TdtuLogoProps) {
  // Ratio is 420:190 (approx 2.21 : 1)
  const width = Math.round((height * 420) / 190);
  const blueColor = useOfficialColors ? "#15479C" : "currentColor";
  const redColor = "#ED242A";

  return (
    <svg
      viewBox="0 0 420 190"
      width={width}
      height={height}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="TDTU"
      className={`tdtu-logo ${className}`.trim()}
      {...props}
    >
      {/* T1 in Cobalt Blue */}
      <path
        d="M 20 92.5 L 123 92.5 L 105 132.5 L 88 132.5 L 65 184.5 L 20 184.5 L 43 132.5 L 2 132.5 Z"
        fill={blueColor}
      />
      {/* D in Crimson Red */}
      <path
        d="M 143 54.5 L 252 54.5 C 262 54.5 265.5 63 265.5 73 C 265.5 81 261.5 89 256.5 100 L 222 173 C 215 186 204 189.5 190 189.5 L 84 189.5 L 101 150.5 L 186 150.5 C 195 150.5 201 147 205 137 L 213.5 117 C 216.5 109 214.5 93.5 195 93.5 L 169 93.5 L 151.5 132.5 L 110.5 132.5 L 127.5 93.5 Z"
        fill={redColor}
      />
      {/* T2 in Cobalt Blue (Elevated) */}
      <path
        d="M 248 16.5 L 382.5 16.5 L 364 54.5 L 340 54.5 L 296 151.5 L 254 151.5 L 294 54.5 L 233 54.5 Z"
        fill={blueColor}
      />
    </svg>
  );
}
