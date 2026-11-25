import {
  useEffect,
  useId,
  useRef,
  useState,
  useLayoutEffect,
  Children,
  cloneElement,
  isValidElement,
  type ButtonHTMLAttributes,
  type ComponentProps,
  type ReactNode,
} from "react";
import { motion, AnimatePresence, useIsPresent } from "motion/react";
import { useApp } from "../../app/providers/AppContext";
import { Icon, type IconName } from "./Icon";
import { initialsOf } from "./kit/user-avatar";
import { isSelectPickerEvent } from "../lib/select-picker";
import { toastDuration } from "../lib/interaction";
import "./interaction.css";
import { useControlMotion } from "../motion/useControlMotion";
import { useControlTooltip } from "../motion/ControlTooltip";
import { useMotionSafe } from "../motion/MotionProvider";
import { DURATION, EASE, SPRING } from "../motion/tokens";
import { useAnimate } from "motion/react";
import { cn } from "../lib/utils";

const BUTTON_BASE =
  "button tw inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-transparent font-semibold whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const BUTTON_SIZE = {
  sm: "h-[30px] px-2.5 text-[12.5px]",
  md: "h-9 px-3.5 text-[13.5px]",
  lg: "h-11 px-5 text-[14.5px]",
  icon: "size-9",
};
const BUTTON_VARIANT = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  secondary: "bg-secondary text-foreground hover:bg-accent",
  ghost: "border-border bg-card text-foreground hover:bg-secondary",
  danger: "bg-destructive text-white hover:bg-destructive/90",
  text: "px-1 text-muted-foreground hover:text-foreground",
  icon: "text-muted-foreground hover:bg-secondary hover:text-foreground",
  soft: "bg-[var(--tint-blue-bg)] text-[var(--tint-blue-fg)] hover:opacity-90",
};
const TONE = {
  neutral: "bg-secondary text-muted-foreground",
  blue: "bg-[var(--tint-blue-bg)] text-[var(--tint-blue-fg)]",
  green: "bg-[var(--tint-green-bg)] text-[var(--tint-green-fg)]",
  amber: "bg-[var(--tint-amber-bg)] text-[var(--tint-amber-fg)]",
  red: "bg-[var(--tint-red-bg)] text-[var(--tint-red-fg)]",
  violet: "bg-[var(--tint-violet-bg)] text-[var(--tint-violet-fg)]",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "text" | "icon" | "ghost" | "danger" | "soft";
  size?: "sm" | "md" | "lg" | "icon";
  icon?: IconName;
  loading?: boolean;
  /** Change only after a confirmed successful action. Does not infer success from loading=false. */
  successFlash?: unknown;
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  icon,
  loading = false,
  disabled,
  className = "",
  successFlash,
  ...props
}: ButtonProps) {
  const control = useControlMotion(Boolean(disabled || loading));
  const buttonRef = control.ref;
  const { reduced } = useMotionSafe();
  const lastSuccess = useRef(successFlash);
  const [, flash] = useAnimate<HTMLButtonElement>();
  useEffect(() => {
    if (lastSuccess.current !== successFlash && successFlash && buttonRef.current && !reduced) {
      void flash(buttonRef.current, { opacity: [1, 0.72, 1] }, { duration: DURATION.count });
    }
    lastSuccess.current = successFlash;
  }, [successFlash, reduced, flash, buttonRef]);
  const widthRef = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    if (loading || !buttonRef.current) return;
    const rememberWidth = () => {
      widthRef.current = buttonRef.current?.getBoundingClientRect().width;
    };
    rememberWidth();
    const observer = new ResizeObserver(rememberWidth);
    observer.observe(buttonRef.current);
    return () => observer.disconnect();
  }, [loading]);
  const resolvedSize = variant === "icon" ? "icon" : size;
  return (
    <button
      className={cn(BUTTON_BASE, BUTTON_SIZE[resolvedSize], BUTTON_VARIANT[variant], className)}
      disabled={disabled || loading}
      {...props}
      data-motion-control
      ref={control.setRef}
      onPointerEnter={(event) => {
        control.handlers.onPointerEnter(event);
        props.onPointerEnter?.(event);
      }}
      onPointerLeave={(event) => {
        control.handlers.onPointerLeave();
        props.onPointerLeave?.(event);
      }}
      onPointerDown={(event) => {
        control.handlers.onPointerDown();
        props.onPointerDown?.(event);
      }}
      onPointerUp={(event) => {
        control.handlers.onPointerUp();
        props.onPointerUp?.(event);
      }}
      onPointerCancel={(event) => {
        control.handlers.onPointerCancel();
        props.onPointerCancel?.(event);
      }}
      onBlur={(event) => {
        control.handlers.onBlur();
        props.onBlur?.(event);
      }}
      onKeyDown={(event) => {
        control.handlers.onKeyDown(event);
        props.onKeyDown?.(event);
      }}
      onKeyUp={(event) => {
        control.handlers.onKeyUp();
        props.onKeyUp?.(event);
      }}
      aria-busy={loading || undefined}
      style={
        loading && widthRef.current ? { ...props.style, width: widthRef.current } : props.style
      }
    >
      {loading ? (
        <svg
          className="animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          style={{
            width: resolvedSize === "sm" ? 14 : 16,
            height: resolvedSize === "sm" ? 14 : 16,
            flexShrink: 0,
          }}
        >
          <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
          <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
        </svg>
      ) : (
        icon && <Icon name={icon} size={resolvedSize === "sm" ? 15 : 18} />
      )}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  icon,
  active = false,
  className = "",
  shortcut,
  ref: externalRef,
  ...props
}: ComponentProps<"button"> & {
  label: string;
  icon: IconName;
  active?: boolean;
  shortcut?: string;
}) {
  const control = useControlMotion(props.disabled);
  const tooltip = useControlTooltip(control.ref, label, shortcut);
  return (
    <>
      <button
        aria-label={label}
        title={tooltip.id ? undefined : label}
        className={cn(
          "icon-button tw inline-grid size-[34px] shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40",
          active && "is-active bg-secondary text-foreground",
          className,
        )}
        {...props}
        data-motion-control
        ref={(node) => {
          control.setRef(node);
          if (typeof externalRef === "function") externalRef(node);
          else if (externalRef) externalRef.current = node;
        }}
        aria-describedby={tooltip.id ?? props["aria-describedby"]}
        onPointerEnter={(event) => {
          control.handlers.onPointerEnter(event);
          tooltip.handlers.onPointerEnter();
          props.onPointerEnter?.(event);
        }}
        onPointerLeave={(event) => {
          control.handlers.onPointerLeave();
          tooltip.handlers.onPointerLeave();
          props.onPointerLeave?.(event);
        }}
        onPointerDown={(event) => {
          control.handlers.onPointerDown();
          tooltip.handlers.onPointerDown();
          props.onPointerDown?.(event);
        }}
        onPointerUp={(event) => {
          control.handlers.onPointerUp();
          tooltip.handlers.onPointerUp();
          props.onPointerUp?.(event);
        }}
        onPointerCancel={(event) => {
          control.handlers.onPointerCancel();
          tooltip.handlers.onPointerCancel();
          props.onPointerCancel?.(event);
        }}
        onFocus={(event) => {
          tooltip.handlers.onFocus();
          props.onFocus?.(event);
        }}
        onBlur={(event) => {
          control.handlers.onBlur();
          tooltip.handlers.onBlur();
          props.onBlur?.(event);
        }}
        onKeyDown={(event) => {
          control.handlers.onKeyDown(event);
          tooltip.handlers.onKeyDown(event);
          props.onKeyDown?.(event);
        }}
        onKeyUp={(event) => {
          control.handlers.onKeyUp();
          props.onKeyUp?.(event);
        }}
      >
        <Icon name={icon} />
      </button>
      {tooltip.tooltip}
    </>
  );
}

export function Avatar({
  name,
  size = "md",
  status,
  image,
}: {
  name: string;
  size?: "xs" | "sm" | "md" | "lg";
  status?: "online" | "away" | "busy";
  image?: string;
}) {
  const initials = initialsOf(name);
  // Remote avatars (e.g. expired Google URLs) fall back to initials instead of a broken image.
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const showImage = Boolean(image) && failedImage !== image;
  return (
    <span
      className={cn(
        "relative inline-grid shrink-0 place-items-center overflow-visible rounded-full bg-[var(--tint-blue-bg)] font-semibold text-[var(--tint-blue-fg)] [&_img]:size-full [&_img]:rounded-full [&_img]:object-cover",
        {
          xs: "size-6 text-[10px]",
          sm: "size-8 text-xs",
          md: "size-9 text-[13px]",
          lg: "size-12 text-base",
        }[size],
      )}
      aria-label={name}
      title={name}
    >
      {showImage ? (
        <img
          src={image}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailedImage(image ?? null)}
        />
      ) : (
        <span>{initials}</span>
      )}
      {status && (
        <i
          className={cn(
            "absolute right-0 bottom-0 size-2.5 rounded-full ring-2 ring-card",
            { online: "bg-emerald-500", away: "bg-amber-500", busy: "bg-red-500" }[status],
          )}
        />
      )}
    </span>
  );
}

export function Badge({
  children,
  tone = "neutral",
  dot = false,
}: {
  children: ReactNode;
  tone?: "neutral" | "blue" | "green" | "amber" | "red" | "violet";
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
        TONE[tone],
      )}
    >
      {dot && <i className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Modal({
  title,
  eyebrow,
  children,
  footer,
  onClose,
  initialFocus,
  icon,
  iconTone = "blue",
  size = "default",
}: {
  title: string;
  eyebrow?: string;
  /** Shown in a tinted square before the title. */
  icon?: IconName;
  iconTone?: keyof typeof TONE;
  /**
   * "reading" (720px) and "wide" (940px, a two-column form) lay their body out themselves (no
   * padding) and rule off the footer.
   */
  size?: "default" | "reading" | "wide";
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  initialFocus?: string;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const isPresent = useIsPresent();
  const safe = useMotionSafe();
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!isPresent) return;
    const originalOverflow = document.body.style.overflow;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      const first =
        (initialFocus ? dialogRef.current?.querySelector<HTMLElement>(initialFocus) : null) ??
        dialogRef.current?.querySelector<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href]",
        );
      (first ?? dialogRef.current)?.focus({ preventScroll: true });
    });
    const handleKey = (event: KeyboardEvent) => {
      // A dialog opened inside another (a confirmation) owns the keyboard until it closes.
      const dialogs = document.querySelectorAll(".modal");
      if (dialogs[dialogs.length - 1] !== dialogRef.current) return;
      if (event.key === "Escape") {
        if (isSelectPickerEvent(event)) return;
        event.preventDefault();
        onCloseRef.current();
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const items = [
        ...dialogRef.current.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex='-1'])",
        ),
      ].filter((element) => element.offsetParent !== null);
      if (!items.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = originalOverflow;
      document.removeEventListener("keydown", handleKey);
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, [isPresent]);

  return (
    <motion.div
      className="fixed inset-0 z-[var(--z-modal)] grid place-items-center bg-zinc-950/45 p-4 backdrop-blur-[3px]"
      inert={!isPresent}
      style={isPresent ? undefined : { pointerEvents: "none" }}
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: safe.duration(DURATION.panelExit), ease: EASE.out }}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <motion.section
        ref={dialogRef}
        className={cn(
          "modal flex max-h-[calc(100dvh-2rem)] flex-col",
          {
            default: "w-[min(520px,100%)]",
            reading: "w-[min(720px,100%)]",
            wide: "w-[min(940px,100%)]",
          }[size],
          "overflow-hidden rounded-xl border bg-card text-sm text-foreground shadow-[0_24px_60px_rgba(0,0,0,.25)] outline-none",
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        initial={safe.reduced ? false : { opacity: 0, scale: 0.94, y: 14, filter: safe.blur(10) }}
        animate={{ opacity: 1, scale: 1, y: 0, filter: safe.blur(0) }}
        exit={{
          opacity: safe.reduced ? 1 : 0,
          scale: safe.reduced ? 1 : 0.96,
          y: safe.reduced ? 0 : 8,
          filter: safe.blur(6),
          transition: { duration: safe.duration(DURATION.panelExit), ease: EASE.out },
        }}
        transition={{
          default: SPRING.pop,
          opacity: { duration: 0.28, ease: EASE.out },
          filter: { duration: 0.3, ease: EASE.out },
        }}
      >
        <header className="tw flex shrink-0 items-center gap-3 border-b px-[18px] py-3.5">
          {icon && (
            <span
              className={cn(
                "grid size-9 shrink-0 place-items-center rounded-[9px]",
                TONE[iconTone],
              )}
            >
              <Icon name={icon} size={17} />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h2
              id={titleId}
              className="truncate text-base! leading-snug font-semibold! text-foreground!"
            >
              {title}
            </h2>
            {eyebrow && (
              <small className="block truncate text-xs font-medium text-muted-foreground">
                {eyebrow}
              </small>
            )}
          </div>
          <IconButton label="Đóng" icon="x" onClick={onClose} className="size-[30px]" />
        </header>
        <div
          className={cn(
            "min-h-0 flex-1 overflow-y-auto",
            size === "default" && "grid gap-3.5 px-[18px] py-4",
          )}
        >
          {children}
        </div>
        {footer && (
          <footer
            className={cn(
              "tw flex shrink-0 flex-wrap items-center justify-end gap-2 px-[18px] pb-4",
              size !== "default" && "border-t pt-3",
            )}
          >
            {footer}
          </footer>
        )}
      </motion.section>
    </motion.div>
  );
}

export function Field({
  label,
  children,
  hint,
  error,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  error?: string;
}) {
  const generatedId = useId();
  const [fieldRef, animateField] = useAnimate<HTMLLabelElement>();
  const previousError = useRef(error);
  const safe = useMotionSafe();
  useEffect(() => {
    if (safe.reduced && fieldRef.current)
      void animateField(fieldRef.current, { x: 0 }, { duration: 0 });
    if (error && error !== previousError.current && fieldRef.current && !safe.reduced) {
      void animateField(
        fieldRef.current,
        { x: [0, -4, 4, -2, 0] },
        { duration: DURATION.page, ease: EASE.inOut },
      );
    }
    previousError.current = error;
  }, [error, safe.reduced, animateField, fieldRef]);
  let controlIndex = 0;
  let firstId: string | undefined;
  const messageId = `${generatedId}-message`;
  // Keep the incumbent label/span/control DOM: CSS depends on its exact shape.
  const attach = (nodes: ReactNode): ReactNode =>
    Children.map(nodes, (node) => {
      if (!isValidElement<Record<string, unknown>>(node)) return node;
      if (typeof node.type === "string" && ["input", "textarea", "select"].includes(node.type)) {
        const id = String(node.props.id || `${generatedId}-${controlIndex++}`);
        firstId ??= id;
        const describedBy = [node.props["aria-describedby"], error || hint ? messageId : null]
          .filter(Boolean)
          .join(" ");
        return cloneElement(node, {
          id,
          name: node.props.name || id,
          autoComplete:
            node.props.autoComplete ||
            (node.props.type === "email"
              ? "email"
              : node.props.type === "password"
                ? "new-password"
                : "off"),
          "aria-invalid": error ? true : node.props["aria-invalid"],
          "aria-labelledby": node.props["aria-label"]
            ? node.props["aria-labelledby"]
            : node.props["aria-labelledby"] || `${generatedId}-label`,
          "aria-describedby": describedBy || undefined,
        });
      }
      return node.props.children
        ? cloneElement(node, { children: attach(node.props.children as ReactNode) })
        : node;
    });
  const controls = attach(children);
  return (
    <label
      ref={fieldRef}
      className={cn(
        "field tw-form grid gap-1.5 text-[13px] font-semibold text-foreground [&_:is(input,select,textarea)]:w-full [&_:is(input,select,textarea)]:font-normal [&_:is(input,select,textarea)]:outline-none [&_:is(input,select,textarea):focus]:border-foreground [&_:is(input,select,textarea):focus]:ring-3 [&_:is(input,select,textarea):focus]:ring-foreground/10",
        error && "[&_:is(input,select,textarea)]:border-destructive",
      )}
      htmlFor={firstId}
    >
      <span id={`${generatedId}-label`}>{label}</span>
      {controls}
      {error ? (
        <small className="text-[12.5px] font-medium text-destructive" id={messageId} role="alert">
          {error}
        </small>
      ) : hint ? (
        <small className="text-[12.5px] font-normal text-muted-foreground" id={messageId}>
          {hint}
        </small>
      ) : null}
    </label>
  );
}

export function ToastViewport() {
  const { toasts, dismissToast, route } = useApp();
  return (
    <div
      className={cn(
        "pointer-events-none fixed right-5 z-[var(--z-toast)] grid w-[min(380px,calc(100vw-2rem))] gap-2.5",
        route.view === "chat" || route.view === "meetings"
          ? "top-[calc(76px+env(safe-area-inset-top))]"
          : "bottom-5",
      )}
    >
      <AnimatePresence>
        {toasts.map((toast) => (
          <TimedToast key={toast.id} toast={toast} dismiss={() => dismissToast(toast.id)} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function TimedToast({
  toast,
  dismiss,
}: {
  toast: ReturnType<typeof useApp>["toasts"][number];
  dismiss: () => void;
}) {
  const safe = useMotionSafe();
  const remaining = useRef(toastDuration(toast.tone));
  const started = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hovered = useRef(false);
  const focused = useRef(false);
  const dismissRef = useRef(dismiss);
  dismissRef.current = dismiss;
  const pause = () => {
    if (timer.current === undefined) return;
    clearTimeout(timer.current);
    timer.current = undefined;
    remaining.current = Math.max(0, remaining.current - (performance.now() - started.current));
  };
  const resume = () => {
    if (timer.current !== undefined || hovered.current || focused.current) return;
    started.current = performance.now();
    timer.current = setTimeout(() => dismissRef.current(), remaining.current);
  };
  useEffect(() => {
    resume();
    return pause;
  }, []);
  return (
    <motion.article
      layout="position"
      className="tw pointer-events-auto relative flex items-start gap-3 rounded-[10px] border bg-card py-3 pr-10 pl-3.5 text-sm text-foreground shadow-[0_10px_30px_rgba(0,0,0,.12)]"
      role={toast.tone === "warning" ? "alert" : "status"}
      aria-atomic="true"
      initial={safe.reduced ? false : { opacity: 0, y: 16, scale: 0.96, filter: safe.blur(8) }}
      animate={{ opacity: 1, x: 0, y: 0, scale: 1, filter: safe.blur(0) }}
      exit={{
        opacity: safe.reduced ? 1 : 0,
        x: safe.reduced ? 0 : 16,
        filter: safe.blur(6),
        transition: { duration: DURATION.panelExit, ease: EASE.out },
      }}
      transition={{
        default: SPRING.pop,
        opacity: { duration: 0.25, ease: EASE.out },
        filter: { duration: 0.3, ease: EASE.out },
      }}
      drag={safe.reduced ? false : "x"}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.15}
      dragSnapToOrigin
      onDragEnd={(_event, info) => {
        if (Math.abs(info.offset.x) > 100 || Math.abs(info.velocity.x) > 600) dismiss();
      }}
      onMouseEnter={() => {
        hovered.current = true;
        pause();
      }}
      onMouseLeave={() => {
        hovered.current = false;
        resume();
      }}
      onFocusCapture={() => {
        focused.current = true;
        pause();
      }}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          focused.current = false;
          resume();
        }
      }}
    >
      <span
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-full",
          TONE[toast.tone === "warning" ? "amber" : toast.tone === "success" ? "green" : "blue"],
        )}
      >
        <Icon
          name={
            toast.icon ??
            (toast.tone === "warning" ? "warning" : toast.tone === "success" ? "check" : "info")
          }
          size={15}
        />
      </span>
      {toast.onOpen ? (
        <button
          type="button"
          className="min-w-0 flex-1 cursor-pointer text-left"
          onClick={() => {
            toast.onOpen?.();
            dismiss();
          }}
        >
          <strong className="block font-semibold">{toast.title}</strong>
          {toast.description && (
            <p className="text-[13px]! text-muted-foreground!">{toast.description}</p>
          )}
        </button>
      ) : (
        <div className="min-w-0 flex-1">
          <strong className="block font-semibold">{toast.title}</strong>
          {toast.description && (
            <p className="text-[13px]! text-muted-foreground!">{toast.description}</p>
          )}
        </div>
      )}
      {toast.action && (
        <Button size="sm" variant="ghost" onClick={toast.action.onClick}>
          {toast.action.label}
        </Button>
      )}
      <IconButton
        className="absolute top-2 right-2 size-[26px]"
        icon="x"
        label="Đóng thông báo"
        onClick={dismiss}
      />
    </motion.article>
  );
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  onConfirm,
  onClose,
  loading = false,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  loading?: boolean;
}) {
  return (
    <Modal
      title={title}
      onClose={() => {
        if (!loading) onClose();
      }}
      initialFocus="[data-cancel]"
      icon="warning"
      iconTone="red"
      footer={
        <>
          <Button variant="ghost" data-cancel disabled={loading} onClick={onClose}>
            Hủy
          </Button>
          <Button variant="danger" loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p>{description}</p>
    </Modal>
  );
}

export interface KpiStatCardProps {
  icon: IconName;
  value: string | number;
  label: string;
  tone?: "purple" | "green" | "blue" | "amber" | "red";
  onClick?: () => void;
  className?: string;
}

export function KpiStatCard({
  icon,
  value,
  label,
  tone = "purple",
  onClick,
  className = "",
}: KpiStatCardProps) {
  return (
    <div
      className={cn(
        "tw flex items-center gap-3 rounded-[10px] border bg-card px-3.5 py-3",
        onClick && "cursor-pointer hover:bg-secondary",
        className,
      )}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-lg",
          TONE[tone === "purple" ? "violet" : tone],
        )}
      >
        <Icon name={icon} size={18} strokeWidth={1.8} />
      </div>
      <div className="flex min-w-0 flex-col">
        <span className="text-lg leading-tight font-bold text-foreground tabular-nums">
          {value}
        </span>
        <span className="text-[11.5px] text-muted-foreground">{label}</span>
      </div>
    </div>
  );
}

export interface PageHeaderProps {
  title: ReactNode;
  titleId?: string;
  /** One line under the title: what the page is, or its live counts. */
  meta?: ReactNode;
  /** Shows a status dot before `meta`: green when true, grey when false. */
  live?: boolean;
  className?: string;
  /** Page actions (filters, search, buttons), laid out to the right of the title. */
  children?: ReactNode;
}

/** The title block of every top-level page, so they all share one size, order and spacing. */
/** A page's error or empty state: a dashed card with a heading, a line and an action. */
export const STATE_CARD =
  "tw mx-auto my-6 grid w-[min(460px,100%)] justify-items-center gap-2 rounded-xl border border-dashed bg-card px-6 py-10 text-center text-sm text-foreground [&_h2]:m-0! [&_h2]:text-lg! [&_h2]:text-foreground! [&_h3]:m-0! [&_h3]:text-base! [&_h3]:text-foreground! [&_p]:m-0! [&_p]:mb-2! [&_p]:text-muted-foreground!";

/** Skeleton shown while a page's code loads. */
export function PageFallback({ label }: { label: string }) {
  const bar = "rounded-md bg-secondary motion-safe:animate-pulse";
  return (
    <div
      className="tw mx-auto my-9 flex w-[min(840px,92%)] flex-col gap-4"
      role="status"
      aria-label={label}
    >
      <div className={cn(bar, "h-8 w-2/5")} />
      <div className={cn(bar, "h-4 w-3/4")} />
      <div className={cn(bar, "h-40 rounded-lg")} />
    </div>
  );
}

export function PageHeader({
  title,
  titleId,
  meta,
  live,
  className = "",
  children,
}: PageHeaderProps) {
  return (
    <header className={cn("tw flex flex-wrap items-end gap-2.5", className)}>
      <div className="min-w-0 flex-[1_1_240px]">
        <h1
          id={titleId}
          className="m-0! text-[26px]! leading-tight! font-extrabold! tracking-[-.03em]! text-foreground!"
        >
          {title}
        </h1>
        {meta != null && (
          <p className="m-0! mt-0.5! flex items-center gap-2 text-[12.5px] text-muted-foreground!">
            {live !== undefined && (
              <i
                className={cn(
                  "size-[7px] flex-none rounded-full",
                  live ? "bg-green-500" : "bg-zinc-400",
                )}
                aria-hidden="true"
              />
            )}
            <span>{meta}</span>
          </p>
        )}
      </div>
      {children}
    </header>
  );
}
