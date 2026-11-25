import { cn } from "../lib/utils";

export interface TWorkSpaceLogoProps {
  size?: "sm" | "md" | "lg";
  showText?: boolean;
  className?: string;
}

/** Height of the TDTU mark (public/tdtu-mark.png, 1.8:1) per lockup size. */
const MARK_HEIGHTS = { sm: 24, md: 30, lg: 40 };
const TEXT_SIZES = { sm: "text-[19px]", md: "text-[22px]", lg: "text-[28px]" };

/** T-WorkSpace lockup: the official TDTU "TDT" mark beside the product name. */
export function TWorkSpaceLogo({
  size = "md",
  showText = true,
  className = "",
}: TWorkSpaceLogoProps) {
  const height = MARK_HEIGHTS[size];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-[.6rem] align-middle leading-none whitespace-nowrap text-foreground no-underline select-none",
        size === "lg" && "gap-[.8rem]",
        className,
      )}
    >
      <img
        src="/tdtu-mark.png"
        alt={showText ? "" : "T-WorkSpace · Đại học Tôn Đức Thắng"}
        width={Math.round(height * 1.8)}
        height={height}
        className="block w-auto flex-none object-contain"
        decoding="async"
      />
      {showText && (
        <span
          className={cn(
            "inline-flex items-baseline font-extrabold tracking-[-.035em]",
            TEXT_SIZES[size],
          )}
        >
          <span className="text-[#15479c] dark:text-[#6e9bff]">T-</span>
          <span className="text-foreground">WorkSpace</span>
        </span>
      )}
    </span>
  );
}
