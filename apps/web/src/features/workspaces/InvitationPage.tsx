import { useState } from "react";
import { governanceApi } from "./api";
import { Button } from "../../shared/ui/Primitives";
import { useApp } from "../../app/providers/AppContext";

export function InvitationPage() {
  const { route, accessToken, openWorkspace, setActiveView, user } = useApp();
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
      openWorkspace(result.workspaceId, "workspace");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không nhận được lời mời.");
    } finally {
      setBusy(false);
    }
  };
  if (route.view !== "invitation") return null;
  return (
    <section className="workspace-home invitation-page" aria-label="Lời mời tham gia nhóm">
      <header className="page-hero">
        <h1>Lời mời tham gia nhóm</h1>
        <p>
          Bạn đang đăng nhập bằng <strong>{user?.email}</strong>. Lời mời gắn email chỉ được nhận
          bằng đúng email đã xác thực; liên kết dùng một lần và hết hạn sau 7 ngày.
        </p>
        <div className="page-hero__actions">
          <Button
            icon="check"
            disabled={busy || !route.invitationToken}
            loading={busy}
            onClick={() => void accept()}
          >
            Nhận lời mời
          </Button>
          <Button variant="secondary" icon="home" onClick={() => setActiveView("overview")}>
            Về trang chủ
          </Button>
        </div>
      </header>
      {(!route.invitationToken || error) && (
        <p className="inline-alert" role="alert">
          {error || "Liên kết thiếu mã lời mời. Hãy mở đầy đủ liên kết được gửi cho bạn."}
        </p>
      )}
    </section>
  );
}
