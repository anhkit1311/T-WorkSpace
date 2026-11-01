import { useEffect, useState } from "react";
import type { GroupMemberItem } from "@doan/shared";
import { useApp } from "../../app/providers/AppContext";
import { Button, Field, Modal } from "../../shared/ui/Primitives";
import { getWorkspaceMembersApi } from "../chat/api";
import { getCouncilApi, saveCouncilApi } from "./api";
import "./meeting-council.css";

const DEFAULT_CRITERIA = "Nội dung và kết quả | 40\nTrình bày | 20\nTrả lời câu hỏi | 30\nHình thức báo cáo | 10";

/** "Tên tiêu chí | trọng số" per line; null when a line does not parse. */
function parseCriteria(text: string) {
  const rows = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^(.+?)\s*\|\s*(\d{1,3})$/.exec(line);
      return match ? { label: match[1].trim(), weight: Number(match[2]) } : null;
    });
  return rows.every(Boolean) ? (rows as { label: string; weight: number }[]) : null;
}

/** NV-MT3: the organizer turns a scheduled meeting into a council — members, presenters, criteria. */
export function CouncilSetupDialog({
  scheduleId,
  workspaceId,
  onClose,
  onSaved,
}: {
  scheduleId: string;
  workspaceId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { accessToken } = useApp();
  const [people, setPeople] = useState<GroupMemberItem[] | null>(null);
  const [chairId, setChairId] = useState("");
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [presenters, setPresenters] = useState<{ userId: string; topic: string }[]>([]);
  const [criteria, setCriteria] = useState(DEFAULT_CRITERIA);
  const [locked, setLocked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!accessToken) return;
    void (async () => {
      try {
        const [members, council] = await Promise.all([
          getWorkspaceMembersApi(accessToken, workspaceId),
          getCouncilApi(accessToken, scheduleId),
        ]);
        setPeople(members.filter((member) => member.status === "active"));
        if (!council) return;
        setChairId(council.members.find((member) => member.role === "chair")?.userId ?? "");
        setMemberIds(council.members.filter((member) => member.role === "member").map((member) => member.userId));
        setPresenters(council.presenters.map(({ userId, topic }) => ({ userId, topic })));
        setCriteria(council.criteria.map((item) => `${item.label} | ${item.weight}`).join("\n"));
        setLocked(council.locked);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : "Không tải được thông tin nhóm.");
      }
    })();
  }, [accessToken, workspaceId, scheduleId]);

  const parsed = parseCriteria(criteria);
  const weight = parsed?.reduce((sum, item) => sum + item.weight, 0) ?? 0;
  const council = new Set([chairId, ...memberIds]);
  const ready =
    !locked &&
    Boolean(chairId) &&
    council.size >= 2 &&
    presenters.length > 0 &&
    presenters.every((item) => item.topic.trim()) &&
    weight === 100;

  const toggleMember = (userId: string, on: boolean) =>
    setMemberIds((old) => (on ? [...old, userId] : old.filter((id) => id !== userId)));
  const togglePresenter = (userId: string, on: boolean) =>
    setPresenters((old) => (on ? [...old, { userId, topic: "" }] : old.filter((item) => item.userId !== userId)));

  const save = async () => {
    if (!accessToken || !ready || !parsed) return;
    setSaving(true);
    setError("");
    try {
      await saveCouncilApi(accessToken, scheduleId, {
        chairId,
        memberIds: memberIds.filter((id) => id !== chairId),
        presenters: presenters.map((item) => ({ userId: item.userId, topic: item.topic.trim() })),
        criteria: parsed,
      });
      onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Không lưu được hội đồng.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Thiết lập hội đồng"
      onClose={() => !saving && onClose()}
      footer={
        <div className="modal-footer-actions">
          <Button variant="ghost" disabled={saving} onClick={onClose}>
            Đóng
          </Button>
          <Button loading={saving} disabled={!ready} onClick={() => void save()}>
            Lưu hội đồng
          </Button>
        </div>
      }
    >
      <div className="ws-modal-form">
        {locked && <p role="status">Hội đồng đã bắt đầu chấm nên không sửa được thiết lập.</p>}
        {error && <p role="alert">{error}</p>}
        {!people ? (
          <p>Đang tải thành viên nhóm…</p>
        ) : (
          <>
            <Field label="Chủ tịch hội đồng">
              <select value={chairId} disabled={locked} onChange={(event) => setChairId(event.target.value)}>
                <option value="">Chọn chủ tịch</option>
                {people
                  .filter((person) => !presenters.some((item) => item.userId === person.userId))
                  .map((person) => (
                    <option key={person.userId} value={person.userId}>
                      {person.displayName}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Thành viên hội đồng" hint="Cùng chủ tịch: 2–7 người.">
              <div className="meeting-council-setup__people">
                {people
                  .filter((person) => person.userId !== chairId && !presenters.some((item) => item.userId === person.userId))
                  .map((person) => (
                    <label key={person.userId}>
                      <input
                        type="checkbox"
                        disabled={locked}
                        checked={memberIds.includes(person.userId)}
                        onChange={(event) => toggleMember(person.userId, event.target.checked)}
                      />
                      {person.displayName}
                    </label>
                  ))}
              </div>
            </Field>
            <Field label="Người trình bày" hint="Thứ tự trình bày theo thứ tự chọn; nhập tên đề tài cho từng người.">
              <div className="meeting-council-setup__people">
                {people
                  .filter((person) => !council.has(person.userId))
                  .map((person) => {
                    const chosen = presenters.find((item) => item.userId === person.userId);
                    return (
                      <label key={person.userId}>
                        <input
                          type="checkbox"
                          disabled={locked}
                          checked={Boolean(chosen)}
                          onChange={(event) => togglePresenter(person.userId, event.target.checked)}
                        />
                        {chosen ? `${presenters.indexOf(chosen) + 1}. ` : ""}
                        {person.displayName}
                        {chosen && (
                          <input
                            type="text"
                            maxLength={200}
                            disabled={locked}
                            value={chosen.topic}
                            placeholder="Tên đề tài"
                            aria-label={`Đề tài của ${person.displayName}`}
                            onChange={(event) =>
                              setPresenters((old) =>
                                old.map((item) => (item.userId === person.userId ? { ...item, topic: event.target.value } : item)),
                              )
                            }
                          />
                        )}
                      </label>
                    );
                  })}
              </div>
            </Field>
            <Field
              label="Tiêu chí chấm (mỗi dòng: tên | trọng số %)"
              error={!parsed ? "Mỗi dòng có dạng: Trình bày | 20" : weight !== 100 ? `Tổng trọng số đang là ${weight}, cần bằng 100.` : undefined}
            >
              <textarea className="meeting-council-setup__criteria" rows={4} disabled={locked} value={criteria} onChange={(event) => setCriteria(event.target.value)} />
            </Field>
          </>
        )}
      </div>
    </Modal>
  );
}
