import {useEffect,useId,useRef,useLayoutEffect,Children,cloneElement,isValidElement,type ButtonHTMLAttributes,type ReactNode} from "react";
import {motion,AnimatePresence,useIsPresent} from "motion/react";
import { useApp } from "../../app/providers/AppContext";
import { Icon, type IconName } from "./Icon";
import { NexoLogo } from "./NexoLogo";
import { isSelectPickerEvent } from "../lib/select-picker";
import { toastDuration } from "../lib/interaction";
import "./interaction.css";

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
  variant?: "primary" | "secondary" | "ghost" | "danger" | "soft";
  size?: "sm" | "md" | "lg" | "icon";
  icon?: IconName;
  loading?: boolean;
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  icon,
  loading = false,
  disabled,
  className = "",
  ...props
}: ButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const widthRef = useRef<number | undefined>(undefined);
  useLayoutEffect(() => {
    if (loading || !buttonRef.current) return;
    const rememberWidth = () => { widthRef.current = buttonRef.current?.getBoundingClientRect().width; };
    rememberWidth();
    const observer = new ResizeObserver(rememberWidth);
    observer.observe(buttonRef.current);
    return () => observer.disconnect();
  }, [loading]);
  return (
    <button
      className={`button button--${variant} button--${size} ${loading ? "button--loading" : ""} ${className}`}
      disabled={disabled || loading}
      {...props}
      ref={buttonRef}
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
            width: size === "sm" ? 14 : 16,
            height: size === "sm" ? 14 : 16,
            flexShrink: 0,
          }}
        >
          <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
          <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
        </svg>
      ) : (
        icon && <Icon name={icon} size={size === "sm" ? 15 : 17} />
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
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: IconName; active?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={`icon-button ${active ? "is-active" : ""} ${className}`}
      {...props}
    >
      <Icon name={icon} />
    </button>
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
  return (
    <span className={`avatar avatar--${size}`} aria-label={name} title={name}>
      {image ? <img src={image} alt="" /> : <span>{initials}</span>}
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
      (first ?? dialogRef.current)?.focus();
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
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
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
      transition={{ duration: 0.16, ease: "easeOut" }}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <motion.section
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        initial={{ opacity: 0, scale: 0.98, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 6 }}
        transition={{ duration: 0.24, ease: "easeOut" }}
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
    <label className="field" htmlFor={firstId}>
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
    initial={{opacity:0,x:20}} animate={{opacity:1,x:0,scale:1}} exit={{opacity:0,x:16}}
    transition={{duration:0.18,ease:[0.22,1,0.36,1]}}
    onMouseEnter={() => {hovered.current=true; pause();}} onMouseLeave={() => {hovered.current=false; resume();}}
    onFocusCapture={() => {focused.current=true; pause();}}
    onBlurCapture={e => {if(!e.currentTarget.contains(e.relatedTarget)){focused.current=false;resume();}}}>
    <span className="toast__icon"><Icon name={toast.tone === "warning" ? "warning" : toast.tone === "success" ? "check" : "info"} size={16} /></span>
    <div><strong>{toast.title}</strong>{toast.description && <p>{toast.description}</p>}</div>
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
