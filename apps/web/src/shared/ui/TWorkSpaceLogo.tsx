import "./t-workspace-logo.css";

export interface TWorkSpaceLogoProps {
  size?: "sm" | "md" | "lg";
  showText?: boolean;
  className?: string;
}

/** Height of the TDTU mark (public/tdtu-mark.png, 1.8:1) per lockup size. */
const MARK_HEIGHTS = { sm: 24, md: 30, lg: 40 };

/** T-WorkSpace lockup: the official TDTU "TDT" mark beside the product name. */
export function TWorkSpaceLogo({ size = "md", showText = true, className = "" }: TWorkSpaceLogoProps) {
  const height = MARK_HEIGHTS[size];
  return (
    <span className={`t-workspace-logo t-workspace-logo--${size} ${className}`.trim()}>
      <img
        src="/tdtu-mark.png"
        alt={showText ? "" : "T-WorkSpace · Đại học Tôn Đức Thắng"}
        width={Math.round(height * 1.8)}
        height={height}
        className="t-workspace-logo__mark"
        decoding="async"
      />
      {showText && (
        <span className="t-workspace-logo__text">
          <span className="t-workspace-logo__prefix">T-</span>
          <span className="t-workspace-logo__name">WorkSpace</span>
        </span>
      )}
    </span>
  );
}
