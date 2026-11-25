import { useEffect, useRef, useState } from "react";
import { Popover } from "radix-ui";
import { Icon } from "../../shared/ui/Icon";
import { cn } from "../../shared/lib/utils";

// Above the modal (--z-modal: 300) that holds these fields.
const POP =
  "motion-pop z-[400] rounded-xl border bg-card text-sm text-foreground shadow-[0_16px_40px_rgba(0,0,0,.14)] outline-none";
const TRIGGER =
  "flex h-[38px] w-full cursor-pointer items-center gap-2 rounded-lg border bg-card px-3 text-left text-sm text-foreground outline-none hover:bg-secondary/50 focus-visible:border-foreground data-[state=open]:border-foreground data-[state=open]:ring-3 data-[state=open]:ring-foreground/10";
const WEEKDAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];
const DAY_NAMES = ["Chủ nhật", "Thứ Hai", "Thứ Ba", "Thứ Tư", "Thứ Năm", "Thứ Sáu", "Thứ Bảy"];

const pad = (value: number) => String(value).padStart(2, "0");
/** "YYYY-MM-DD" of a local date. */
export const isoDay = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const parseDay = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
};
const toMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
const length = (minutes: number) =>
  minutes < 60 ? `${minutes} phút` : `${String(minutes / 60).replace(".", ",")} giờ`;
/** Stops Escape at the popover so the dialog around it stays open. */
const keepDialog = (event: KeyboardEvent) => event.stopPropagation();

/** A month calendar in a popover: Monday first, past days dimmed, days with meetings dotted. */
export function DatePicker({
  value,
  onChange,
  marked,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  /** "YYYY-MM-DD" days that already have a meeting. */
  marked?: Set<string>;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseDay(value);
  const [month, setMonth] = useState(() => new Date(selected.getFullYear(), selected.getMonth()));
  const today = isoDay(new Date());
  // Six weeks from the Monday on or before the 1st.
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const startOffset = (first.getDay() + 6) % 7;
  const cells = Array.from(
    { length: 42 },
    (_, index) => new Date(month.getFullYear(), month.getMonth(), index - startOffset + 1),
  );
  const pick = (date: Date) => {
    onChange(isoDay(date));
    setOpen(false);
  };
  const shift = (days: number) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    pick(date);
  };
  const nextMonday = (8 - new Date().getDay()) % 7 || 7;

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setMonth(new Date(selected.getFullYear(), selected.getMonth()));
        setOpen(next);
      }}
    >
      <Popover.Trigger type="button" className={TRIGGER} aria-label={label}>
        <Icon name="calendar" size={15} className="text-muted-foreground" />
        <span className="truncate">
          {DAY_NAMES[selected.getDay()]}, {pad(selected.getDate())}/{pad(selected.getMonth() + 1)}/
          {selected.getFullYear()}
        </span>
        <Icon name="chevron-down" size={14} className="ml-auto text-muted-foreground" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className={cn(POP, "tw w-[300px] p-3")}
          onEscapeKeyDown={keepDialog}
        >
          <div className="mb-2 flex items-center gap-1">
            <b className="flex-1 pl-1 text-sm font-semibold">
              Tháng {month.getMonth() + 1}, {month.getFullYear()}
            </b>
            {(
              [
                [-1, "chevron-left", "Tháng trước"],
                [1, "chevron-right", "Tháng sau"],
              ] as const
            ).map(([step, icon, name]) => (
              <button
                key={step}
                type="button"
                className="grid size-[30px] cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
                aria-label={name}
                onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + step))}
              >
                <Icon name={icon} size={16} />
              </button>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center" role="grid">
            {WEEKDAYS.map((day) => (
              <span key={day} className="py-1 text-[11.5px] font-semibold text-muted-foreground">
                {day}
              </span>
            ))}
            {cells.map((date) => {
              const key = isoDay(date);
              const outside = date.getMonth() !== month.getMonth();
              const isSelected = key === value;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={isSelected}
                  aria-label={`${DAY_NAMES[date.getDay()]} ${date.getDate()}/${date.getMonth() + 1}`}
                  className={cn(
                    "relative h-9 cursor-pointer rounded-lg text-[13.5px] tabular-nums hover:bg-secondary",
                    outside && "opacity-40",
                    key < today && "text-muted-foreground",
                    key === today &&
                      "font-semibold text-[#2f6bff] ring-[1.5px] ring-[#2f6bff] ring-inset",
                    isSelected && "bg-foreground! font-semibold text-background! ring-0",
                  )}
                  onClick={() => pick(date)}
                >
                  {date.getDate()}
                  {marked?.has(key) && (
                    <i
                      className={cn(
                        "absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full",
                        isSelected ? "bg-background" : "bg-[#2f6bff]",
                      )}
                    />
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5 border-t pt-2.5">
            {(
              [
                [0, "Hôm nay"],
                [1, "Ngày mai"],
                [nextMonday, "Thứ Hai tới"],
              ] as const
            ).map(([days, name]) => (
              <button
                key={name}
                type="button"
                className="cursor-pointer rounded-full border px-2.5 py-1 text-[12.5px] hover:bg-secondary"
                onClick={() => shift(days)}
              >
                {name}
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/**
 * A time field that also takes typing, with a 15-minute list under it. Given `from`, the list
 * shows each choice's length and dims the times not after it (the end of a meeting).
 */
export function TimePicker({
  value,
  onChange,
  label,
  from,
  invalid = false,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  from?: string;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => setDraft(value), [value]);
  // Bring the current time into view when the list opens.
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() =>
      list.current
        ?.querySelector<HTMLElement>("[aria-selected=true]")
        ?.scrollIntoView({ block: "center" }),
    );
    return () => cancelAnimationFrame(frame);
  }, [open]);
  const slots = Array.from(
    { length: 96 },
    (_, index) => `${pad(index >> 2)}:${pad((index % 4) * 15)}`,
  );
  const commit = (text: string) => {
    const match = /^(\d{1,2}):?(\d{2})$/.exec(text.trim());
    if (match && Number(match[1]) < 24 && Number(match[2]) < 60)
      onChange(`${pad(Number(match[1]))}:${match[2]}`);
    else setDraft(value);
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <label
          className={cn(
            "flex! h-[38px] w-full cursor-text items-center gap-2 rounded-lg border bg-card px-3 text-sm! text-foreground! focus-within:border-foreground focus-within:ring-3 focus-within:ring-foreground/10",
            invalid && "border-destructive!",
          )}
        >
          <Icon name="clock" size={15} className="shrink-0 text-muted-foreground" />
          <input
            className="w-0 min-w-0 flex-1 border-0! bg-transparent! p-0! text-sm! tabular-nums outline-none"
            aria-label={label}
            inputMode="numeric"
            value={draft}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={(event) => commit(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit(draft);
                setOpen(false);
              }
            }}
          />
        </label>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className={cn(POP, "tw w-(--radix-popover-trigger-width) min-w-[170px] p-1")}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={keepDialog}
        >
          <div
            ref={list}
            className="max-h-[260px] overflow-y-auto"
            role="listbox"
            aria-label={label}
          >
            {slots.map((slot) => {
              const gap = from ? toMinutes(slot) - toMinutes(from) : null;
              const isSelected = slot === value;
              return (
                <button
                  key={slot}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={cn(
                    "flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-[7px] text-[13.5px] tabular-nums hover:bg-secondary",
                    gap !== null && gap <= 0 && "opacity-45",
                    isSelected && "bg-foreground! font-semibold text-background",
                  )}
                  onClick={() => {
                    onChange(slot);
                    setOpen(false);
                  }}
                >
                  {slot}
                  {gap !== null && gap > 0 && (
                    <small
                      className={cn(
                        "ml-auto text-xs",
                        isSelected ? "text-background/70" : "text-muted-foreground",
                      )}
                    >
                      {length(gap)}
                    </small>
                  )}
                  {isSelected && <Icon name="check" size={14} className={cn(!gap && "ml-auto")} />}
                </button>
              );
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
