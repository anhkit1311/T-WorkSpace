/** Class strings shared by the tabs of "Tổng đài". */
export const LED = "size-2 shrink-0 rounded-full";
export const DOT: Record<string, string> = {
  green: "bg-emerald-500",
  red: "bg-red-500",
  amber: "bg-amber-500",
  blue: "bg-[#2f6bff]",
  neutral: "bg-zinc-300",
};
export const TINT: Record<string, string> = {
  violet: "bg-[var(--tint-violet-bg)] text-[var(--tint-violet-fg)]",
  green: "bg-[var(--tint-green-bg)] text-[var(--tint-green-fg)]",
  red: "bg-[var(--tint-red-bg)] text-[var(--tint-red-fg)]",
  amber: "bg-[var(--tint-amber-bg)] text-[var(--tint-amber-fg)]",
  blue: "bg-[var(--tint-blue-bg)] text-[var(--tint-blue-fg)]",
  neutral: "bg-secondary text-muted-foreground",
};
export const TEXT: Record<string, string> = {
  green: "text-emerald-600",
  red: "text-red-600",
  amber: "text-amber-600",
  blue: "text-[#2f6bff]",
};
export const CARD =
  "tw grid min-w-0 gap-2.5 rounded-[10px] border bg-card p-3.5 text-sm text-foreground";
export const H2 = "text-[15px] font-semibold";
export const MUTED = "text-[13px] text-muted-foreground";
export const STAT = "text-[17px] leading-tight font-bold tabular-nums";
export const CHIP =
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap";
export const PILL =
  "cursor-pointer rounded-full border px-[11px] py-1 text-[12.5px] text-muted-foreground hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-60";
export const PILL_ON = "border-foreground bg-foreground text-background hover:bg-foreground";
export const BTN =
  "inline-flex h-[34px] shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50";
export const BTN_PRIMARY = `${BTN} bg-primary text-primary-foreground hover:bg-primary/90`;
export const BTN_GHOST = `${BTN} border bg-card text-foreground hover:bg-secondary`;
export const ICON_BTN =
  "grid size-8 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-card hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40";
export const CTL =
  "grid w-[78px] cursor-pointer justify-items-center gap-1.5 rounded-[10px] bg-secondary px-1 py-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50";
export const CTL_ON = "bg-[var(--tint-blue-bg)] text-[var(--tint-blue-fg)]";

export const FIELD = "h-[34px]! py-0! text-[13px]!";
export const TABLE =
  "w-full border-collapse text-[13.5px] [&_td]:border-b [&_td]:px-3 [&_td]:py-2 [&_td]:align-middle [&_th]:border-b [&_th]:bg-background [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:whitespace-nowrap [&_th]:text-muted-foreground [&_tbody_tr:last-child_td]:border-b-0";
export const PANEL =
  "tw min-w-0 overflow-hidden rounded-[10px] border bg-card text-sm text-foreground";
export const PANEL_HEAD = "flex flex-wrap items-center gap-2.5 border-b px-4 py-3";

/** The live strip under the header (a call, a meeting in progress). */
export const STRIP_ITEM =
  "flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-lg px-3 py-1.5 text-[13px]";
export const STRIP_DOT =
  "size-2 shrink-0 rounded-full bg-current shadow-[0_0_0_4px_color-mix(in_srgb,currentColor_20%,transparent)]";
export const STRIP_BTN =
  "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border bg-card px-2.5 text-[12.5px] font-semibold whitespace-nowrap text-foreground hover:bg-secondary";
