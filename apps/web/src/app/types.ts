import type { IconName } from "../shared/ui/Icon";

export type ViewId =
  | "overview"
  | "workspace"
  | "chat"
  | "meetings"
  | "tasks"
  | "files"
  | "profile"
  | "admin"
  | "invitation"
  | "notifications"
  | "call-center"
  | "call-directory"
  | "call-monitoring"
  | "staff"
  | "elearning"
  | "access"
  | "reports"
  | "groups";

export type PublicScreen = "landing" | "login" | "app";

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
