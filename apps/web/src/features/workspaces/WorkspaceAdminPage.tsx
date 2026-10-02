import { useEffect, useState, type FormEvent } from "react";
import type { WorkspaceItem } from "@doan/shared";
import { getWorkspacesApi, getWorkspaceMembersApi, rejectMemberApi } from "../chat/api";
import { governanceApi, type Administration } from "./api";
import { Button, Modal } from "../../shared/ui/Primitives";
import { useApp } from "../../app/providers/AppContext";
import { formatFileSize } from "../../shared/lib/file-size";
import { useSocket } from "../../app/providers/SocketContext";
import "./workspace-admin.css";

const labels: Record<string, string> = {
  "workspace.updated": "Sửa thông tin nhóm",
  "workspace.archived": "Lưu trữ nhóm",
  "workspace.restored": "Khôi phục nhóm",
  "member.add": "Thêm thành viên",
  "member.remove": "Loại thành viên",
  "member.leave": "Rời nhóm",
  "member.transfer": "Chuyển chủ sở hữu",
  "member.role": "Đổi vai trò",
  "channel.created": "Tạo kênh",
  "channel.updated": "Sửa kênh",
  "channel.reordered": "Sắp xếp kênh",
  "channel.member_added": "Cấp quyền kênh",
  "channel.member_removed": "Thu hồi quyền kênh",
  "invitation.created": "Tạo lời mời",
  "invitation.revoked": "Thu hồi lời mời",
  "invitation.accepted": "Nhận lời mời",
};

export function WorkspaceAdminPage() {
  const { accessToken, user, route, navigate, notify } = useApp();
  const { reconnect } = useSocket();
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([]);
  const [data, setData] = useState<Administration | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [memberFilter, setMemberFilter] = useState("");
  const [email, setEmail] = useState("");
  const [sendEmail, setSendEmail] = useState(false);
  const [inviteLink, setInviteLink] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [channelName, setChannelName] = useState("");
  const [channelDescription, setChannelDescription] = useState("");
  const [channelType, setChannelType] = useState("text");
  const [privateChannel, setPrivateChannel] = useState(false);
  const [confirm, setConfirm] = useState<{
    title: string;
    description: string;
    run: () => Promise<void>;
  } | null>(null);
  const workspaceId = route.workspaceId;
  const owner = data?.workspace.ownerId === user?.id;

  useEffect(() => {
    if (!accessToken || route.view !== "admin") return;
    let active = true;
    setLoading(true);
    setError("");
    setData(null);
    void getWorkspacesApi(accessToken)
      .then(async (items) => {
        if (!active) return;
        const managed = items.filter((item) => item.role !== "member");
        setWorkspaces(managed);
        const selected = workspaceId ? managed.find((item) => item.id === workspaceId) : managed[0];
        if (!selected) {
          if (workspaceId) setError("Nhóm không tồn tại hoặc bạn không có quyền quản trị.");
          return;
        }
        if (!workspaceId) {
          navigate({ view: "admin", workspaceId: selected.id }, true);
          return;
        }
        const [details, members] = await Promise.all([
          governanceApi<Administration>(accessToken, `workspaces/${selected.id}/administration`),
          getWorkspaceMembersApi(accessToken, selected.id),
        ]);
        if (active) {
          setData({ ...details, members });
          setName(details.workspace.name);
          setDescription(details.workspace.description);
        }
      })
      .catch((reason) => {
        if (active)
          setError(reason instanceof Error ? reason.message : "Không tải được trang quản trị.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [accessToken, workspaceId, revision, navigate, route.view]);

  async function mutate(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
      setConfirm(null);
      setRevision((value) => value + 1);
      reconnect();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Thao tác thất bại.");
    } finally {
      setBusy(false);
    }
  }
  const action = (path: string, body: object, method = "POST") =>
    governanceApi(accessToken!, `workspaces/${workspaceId}/${path}`, method, body);
  function editChannel(id: string) {
    const channel = data?.channels.find((item) => item.id === id);
    setEditing(id);
    setChannelName(channel?.name ?? "");
    setChannelDescription(channel?.description ?? "");
    setChannelType(channel?.type ?? "text");
    setPrivateChannel(channel?.isPrivate ?? false);
  }
  async function submitChannel(event: FormEvent) {
    event.preventDefault();
    await mutate(async () => {
      await action(
        `channels/manage${editing ? `/${editing}` : ""}`,
        {
          name: channelName,
          description: channelDescription,
          type: channelType,
          isPrivate: privateChannel,
        },
        editing ? "PATCH" : "POST",
      );
      setEditing(null);
    });
  }
  const members =
    data?.members?.filter((item) =>
      `${item.displayName} ${item.email} ${item.role}`
        .toLowerCase()
        .includes(memberFilter.toLowerCase()),
    ) ?? [];
  const archived = Boolean(data?.workspace.archivedAt);

  return (
    <section className="workspace-admin" aria-label="Quản trị nhóm">
      <header>
        <h1>Quản trị nhóm</h1>
        <p>Thành viên, lời mời, kênh và nhật ký của workspace.</p>
        <label>
          Nhóm quản lý
          <select
            value={workspaceId ?? ""}
            onChange={(event) => {
              setInviteLink("");
              navigate({ view: "admin", workspaceId: event.target.value });
            }}
            disabled={busy}
          >
            {!workspaces.length && <option value="">Chưa có quyền quản trị</option>}
            {workspaces.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.archivedAt ? " · đã lưu trữ" : ""}
              </option>
            ))}
          </select>
        </label>
      </header>
      {error && (
        <p role="alert" className="admin-error">
          {error}
        </p>
      )}
      {loading && <p role="status">Đang tải…</p>}
      {data && (
        <>
          <section>
            <h2>Thông tin nhóm</h2>
            {archived && (
              <p role="status">
                Đã lưu trữ: lịch sử và tệp vẫn xem được; không gửi tin, sửa dữ liệu hoặc tham gia
                họp.
              </p>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void mutate(() => action("settings", { name, description }, "PATCH"));
              }}
            >
              <label>
                Tên nhóm
                <input
                  value={name}
                  maxLength={80}
                  required
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <label>
                Mô tả
                <textarea
                  value={description}
                  maxLength={1000}
                  onChange={(event) => setDescription(event.target.value)}
                />
              </label>
              <Button type="submit" disabled={busy || archived}>
                Lưu thông tin
              </Button>
            </form>
            {owner && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  setConfirm({
                    title: archived ? "Khôi phục nhóm" : "Lưu trữ nhóm",
                    description: archived
                      ? "Cho phép nhóm tiếp tục cộng tác."
                      : "Nhóm sẽ chuyển sang chế độ chỉ đọc và các kết nối đang hoạt động sẽ được yêu cầu kết nối lại.",
                    run: async () => {
                      await action("settings", { archived: !archived }, "PATCH");
                    },
                  })
                }
              >
                {archived ? "Khôi phục nhóm" : "Lưu trữ nhóm"}
              </Button>
            )}
          </section>
          <section>
            <h2>Thành viên ({data.members?.length})</h2>
            <input
              aria-label="Tìm thành viên theo tên, email, vai trò"
              placeholder="Tìm tên, email hoặc vai trò…"
              value={memberFilter}
              onChange={(event) => setMemberFilter(event.target.value)}
            />
            <div className="admin-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Thành viên</th>
                    <th>Vai trò</th>
                    <th>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <tr key={member.userId}>
                      <td>
                        <strong>{member.displayName}</strong>
                        <small>{member.email}</small>
                      </td>
                      <td>
                        {member.role === "owner" ? (
                          "Chủ nhóm"
                        ) : owner ? (
                          <select
                            aria-label={`Vai trò của ${member.displayName}`}
                            disabled={busy || archived}
                            value={member.role}
                            onChange={(event) =>
                              void mutate(() =>
                                action("roles", {
                                  userId: member.userId,
                                  role: event.target.value,
                                }),
                              )
                            }
                          >
                            <option value="member">Thành viên</option>
                            <option value="admin">Quản trị viên</option>
                          </select>
                        ) : member.role === "admin" ? (
                          "Quản trị viên"
                        ) : (
                          "Thành viên"
                        )}
                      </td>
                      <td>
                        {owner && member.userId !== user?.id && (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy || archived}
                            onClick={() =>
                              setConfirm({
                                title: "Chuyển chủ sở hữu",
                                description: `Chuyển quyền chủ nhóm cho ${member.displayName}. Bạn sẽ trở thành quản trị viên.`,
                                run: async () => {
                                  await action("transfer", { userId: member.userId });
                                },
                              })
                            }
                          >
                            Chuyển chủ nhóm
                          </Button>
                        )}
                        {member.role !== "owner" && (owner || member.role !== "admin") && (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy || archived}
                            onClick={() =>
                              setConfirm({
                                title: "Loại thành viên",
                                description: `${member.displayName} sẽ mất quyền nhóm và mọi kênh riêng tư trong nhóm.`,
                                run: () =>
                                  rejectMemberApi(accessToken!, workspaceId!, member.userId),
                              })
                            }
                          >
                            Loại khỏi nhóm
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section>
            <h2>Lời mời</h2>
            <p>
              Để trống email để tạo liên kết một lần cho người nhận bất kỳ có tài khoản đã xác thực.
            </p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void mutate(async () => {
                  const result = await governanceApi<{ link: string; delivery?: string }>(
                    accessToken!,
                    `workspaces/${workspaceId}/invitations`,
                    "POST",
                    { email, sendEmail },
                  );
                  setInviteLink(result.link);
                  if (result.delivery === "failed")
                    notify(
                      "Đã tạo liên kết",
                      "Email chưa gửi được. Sao chép liên kết hoặc cấu hình dịch vụ email.",
                      "info",
                    );
                });
              }}
            >
              <label>
                Email người nhận
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label className="admin-check">
                <input
                  type="checkbox"
                  checked={sendEmail}
                  disabled={!email}
                  onChange={(event) => setSendEmail(event.target.checked)}
                />
                Gửi lời mời qua email
              </label>
              <Button type="submit" disabled={busy || archived}>
                Tạo lời mời
              </Button>
            </form>
            {inviteLink && (
              <div className="admin-invitation-link">
                <input readOnly aria-label="Liên kết lời mời mới" value={inviteLink} />
                <Button
                  size="sm"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(inviteLink)
                      .then(() => notify("Đã sao chép lời mời"))
                      .catch(() =>
                        setError("Không sao chép được. Chọn liên kết và sao chép thủ công."),
                      )
                  }
                >
                  Sao chép
                </Button>
              </div>
            )}
            <ul>
              {data.invitations.map((invite) => (
                <li key={invite.id}>
                  <span>
                    {invite.email ?? "Liên kết một lần"} ·{" "}
                    {
                      {
                        pending: "Đang chờ",
                        accepted: "Đã nhận",
                        expired: "Hết hạn",
                        revoked: "Đã thu hồi",
                      }[invite.status]
                    }{" "}
                    · hết hạn {new Date(invite.expiresAt).toLocaleDateString("vi-VN")}
                  </span>
                  {invite.status !== "accepted" && invite.status !== "revoked" && (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy || archived}
                        onClick={() =>
                          void mutate(async () => {
                            const result = await governanceApi<{ link: string }>(
                              accessToken!,
                              `workspaces/${workspaceId}/invitations/${invite.id}`,
                              "POST",
                              { sendEmail: Boolean(invite.email) },
                            );
                            setInviteLink(result.link);
                          })
                        }
                      >
                        Tạo lại / gửi lại
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy || archived}
                        onClick={() =>
                          void mutate(() => action(`invitations/${invite.id}`, {}, "DELETE"))
                        }
                      >
                        Thu hồi
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2>Kênh ({data.channels.length})</h2>
            <p>
              Kênh riêng tư chỉ cho thành viên được cấp quyền đọc nội dung, kể cả quản trị viên.
              Quyền quản lý kênh không tự cấp quyền đọc.
            </p>
            <Button size="sm" disabled={busy || archived} onClick={() => editChannel("")}>
              Tạo kênh
            </Button>
            <div className="admin-channel-list">
              {data.channels.map((channel, index) => (
                <article key={channel.id}>
                  <h3>{channel.name}</h3>
                  <p>
                    {channel.type} · {channel.isPrivate ? "Riêng tư" : "Công khai trong nhóm"}
                    {channel.archivedAt ? " · Đã lưu trữ" : ""}
                  </p>
                  <div className="admin-actions">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy || archived}
                      onClick={() => editChannel(channel.id)}
                    >
                      Chỉnh sửa
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy || archived}
                      onClick={() =>
                        void mutate(() =>
                          action(
                            `channels/manage/${channel.id}`,
                            { archived: !channel.archivedAt },
                            "PATCH",
                          ),
                        )
                      }
                    >
                      {channel.archivedAt ? "Khôi phục" : "Lưu trữ"}
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy || archived || index === 0}
                      onClick={() =>
                        void mutate(() => {
                          const ids = data.channels.map((item) => item.id);
                          [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
                          return action("channels/order", { ids });
                        })
                      }
                    >
                      Đưa lên
                    </Button>
                  </div>
                  {channel.isPrivate && (
                    <details>
                      <summary>Thành viên kênh ({channel.memberIds.length})</summary>
                      {data.members?.map((member) => (
                        <label className="admin-check" key={member.userId}>
                          <input
                            type="checkbox"
                            disabled={busy || archived}
                            checked={channel.memberIds.includes(member.userId)}
                            onChange={(event) =>
                              void mutate(() =>
                                action("channel-members", {
                                  channelId: channel.id,
                                  userId: member.userId,
                                  allowed: event.target.checked,
                                }),
                              )
                            }
                          />
                          {member.displayName}
                        </label>
                      ))}
                    </details>
                  )}
                </article>
              ))}
            </div>
          </section>
          <section>
            <h2>Dung lượng tệp</h2>
            <p>
              {data.usage.files} tệp · {formatFileSize(Number(data.usage.bytes))} /{" "}
              {formatFileSize(data.usage.quotaBytes)} đã dùng. Giới hạn mỗi tệp: 8 MB.
            </p>
          </section>
          <section>
            <h2>Nhật ký quản trị</h2>
            <p>100 thao tác gần nhất. Không lưu mã lời mời trong nhật ký.</p>
            <ol>
              {data.audit.map((event) => (
                <li key={event.id}>
                  <span>
                    {labels[event.action] ?? event.action} · {event.actorName ?? "Tài khoản đã xóa"}
                  </span>
                  <time dateTime={event.createdAt}>
                    {new Date(event.createdAt).toLocaleString("vi-VN")}
                  </time>
                </li>
              ))}
            </ol>
            {!data.audit.length && <p>Chưa có thao tác quản trị.</p>}
          </section>
        </>
      )}
      {editing !== null && (
        <Modal
          title={editing ? "Chỉnh sửa kênh" : "Tạo kênh"}
          onClose={() => {
            if (!busy) setEditing(null);
          }}
        >
          <form onSubmit={submitChannel}>
            {error && <p role="alert">{error}</p>}
            <label>
              Tên kênh
              <input
                value={channelName}
                maxLength={80}
                required
                onChange={(event) => setChannelName(event.target.value)}
              />
            </label>
            <label>
              Mô tả
              <textarea
                maxLength={500}
                value={channelDescription}
                onChange={(event) => setChannelDescription(event.target.value)}
              />
            </label>
            <label>
              Loại kênh
              <select
                value={channelType}
                disabled={Boolean(editing)}
                onChange={(event) => setChannelType(event.target.value)}
              >
                <option value="text">Trò chuyện</option>
                <option value="voice">Âm thanh</option>
                <option value="video">Video</option>
              </select>
            </label>
            <label className="admin-check">
              <input
                type="checkbox"
                checked={privateChannel}
                onChange={(event) => setPrivateChannel(event.target.checked)}
              />
              Kênh riêng tư
            </label>
            <Button type="submit" disabled={busy || archived} loading={busy}>
              Lưu kênh
            </Button>
          </form>
        </Modal>
      )}
      {confirm && (
        <Modal
          title={confirm.title}
          onClose={() => {
            if (!busy) setConfirm(null);
          }}
        >
          <p>{confirm.description}</p>
          <div className="admin-actions">
            <Button disabled={busy} loading={busy} onClick={() => void mutate(confirm.run)}>
              Xác nhận
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirm(null)}>
              Hủy
            </Button>
          </div>
        </Modal>
      )}
    </section>
  );
}
