import { useEffect, useState } from "react";
import type { CcAgentProfile, CcCallOffer, CcTransferDirectory } from "@doan/shared";
import { Button } from "../../shared/ui/Primitives";
import { Icon } from "../../shared/ui/Icon";

type Api = <T>(path: string, method?: string, body?: object) => Promise<T>;

const STATE: Record<string, string> = { ready: "sẵn sàng", not_ready: "tạm nghỉ", offline: "ngoại tuyến", ringing: "đang đổ chuông", on_call: "đang bận", wrap_up: "đang hoàn tất" };

/** CC-10: transfer the current call to a department queue or an extension, blind or after consulting. */
export function TransferPanel({
  offer,
  api,
  fail,
  onChange,
}: {
  offer: CcCallOffer;
  api: Api;
  fail: (error: unknown) => void;
  onChange: (me: CcAgentProfile) => void;
}) {
  const [open, setOpen] = useState(false);
  const [directory, setDirectory] = useState<CcTransferDirectory | null>(null);
  const [target, setTarget] = useState("");
  const [attended, setAttended] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && !directory) api<CcTransferDirectory>("transfer-directory").then(setDirectory, fail);
  }, [api, directory, fail, open]);

  const run = (path: string, body?: object) => {
    setBusy(true);
    api<CcAgentProfile>(path, "POST", body)
      .then((me) => {
        onChange(me);
        setOpen(false);
      }, fail)
      .finally(() => setBusy(false));
  };

  const transfer = offer.transfer;
  if (transfer)
    return (
      <div className="desk-transfer" role="status">
        <Icon name="phone-call" size={16} />
        <span>
          {transfer.answered ? `Máy lẻ ${transfer.target} đã nghe máy — khách đang chờ.` : `Đang gọi máy lẻ ${transfer.target}…`}
        </span>
        <div className="desk-actions">
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => run("me/transfer/cancel")}>Quay lại với khách</Button>
          <Button size="sm" icon="check" disabled={busy || !transfer.answered} onClick={() => run("me/transfer/complete")}>Hoàn tất chuyển</Button>
        </div>
      </div>
    );

  if (!open)
    return (
      <Button size="sm" variant="secondary" icon="share" onClick={() => setOpen(true)}>
        Chuyển máy
      </Button>
    );

  const [kind, value] = target.split(":");
  return (
    <form
      className="desk-transfer"
      onSubmit={(event) => {
        event.preventDefault();
        if (!value) return;
        run("me/transfer", kind === "dept" ? { departmentId: value } : { extension: value, attended });
      }}
    >
      <select aria-label="Chuyển đến" value={target} onChange={(event) => setTarget(event.target.value)} required>
        <option value="">— Chọn nơi nhận —</option>
        <optgroup label="Phòng ban (qua hàng đợi)">
          {directory?.departments
            .filter((department) => department.id !== offer.departmentId)
            .map((department) => <option key={department.id} value={`dept:${department.id}`}>{department.name}</option>)}
        </optgroup>
        <optgroup label="Máy lẻ">
          {directory?.extensions.map((extension) => (
            <option key={extension.number} value={`ext:${extension.number}`}>
              {extension.number} · {extension.name} ({extension.departmentName}{extension.state ? `, ${STATE[extension.state]}` : ""})
            </option>
          ))}
        </optgroup>
      </select>
      {kind === "ext" && (
        <label className="desk-check">
          <input type="checkbox" checked={attended} onChange={(event) => setAttended(event.target.checked)} />
          Hỏi ý người nhận trước khi chuyển
        </label>
      )}
      <div className="desk-actions">
        <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>Hủy</Button>
        <Button size="sm" type="submit" icon="share" disabled={busy || !value}>{kind === "ext" && attended ? "Gọi hỏi ý" : "Chuyển thẳng"}</Button>
      </div>
    </form>
  );
}
