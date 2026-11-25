import { useEffect, useState } from "react";
import type { ChatMessageItem } from "@doan/shared";
import { getAttachmentBlobApi } from "./api";
import { Icon } from "../../shared/ui/Icon";
import { formatFileSize } from "../../shared/lib/file-size";

export function AttachmentView({
  attachment,
  accessToken,
}: {
  attachment: NonNullable<ChatMessageItem["attachment"]>;
  accessToken: string;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    getAttachmentBlobApi(accessToken, attachment.id)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (active) setUrl(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment.id, accessToken]);
  if (error) return <span className="text-xs text-muted-foreground">Không tải được tệp</span>;
  if (!url) return <span className="text-xs text-muted-foreground">Đang tải tệp…</span>;
  return attachment.mimeType.startsWith("audio/") ? (
    <div className="tw mt-0.5 flex items-center gap-2">
      <audio
        controls
        className="h-9 max-w-[min(100%,300px)]"
        preload="metadata"
        src={url}
        aria-label={`Tin nhắn thoại: ${attachment.fileName}`}
      />
      <a className="text-xs text-brand" href={url} download={attachment.fileName}>
        Tải bản ghi âm
      </a>
    </div>
  ) : (
    <a
      className="tw group/att mt-0.5 block max-w-[min(100%,360px)] text-foreground no-underline"
      href={url}
      download={attachment.fileName}
      target="_blank"
      rel="noreferrer"
    >
      {attachment.mimeType.startsWith("image/") ? (
        <img
          src={url}
          alt={attachment.fileName}
          loading="lazy"
          className="max-h-[280px] max-w-full rounded-xl border object-cover"
        />
      ) : (
        <div className="flex items-center gap-2.5 rounded-xl border bg-card px-2.5 py-2 group-hover/att:border-brand">
          <div className="grid size-[34px] shrink-0 place-items-center rounded-md bg-brand-soft text-brand">
            <Icon name="file" size={20} />
          </div>
          <div className="grid min-w-0">
            <strong className="truncate text-sm font-semibold">{attachment.fileName}</strong>
            <span className="text-xs text-muted-foreground">
              {formatFileSize(attachment.fileSize)} ·{" "}
              {attachment.fileName.split(".").pop()?.toUpperCase() || "Tệp đính kèm"}
            </span>
          </div>
          <span className="ml-auto text-muted-foreground" aria-hidden="true">
            <Icon name="download" size={16} />
          </span>
        </div>
      )}
    </a>
  );
}
