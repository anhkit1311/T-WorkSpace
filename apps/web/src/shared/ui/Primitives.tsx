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
import { NexoLogo } from "./NexoLogo";
import { isSelectPickerEvent } from "../lib/select-picker";
import { toastDuration } from "../lib/interaction";
import "./interaction.css";
import { useControlMotion } from "../motion/useControlMotion";
import { useControlTooltip } from "../motion/ControlTooltip";
import { useMotionSafe } from "../motion/MotionProvider";
import { DURATION, EASE } from "../motion/tokens";
import { useAnimate } from "motion/react";

export function Brand({ className = "", onClick }: { className?: string; onClick?: () => void }) {
  return (
    <div
      className={`brand ${className} ${onClick ? "is-clickable" : ""}`}
      aria-label="nexo"
      onClick={onClick}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <span className="brand-name">
        <NexoLogo />
      </span>
    </div>
  );
}

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
    const rememberWidth = () => { widthRef.current = buttonRef.current?.getBoundingClientRect().width; };
    rememberWidth();
    const observer = new ResizeObserver(rememberWidth);
    observer.observe(buttonRef.current);
    return () => observer.disconnect();
  }, [loading]);
  const resolvedSize = variant === "icon" ? "icon" : size;
  return (
    <button
      className={`button button--${variant} button--${resolvedSize} ${loading ? "button--loading" : ""} ${className}`.trim()}
      disabled={disabled || loading}
      {...props}
      data-motion-control
      ref={control.setRef}
      onPointerEnter={event => { control.handlers.onPointerEnter(event); props.onPointerEnter?.(event); }}
      onPointerLeave={event => { control.handlers.onPointerLeave(); props.onPointerLeave?.(event); }}
      onPointerDown={event => { control.handlers.onPointerDown(); props.onPointerDown?.(event); }}
      onPointerUp={event => { control.handlers.onPointerUp(); props.onPointerUp?.(event); }}
      onPointerCancel={event => { control.handlers.onPointerCancel(); props.onPointerCancel?.(event); }}
      onBlur={event => { control.handlers.onBlur(); props.onBlur?.(event); }}
      onKeyDown={event => { control.handlers.onKeyDown(event); props.onKeyDown?.(event); }}
      onKeyUp={event => { control.handlers.onKeyUp(); props.onKeyUp?.(event); }}
      aria-busy={loading || undefined}
      style={loading && widthRef.current ? { ...props.style, width: widthRef.current } : props.style}
    >
      {loading ? (
        <svg
          className="button-spinner"
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

export function Chip({
  icon,
  children,
  className = "",
  ...props
}: ComponentProps<"span"> & {
  icon?: IconName;
  children: ReactNode;
}) {
  return (
    <span className={`nexo-chip ${className}`.trim()} {...props}>
      {icon && <Icon name={icon} size={14} />}
      <span>{children}</span>
    </span>
  );
}

export interface ListItemProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
  icon: IconName;
  title: ReactNode;
  subtitle?: ReactNode;
  metaPrimary?: ReactNode;
  metaSecondary?: ReactNode;
}

export function ListItem({
  icon,
  title,
  subtitle,
  metaPrimary,
  metaSecondary,
  className = "",
  disabled,
  ...props
}: ListItemProps) {
  const control = useControlMotion(Boolean(disabled));
  const body = (
    <>
      <span className="nexo-list-item__icon" aria-hidden="true">
        <Icon name={icon} size={18} />
      </span>
      <span className="nexo-list-item__body">
        <span className="nexo-list-item__content">
          <strong className="nexo-list-item__title">{title}</strong>
          {subtitle && <span className="nexo-list-item__subtitle">{subtitle}</span>}
        </span>
        {(metaPrimary || metaSecondary) && (
          <span className="nexo-list-item__meta">
            {metaPrimary && <strong className="nexo-list-item__meta-primary">{metaPrimary}</strong>}
            {metaSecondary && <span className="nexo-list-item__meta-secondary">{metaSecondary}</span>}
          </span>
        )}
      </span>
    </>
  );
  // Rows without an action are information, not controls.
  if (!props.onClick) {
    return (
      <div role={props.role} className={`nexo-list-item is-static ${className}`.trim()}>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      disabled={disabled}
      className={`nexo-list-item ${className}`.trim()}
      {...props}
      data-motion-control
      ref={control.setRef}
      onPointerEnter={event => { control.handlers.onPointerEnter(event); props.onPointerEnter?.(event); }}
      onPointerLeave={event => { control.handlers.onPointerLeave(); props.onPointerLeave?.(event); }}
      onPointerDown={event => { control.handlers.onPointerDown(); props.onPointerDown?.(event); }}
      onPointerUp={event => { control.handlers.onPointerUp(); props.onPointerUp?.(event); }}
      onPointerCancel={event => { control.handlers.onPointerCancel(); props.onPointerCancel?.(event); }}
      onBlur={event => { control.handlers.onBlur(); props.onBlur?.(event); }}
      onKeyDown={event => { control.handlers.onKeyDown(event); props.onKeyDown?.(event); }}
      onKeyUp={event => { control.handlers.onKeyUp(); props.onKeyUp?.(event); }}
    >
      {body}
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
}: ComponentProps<"button"> & { label: string; icon: IconName; active?: boolean; shortcut?: string }) {
  const control = useControlMotion(props.disabled);
  const tooltip = useControlTooltip(control.ref, label, shortcut);
  return (
    <>
    <button
      aria-label={label}
      title={tooltip.id ? undefined : label}
      className={`icon-button button--icon ${active ? "is-active" : ""} ${className}`.trim()}
      {...props}
      data-motion-control
      ref={node => { control.setRef(node); if(typeof externalRef === "function") externalRef(node); else if(externalRef) externalRef.current=node; }}
      aria-describedby={tooltip.id ?? props["aria-describedby"]}
      onPointerEnter={event => { control.handlers.onPointerEnter(event); tooltip.handlers.onPointerEnter(); props.onPointerEnter?.(event); }}
      onPointerLeave={event => { control.handlers.onPointerLeave(); tooltip.handlers.onPointerLeave(); props.onPointerLeave?.(event); }}
      onPointerDown={event => { control.handlers.onPointerDown(); tooltip.handlers.onPointerDown(); props.onPointerDown?.(event); }}
      onPointerUp={event => { control.handlers.onPointerUp(); tooltip.handlers.onPointerUp(); props.onPointerUp?.(event); }}
      onPointerCancel={event => { control.handlers.onPointerCancel(); tooltip.handlers.onPointerCancel(); props.onPointerCancel?.(event); }}
      onFocus={event => { tooltip.handlers.onFocus(); props.onFocus?.(event); }}
      onBlur={event => { control.handlers.onBlur(); tooltip.handlers.onBlur(); props.onBlur?.(event); }}
      onKeyDown={event => { control.handlers.onKeyDown(event); tooltip.handlers.onKeyDown(event); props.onKeyDown?.(event); }}
      onKeyUp={event => { control.handlers.onKeyUp(); props.onKeyUp?.(event); }}
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
  const initials = name
    .split(" ")
    .slice(-2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  // Remote avatars (e.g. expired Google URLs) fall back to initials instead of a broken image.
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const showImage = Boolean(image) && failedImage !== image;
  return (
    <span className={`avatar avatar--${size}`} aria-label={name} title={name}>
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
      {status && <i className={`avatar-status avatar-status--${status}`} />}
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
    <span className={`badge badge--${tone}`}>
      {dot && <i />}
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
}: {
  title: string;
  eyebrow?: string;
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
      const first = (initialFocus ? dialogRef.current?.querySelector<HTMLElement>(initialFocus) : null) ?? dialogRef.current?.querySelector<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href]",
      );
      (first ?? dialogRef.current)?.focus({preventScroll: true});
    });
    const handleKey = (event: KeyboardEvent) => {
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
      if (previouslyFocused?.isConnected) previouslyFocused.focus({preventScroll: true});
    };
  }, [isPresent]);

  return (
    <motion.div
      className="modal-backdrop"
      inert={!isPresent}
      style={isPresent ? undefined : {pointerEvents:"none"}}
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: safe.duration(DURATION.panelExit), ease: EASE.out }}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <motion.section
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        initial={safe.reduced ? false : { opacity: 0, scale: 0.98, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: safe.reduced ? 1 : 0, scale: safe.reduced ? 1 : 0.98, y: safe.reduced ? 0 : 6, transition: {duration: safe.duration(DURATION.panelExit)} }}
        transition={{ duration: safe.duration(DURATION.overlay), ease: EASE.out }}
      >
        <header className="modal__header">
          <div>
            {eyebrow && <span className="eyebrow">{eyebrow}</span>}
            <h2 id={titleId}>{title}</h2>
          </div>
          <IconButton label="Đóng" icon="x" onClick={onClose} />
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__footer">{footer}</footer>}
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
    if (safe.reduced && fieldRef.current) void animateField(fieldRef.current, {x:0}, {duration:0});
    if (error && error !== previousError.current && fieldRef.current && !safe.reduced) {
      void animateField(fieldRef.current, {x:[0,-4,4,-2,0]}, {duration:DURATION.page,ease:EASE.inOut});
    }
    previousError.current = error;
  }, [error, safe.reduced, animateField, fieldRef]);
  let controlIndex = 0;
  let firstId: string | undefined;
  const messageId = `${generatedId}-message`;
  // Keep the incumbent label/span/control DOM: CSS depends on its exact shape.
  const attach = (nodes: ReactNode): ReactNode => Children.map(nodes, (node) => {
    if (!isValidElement<Record<string, unknown>>(node)) return node;
    if (typeof node.type === "string" && ["input", "textarea", "select"].includes(node.type)) {
      const id = String(node.props.id || `${generatedId}-${controlIndex++}`);
      firstId ??= id;
      const describedBy = [node.props["aria-describedby"], error || hint ? messageId : null].filter(Boolean).join(" ");
      return cloneElement(node, {
        id,
        name: node.props.name || id,
        autoComplete: node.props.autoComplete || (node.props.type === "email" ? "email" : node.props.type === "password" ? "new-password" : "off"),
        "aria-invalid": error ? true : node.props["aria-invalid"],
        "aria-labelledby": node.props["aria-label"] ? node.props["aria-labelledby"] : node.props["aria-labelledby"] || `${generatedId}-label`,
        "aria-describedby": describedBy || undefined,
      });
    }
    return node.props.children ? cloneElement(node, { children: attach(node.props.children as ReactNode) }) : node;
  });
  const controls = attach(children);
  return (
    <label ref={fieldRef} className="field" htmlFor={firstId}>
      <span id={`${generatedId}-label`}>{label}</span>
      {controls}
      {error ? (
        <small className="field__error" id={messageId} role="alert">{error}</small>
      ) : hint ? (
        <small id={messageId}>{hint}</small>
      ) : null}
    </label>
  );
}

export function ToastViewport() {
  const { toasts, dismissToast, route } = useApp();
  return (
    <div className={`toast-viewport ${route.view === "chat" || route.view === "meetings" ? "toast-viewport--raised" : ""}`}>
      <AnimatePresence>
        {toasts.map((toast) => (
          <TimedToast key={toast.id} toast={toast} dismiss={() => dismissToast(toast.id)} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function TimedToast({ toast, dismiss }: {toast: ReturnType<typeof useApp>["toasts"][number]; dismiss: () => void}) {
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
  useEffect(() => { resume(); return pause; }, []);
  return <motion.article layout="position" className={`toast toast--${toast.tone}`}
    role={toast.tone === "warning" ? "alert" : "status"} aria-atomic="true"
    initial={safe.reduced ? false : {opacity:0,x:20}} animate={{opacity:1,x:0,scale:1}} exit={{opacity:safe.reduced?1:0,x:safe.reduced?0:16}}
    transition={{duration:safe.duration(DURATION.overlay),ease:EASE.out}}
    drag={safe.reduced ? false : "x"} dragConstraints={{left:0,right:0}} dragElastic={0.15} dragSnapToOrigin
    onDragEnd={(_event, info) => { if(Math.abs(info.offset.x)>100 || Math.abs(info.velocity.x)>600) dismiss(); }}
    onMouseEnter={() => {hovered.current=true; pause();}} onMouseLeave={() => {hovered.current=false; resume();}}
    onFocusCapture={() => {focused.current=true; pause();}}
    onBlurCapture={e => {if(!e.currentTarget.contains(e.relatedTarget)){focused.current=false;resume();}}}>
    <span className="toast__icon"><Icon name={toast.icon ?? (toast.tone === "warning" ? "warning" : toast.tone === "success" ? "check" : "info")} size={18} /></span>
    {toast.onOpen ? (
      <button type="button" className="toast__open" onClick={() => { toast.onOpen?.(); dismiss(); }}>
        <strong>{toast.title}</strong>{toast.description && <p>{toast.description}</p>}
      </button>
    ) : (
      <div><strong>{toast.title}</strong>{toast.description && <p>{toast.description}</p>}</div>
    )}
    {toast.action && <Button size="sm" variant="ghost" onClick={toast.action.onClick}>{toast.action.label}</Button>}
    <IconButton className="toast-close" icon="x" label="Đóng thông báo" onClick={dismiss} />
  </motion.article>;
}

export function ConfirmDialog({title,description,confirmLabel,onConfirm,onClose,loading=false}: {
  title:string; description:string; confirmLabel:string; onConfirm:()=>void; onClose:()=>void; loading?:boolean;
}) {
  return <Modal title={title} onClose={() => {if(!loading)onClose();}} initialFocus="[data-cancel]"
    footer={<><Button variant="ghost" data-cancel disabled={loading} onClick={onClose}>Hủy</Button><Button variant="danger" loading={loading} onClick={onConfirm}>{confirmLabel}</Button></>}>
    <p>{description}</p>
  </Modal>;
}
