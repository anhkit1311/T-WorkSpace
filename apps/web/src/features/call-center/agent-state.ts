import type { AgentState } from "@doan/shared";

export const STATE_LABEL: Record<AgentState, string> = {
  offline: "Ngoại tuyến",
  ready: "Sẵn sàng",
  not_ready: "Tạm nghỉ",
  ringing: "Đang đổ chuông",
  on_call: "Đang đàm thoại",
  wrap_up: "Hoàn tất cuộc gọi",
};
export const STATE_TONE: Record<AgentState, "neutral" | "green" | "amber" | "blue" | "violet" | "red"> = {
  offline: "neutral",
  ready: "green",
  not_ready: "amber",
  ringing: "red",
  on_call: "red",
  wrap_up: "blue",
};
