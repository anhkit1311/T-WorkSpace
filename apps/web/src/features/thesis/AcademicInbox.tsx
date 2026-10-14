import { useEffect, useState } from "react";
import { Button, Modal } from "../../shared/ui/Primitives";
import { academicApi } from "./api";
import { useThesis } from "./context";
import { formatDateTime } from "./labels";

interface Item {
  id: string;
  kind: string;
  entity: string;
  entityId: string;
  title: string;
  readAt: string | null;
  createdAt: string;
}

export function AcademicInbox({ onClose, onRead, onOpenProject }: { onClose: () => void; onRead: (unread: number) => void; onOpenProject: (projectId: string) => void }) {
  const { token } = useThesis();
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    void academicApi<{ notifications: Item[]; unread: number }>(token, "notifications").then((page) => {
      setItems(page.notifications);
      onRead(page.unread);
    });
  }, [token, onRead]);
  const markAll = async () => {
    await academicApi(token, "notifications/read", "POST", { all: true });
    setItems(items.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })));
    onRead(0);
  };
  const open = async (item: Item) => {
    if (!item.readAt) await academicApi(token, "notifications/read", "POST", { ids: [item.id] }).catch(() => undefined);
    if (item.entity === "project") onOpenProject(item.entityId);
    else onClose();
  };
  return (
    <Modal title="Thông báo đồ án" onClose={onClose} footer={<Button variant="secondary" onClick={() => void markAll()}>Đánh dấu tất cả đã đọc</Button>}>
      {items.length === 0 ? (
        <p>Chưa có thông báo.</p>
      ) : (
        <ul className="thesis-inbox">
          {items.map((item) => (
            <li key={item.id} className={item.readAt ? "" : "is-unread"}>
              <button type="button" onClick={() => void open(item)}>
                <span>{item.title}</span>
                <small>{formatDateTime(item.createdAt)}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
