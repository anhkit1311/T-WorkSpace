import { useEffect, useState } from "react";
import { AnimatePresence } from "motion/react";
import type { GroupMemberItem, WorkspaceItem } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { useSocket } from "../../app/providers/SocketContext";
import { Avatar, Badge, Button, ConfirmDialog, Modal } from "../../shared/ui/Primitives";
import { getWorkspaceMembersApi, getWorkspacesApi } from "../chat/api";
import { useUserAvatars } from "../chat/useUserAvatars";
import { governanceApi } from "./api";
import { CreateGroupDialog, JoinGroupDialog, NoGroups } from "./GroupDialogs";
import "./groups-page.css";

const ROLE: Record<WorkspaceItem["role"], string> = { owner: "Chủ nhóm", admin: "Quản trị viên", member: "Thành viên" };

/**
 * "Nhóm của tôi": only for managing groups (create, join, members, leave). Day-to-day work lives in
 * Tin nhắn, Họp, Công việc and Tài liệu, which gather every group.
 */
export function GroupsPage() {
  const { accessToken, navigate, notify } = useApp();
  const [groups, setGroups] = useState<WorkspaceItem[] | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [dialog, setDialog] = useState<"create" | "join" | null>(null);
  const [membersOf, setMembersOf] = useState<WorkspaceItem | null>(null);
  const [leaving, setLeaving] = useState<WorkspaceItem | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    getWorkspacesApi(accessToken)
      .then((items) => active && (setGroups(items), setError("")))
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : "Không tải được danh sách nhóm."));
    return () => {
      active = false;
    };
  }, [accessToken, revision]);

  const leave = async () => {
    if (!accessToken || !leaving) return;
    setBusy(true);
    try {
      await governanceApi(accessToken, `workspaces/${leaving.id}/leave`, "POST");
      notify("Đã rời nhóm", `Bạn đã rời khỏi nhóm "${leaving.name}".`, "info");
      setLeaving(null);
      setRevision((value) => value + 1);
    } catch (reason) {
      notify("Không thể rời nhóm", reason instanceof Error ? reason.message : "Vui lòng thử lại.", "warning");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="groups-page" aria-labelledby="groups-title">
      <header className="groups-page__head">
        <div>
          <h1 id="groups-title">Nhóm của tôi</h1>
          <p>Tạo nhóm, mời người, quản lý thành viên và kênh.</p>
        </div>
        {!!groups?.length && (
          <div className="groups-page__actions">
            <Button variant="secondary" icon="link" onClick={() => setDialog("join")}>
              Nhập mã mời
            </Button>
            <Button icon="plus" onClick={() => setDialog("create")}>
              Tạo nhóm
            </Button>
          </div>
        )}
      </header>
      {error && (
        <p className="inline-alert" role="alert">
          {error}
        </p>
      )}
      {!groups && !error && <p role="status">Đang tải…</p>}
      {groups?.length === 0 && <NoGroups text="Tạo một nhóm mới hoặc dùng mã mời để tham gia nhóm có sẵn." />}
      {!!groups?.length && (
        <ul className="groups-page__list">
          {groups.map((group) => {
            const manages = group.role !== "member";
            return (
              <li key={group.id} className="groups-page__item">
                <div className="groups-page__info">
                  <strong>{group.name}</strong>
                  <span>
                    {group.memberCount ?? 1} người · {ROLE[group.role]}
                    {group.archivedAt ? " · Đã lưu trữ" : ""}
                  </span>
                </div>
                <div className="groups-page__item-actions">
                  <Button size="sm" variant="ghost" onClick={() => setMembersOf(group)}>
                    Thành viên
                  </Button>
                  {group.role !== "owner" && (
                    <Button size="sm" variant="ghost" onClick={() => setLeaving(group)}>
                      Rời nhóm
                    </Button>
                  )}
                  {manages && (
                    <Button size="sm" variant="secondary" icon="settings" onClick={() => navigate({ view: "admin", workspaceId: group.id })}>
                      Quản lý
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <AnimatePresence>
        {dialog === "create" && (
          <CreateGroupDialog
            onClose={() => setDialog(null)}
            onCreated={() => {
              setDialog(null);
              setRevision((value) => value + 1);
            }}
          />
        )}
        {dialog === "join" && <JoinGroupDialog onClose={() => setDialog(null)} />}
        {membersOf && <MembersDialog group={membersOf} onClose={() => setMembersOf(null)} />}
        {leaving && (
          <ConfirmDialog
            title="Rời nhóm"
            description={`Bạn sẽ mất quyền đọc nội dung và mọi kênh riêng tư trong ${leaving.name}. Muốn tham gia lại, bạn cần lời mời mới.`}
            confirmLabel="Rời nhóm"
            loading={busy}
            onClose={() => setLeaving(null)}
            onConfirm={() => void leave()}
          />
        )}
      </AnimatePresence>
    </section>
  );
}

function MembersDialog({ group, onClose }: { group: WorkspaceItem; onClose: () => void }) {
  const { accessToken, user } = useApp();
  const { onlineUserIds } = useSocket();
  const [members, setMembers] = useState<GroupMemberItem[] | null>(null);
  const [error, setError] = useState("");
  const avatarOf = useUserAvatars(members?.map((member) => member.userId) ?? []);
  useEffect(() => {
    if (!accessToken) return;
    getWorkspaceMembersApi(accessToken, group.id)
      .then(setMembers)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Không tải được thành viên."));
  }, [accessToken, group.id]);
  return (
    <Modal title={`Thành viên: ${group.name}`} onClose={onClose}>
      {error && <p role="alert">{error}</p>}
      {!members && !error && <p role="status">Đang tải…</p>}
      <ul className="groups-page__members">
        {members?.map((member) => {
          const online = onlineUserIds.includes(member.userId);
          return (
            <li key={member.userId}>
              <Avatar name={member.displayName} image={avatarOf(member.userId)} size="md" />
              <span className="groups-page__member-name">
                <strong>
                  {member.displayName}
                  {member.userId === user?.id ? " (Bạn)" : ""}
                </strong>
                <span>{member.email}</span>
              </span>
              <Badge tone={member.role === "member" ? "neutral" : "blue"}>{ROLE[member.role]}</Badge>
              <span className={`groups-page__presence ${online ? "is-online" : ""}`}>{online ? "Trực tuyến" : "Ngoại tuyến"}</span>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
