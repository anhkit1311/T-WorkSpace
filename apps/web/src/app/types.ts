export type ViewId =
  "overview" | "chat" | "meetings" | "profile" | "admin" | "invitation" | "notifications" | "tasks";

export type PublicScreen = "landing" | "login" | "app";
export type AuthMode = "login" | "register";

export interface ToastMessage {
  id: number;
  title: string;
  description?: string;
  tone?: "success" | "info" | "warning";
}
