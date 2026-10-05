/**
 * Success toast for a host/co-host action on another participant, or null for actions
 * that already show their own result (hand, waiting room, lock, admit, end).
 * The name is resolved by userId before the request, so duplicate display names and
 * participants removed by the action (kick) still read correctly.
 */
export function hostActionToast(
  action: string,
  targetName: string | undefined,
  enabled?: boolean,
): string | null {
  if (!targetName) return null;
  switch (action) {
    case "mute":
      return `Đã tắt mic của ${targetName}`;
    case "kick":
      return `Đã loại ${targetName} khỏi phiên`;
    case "cohost":
      return enabled ? `Đã đặt ${targetName} làm co-host` : `Đã bỏ co-host của ${targetName}`;
    case "transfer":
      return `Đã chuyển quyền host cho ${targetName}`;
    default:
      return null;
  }
}
