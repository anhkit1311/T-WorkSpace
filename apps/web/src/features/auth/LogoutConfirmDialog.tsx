import { useState } from "react";
import { useApp } from "../../app/providers/AppContext";
import { useMeeting } from "../../app/providers/MeetingContext";
import { ConfirmDialog } from "../../shared/ui/Primitives";

/** One logout confirmation for the account menu and the profile page (focus starts on "Hủy"). */
export function LogoutConfirmDialog({ onClose }: { onClose: () => void }) {
  const { user, logout } = useApp();
  const { inCall } = useMeeting();
  const [leaving, setLeaving] = useState(false);
  const account = user ? `${user.displayName} (${user.email})` : "này";
  return (
    <ConfirmDialog
      title="Xác nhận đăng xuất"
      description={`Bạn có chắc chắn muốn đăng xuất khỏi tài khoản ${account} không? Bạn sẽ cần đăng nhập lại để tiếp tục làm việc.${inCall ? " Bạn sẽ rời cuộc họp đang diễn ra." : ""}`}
      confirmLabel="Đăng xuất ngay"
      loading={leaving}
      onClose={onClose}
      onConfirm={() => {
        setLeaving(true);
        void logout();
      }}
    />
  );
}
