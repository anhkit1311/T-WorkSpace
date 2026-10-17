import type { IconName } from "../shared/ui/Icon";

export type ViewId =
  | "overview"
  | "workspace"
  | "chat"
  | "meetings"
  | "files"
  | "profile"
  | "admin"
  | "invitation"
  | "notifications"
  | "tasks"
  | "thesis"
  | "call-center"
  | "call-directory"
  | "elearning";

export type PublicScreen = "landing" | "login" | "app";
export type AuthMode = "login" | "register";

export interface ToastMessage {
  id: number;
  title: string;
  description?: string;
  tone?: "success" | "info" | "warning";
  action?: {label: string; onClick: () => void};
  /** Overrides the tone icon, e.g. "message" for chat notifications. */
  icon?: IconName;
  /** Makes the toast body clickable; the toast dismisses itself after opening. */
  onOpen?: () => void;
}
