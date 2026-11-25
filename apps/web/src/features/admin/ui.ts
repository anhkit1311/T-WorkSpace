/** Class strings shared by the tabs of "Quản trị hệ thống". */
export const CARD = "rounded-[10px] border bg-card";
export const TABLE_CARD = "min-w-0 overflow-hidden rounded-[10px] border bg-card";
export const CARD_HEAD = "flex flex-wrap items-center gap-2.5 border-b px-4 py-3";
export const H3 = "text-[15px] font-semibold";
export const MUTED = "text-[13px] text-muted-foreground";
export const TABLE =
  "w-full border-collapse text-[13.5px] [&_td]:border-b [&_td]:px-3 [&_td]:py-2 [&_td]:align-middle [&_th]:border-b [&_th]:bg-background [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:whitespace-nowrap [&_th]:text-muted-foreground [&_tbody_tr:hover_td]:bg-secondary [&_tbody_tr:last-child_td]:border-b-0";
export const CHIP =
  "inline-flex items-center gap-1.5 rounded-full bg-secondary px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap text-muted-foreground";
export const TINT = {
  blue: "bg-[var(--tint-blue-bg)] text-[var(--tint-blue-fg)]",
  green: "bg-[var(--tint-green-bg)] text-[var(--tint-green-fg)]",
  amber: "bg-[var(--tint-amber-bg)] text-[var(--tint-amber-fg)]",
  red: "bg-[var(--tint-red-bg)] text-[var(--tint-red-fg)]",
} as const;
export const BTN =
  "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-[7px] bg-primary px-3.5 text-[13.5px] font-semibold whitespace-nowrap text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50";
export const BTN_GHOST =
  "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-[7px] border bg-card px-3.5 text-[13.5px] font-semibold whitespace-nowrap hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50";
export const BTN_SM = "h-[30px] px-[11px] text-[13px]";
export const SEARCH =
  "flex h-[34px] items-center gap-2 rounded-full bg-secondary px-3 text-muted-foreground [&_input]:min-w-0 [&_input]:flex-1 [&_input]:bg-transparent [&_input]:text-[13px] [&_input]:text-foreground [&_input]:outline-none";
export const SEG = "flex w-max max-w-full flex-wrap rounded-[9px] bg-secondary p-[3px]";
export const SEG_BTN =
  "cursor-pointer rounded-[7px] px-3 py-[5px] text-[13px] font-medium text-muted-foreground aria-pressed:bg-card aria-pressed:font-semibold aria-pressed:text-foreground aria-pressed:shadow-sm";
export const CODE = "font-mono text-[12.5px]";
