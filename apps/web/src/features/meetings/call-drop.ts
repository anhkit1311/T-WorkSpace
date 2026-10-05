/**
 * Why an active call ended without the user leaving, by socket.io disconnect reason
 * ("replaced" = the realtime socket was recreated, e.g. after a profile change).
 */
export function callDropMessage(reason: string): string {
  const rejoin = " Vào lại phòng để tiếp tục.";
  switch (reason) {
    case "io server disconnect":
      return `Máy chủ đã ngắt kết nối của bạn (quyền truy cập có thể đã thay đổi).${rejoin}`;
    case "io client disconnect":
    case "replaced":
      return `Kết nối thời gian thực vừa được làm mới.${rejoin}`;
    default:
      return `Mất kết nối mạng tới máy chủ cuộc họp.${rejoin}`;
  }
}
