import { useState } from "react";
import { governanceApi } from "./api";
import { Button } from "../../shared/ui/Primitives";
import { useApp } from "../../app/providers/AppContext";

export function InvitationPage() {
  const { route, accessToken, openChannel, setActiveView, user } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const accept = async () => {
    if (!accessToken || !route.invitationToken) return;
    setBusy(true);
    setError("");
    try {
      const result = await governanceApi<{ workspaceId: string }>(
        accessToken,
        "invitations/accept",
        "POST",
        { token: route.invitationToken },
      );
      openChannel(result.workspaceId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không nhận được lời mời.");
    } finally {
      setBusy(false);
    }
  };
  if (route.view !== "invitation") return null;
  return (
    <section className="workspace-home">
      <h1>Lời mời tham gia nhóm</h1>
      <p>
        Bạn đang đăng nhập bằng {user?.email}. Lời mời gắn email chỉ được nhận bằng đúng email đã
        xác thực; liên kết dùng một lần và hết hạn sau 7 ngày.
      </p>
      {(!route.invitationToken || error) && (
        <p role="alert">
          {error || "Liên kết thiếu mã lời mời. Hãy mở đầy đủ liên kết được gửi cho bạn."}
        </p>
      )}
      <Button
        disabled={busy || !route.invitationToken}
        loading={busy}
        onClick={() => void accept()}
      >
        Nhận lời mời
      </Button>
      <Button variant="secondary" onClick={() => setActiveView("overview")}>
        Về trang chủ
      </Button>
    </section>
  );
}
