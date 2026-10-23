import type { SVGProps } from "react";
import { TdtuLogo } from "./TdtuLogo";
import "./t-workspace-logo.css";

export interface TWorkSpaceMarkProps extends SVGProps<SVGSVGElement> {
  size?: number;
}

/**
 * T-WorkSpace Modern App Badge (Phương án 3):
 * - Khung Squircle hiện đại thích ứng Light/Dark mode
 * - Biểu trưng TDTU huyền thoại được renew toán học sắc nét: T1 (blue), D (red), T2 (blue)
 */
export function TWorkSpaceMark({ size = 32, className = "", ...props }: TWorkSpaceMarkProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="T-WorkSpace App Badge · TDTU"
      className={`t-workspace-logo__mark ${className}`.trim()}
      {...props}
    >
      <defs>
        <linearGradient id="sqBlueGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#15479C" />
          <stop offset="100%" stopColor="#2563EB" />
        </linearGradient>
        <linearGradient id="sqRedGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#DC2626" />
          <stop offset="100%" stopColor="#EF4444" />
        </linearGradient>
      </defs>

      {/* Modern Squircle Base with Light/Dark CSS Theme adaptation */}
      <rect
        width="64"
        height="64"
        rx="16"
        className="t-workspace-badge__bg"
        strokeWidth="1.5"
      />

      {/* Centered TDT Renewed Vector Mark */}
      <g transform="translate(7.75, 19) scale(0.126)">
        {/* T1 */}
        <path
          d="M 20 92.5 L 123 92.5 L 105 132.5 L 88 132.5 L 65 184.5 L 20 184.5 L 43 132.5 L 2 132.5 Z"
          fill="url(#sqBlueGrad)"
        />
        {/* D */}
        <path
          d="M 143 54.5 L 252 54.5 C 262 54.5 265.5 63 265.5 73 C 265.5 81 261.5 89 256.5 100 L 222 173 C 215 186 204 189.5 190 189.5 L 84 189.5 L 101 150.5 L 186 150.5 C 195 150.5 201 147 205 137 L 213.5 117 C 216.5 109 214.5 93.5 195 93.5 L 169 93.5 L 151.5 132.5 L 110.5 132.5 L 127.5 93.5 Z"
          fill="url(#sqRedGrad)"
        />
        {/* T2 */}
        <path
          d="M 248 16.5 L 382.5 16.5 L 364 54.5 L 340 54.5 L 296 151.5 L 254 151.5 L 294 54.5 L 233 54.5 Z"
          fill="url(#sqBlueGrad)"
        />
      </g>
    </svg>
  );
}

export interface TWorkSpaceLogoProps {
  size?: "sm" | "md" | "lg";
  variant?: "badge" | "raw";
  showMark?: boolean;
  showText?: boolean;
  showTagline?: boolean;
  taglineText?: string;
  className?: string;
}

const MARK_SIZES = {
  sm: 28,
  md: 34,
  lg: 48,
};

const RAW_HEIGHTS = {
  sm: 20,
  md: 24,
  lg: 32,
};

/**
 * T-WorkSpace full brand lockup:
 * Option 3 App Badge + "T-WorkSpace" typography with theme auto-detection.
 */
export function TWorkSpaceLogo({
  size = "md",
  variant = "badge",
  showMark = true,
  showText = true,
  showTagline = false,
  taglineText = "Đồ án tốt nghiệp · TDTU",
  className = "",
}: TWorkSpaceLogoProps) {
  const markSize = MARK_SIZES[size];
  const rawHeight = RAW_HEIGHTS[size];

  return (
    <span
      className={`t-workspace-logo t-workspace-logo--${size} ${className}`.trim()}
      aria-label="T-WorkSpace"
    >
      {showMark &&
        (variant === "raw" ? (
          <TdtuLogo height={rawHeight} />
        ) : (
          <TWorkSpaceMark size={markSize} />
        ))}
      {showText && (
        <span className="t-workspace-logo__text-wrap">
          <span className="t-workspace-logo__text">
            <span className="t-workspace-logo__prefix">T-</span>
            <span className="t-workspace-logo__name">WorkSpace</span>
          </span>
          {showTagline && <span className="t-workspace-logo__tagline">{taglineText}</span>}
        </span>
      )}
    </span>
  );
}

// Aliases and related exports
export { TdtuGraduationLogo } from "./TdtuGraduationLogo";
export { TdtuLogo } from "./TdtuLogo";
export const NexoMark = TWorkSpaceMark;
export const NexoLogo = TWorkSpaceLogo;
