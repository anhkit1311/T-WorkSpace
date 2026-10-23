import type { SVGProps } from "react";
import "./t-workspace-logo.css";

export interface TdtuGraduationLogoProps extends SVGProps<SVGSVGElement> {
  size?: "sm" | "md" | "lg" | "xl";
  showTagline?: boolean;
  tagline?: string;
  themeMode?: "light" | "dark" | "auto";
}

const SCALE_MAP = {
  sm: 0.6,
  md: 0.85,
  lg: 1.0,
  xl: 1.3,
};

/**
 * Logo Đồ án Tốt nghiệp T-WorkSpace · Đại học Tôn Đức Thắng (TDTU)
 * Kết hợp chuẩn xác biểu trưng TDTU huyền thoại với bộ nhận diện đồ án T-WorkSpace.
 */
export function TdtuGraduationLogo({
  size = "md",
  showTagline = true,
  tagline = "ĐỒ ÁN TỐT NGHIỆP CNTT · ĐẠI HỌC TÔN ĐỨC THẮNG",
  className = "",
  ...props
}: TdtuGraduationLogoProps) {
  const scale = SCALE_MAP[size];
  const width = Math.round(520 * scale);
  const height = Math.round((showTagline ? 280 : 210) * scale);

  return (
    <svg
      viewBox={showTagline ? "0 0 520 280" : "0 0 520 210"}
      width={width}
      height={height}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Logo Đồ Án Tốt Nghiệp T-WorkSpace - TDTU"
      className={`tdtu-graduation-logo ${className}`.trim()}
      {...props}
    >
      <defs>
        <linearGradient id="tdtuGradBlue" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1E40AF" />
          <stop offset="60%" stopColor="#2563EB" />
          <stop offset="100%" stopColor="#0284C7" />
        </linearGradient>
        <linearGradient id="tdtuGradRed" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#BE123C" />
          <stop offset="60%" stopColor="#E11D48" />
          <stop offset="100%" stopColor="#F43F5E" />
        </linearGradient>
      </defs>

      {/* TDTU Iconic Mark */}
      <g transform="translate(45, 10)">
        {/* T1 */}
        <path
          d="M 40 92.5 L 143 92.5 L 125 132.5 L 108 132.5 L 85 184.5 L 40 184.5 L 63 132.5 L 22 132.5 Z"
          fill="url(#tdtuGradBlue)"
        />
        {/* D */}
        <path
          d="M 163 54.5 L 272 54.5 C 282 54.5 285.5 63 285.5 73 C 285.5 81 281.5 89 276.5 100 L 242 173 C 235 186 224 189.5 210 189.5 L 104 189.5 L 121 150.5 L 206 150.5 C 215 150.5 221 147 225 137 L 233.5 117 C 236.5 109 234.5 93.5 215 93.5 L 189 93.5 L 171.5 132.5 L 130.5 132.5 L 147.5 93.5 Z"
          fill="url(#tdtuGradRed)"
        />
        {/* T2 */}
        <path
          d="M 268 16.5 L 402.5 16.5 L 384 54.5 L 360 54.5 L 316 151.5 L 274 151.5 L 314 54.5 L 253 54.5 Z"
          fill="url(#tdtuGradBlue)"
        />
      </g>

      {/* Typography */}
      {showTagline && (
        <>
          <text
            x="260"
            y="230"
            fontFamily="'Be Vietnam Pro', system-ui, -apple-system, sans-serif"
            fontSize="24"
            fontWeight="900"
            textAnchor="middle"
            letterSpacing="-0.3"
          >
            <tspan fill="#2563EB">T-</tspan>
            <tspan fill="#0F172A">WorkSpace</tspan>
          </text>
          <text
            x="260"
            y="256"
            fontFamily="'Be Vietnam Pro', system-ui, -apple-system, sans-serif"
            fontSize="12"
            fontWeight="700"
            fill="#64748B"
            textAnchor="middle"
            letterSpacing="2.2"
          >
            {tagline}
          </text>
        </>
      )}
    </svg>
  );
}
