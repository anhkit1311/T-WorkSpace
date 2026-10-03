import type { SVGProps } from "react";
import "./nexo-logo.css";

/** A soft arch crossed by a connecting path, like a bridge between people. */
export function NexoMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false" {...props}>
      <path
        d="M9 42C20 28 35 22 55 22"
        stroke="currentColor"
        strokeWidth="4.5"
        strokeLinecap="round"
        opacity="0.55"
      />
      <path
        d="M15 47V29C15 20.16 22.16 13 31 13S47 20.16 47 29V47"
        stroke="currentColor"
        strokeWidth="5.5"
        strokeLinecap="round"
      />
      <circle cx="55" cy="22" r="3.5" fill="currentColor" />
    </svg>
  );
}

export function NexoLogo() {
  return (
    <span className="nexo-lockup">
      <NexoMark className="nexo-mark" />
      <span className="nexo-wordmark">nexo</span>
    </span>
  );
}
