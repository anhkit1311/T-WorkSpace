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
  if (error) return <span className="chat-attachment-error">Không tải được tệp</span>;
  if (!url) return <span className="chat-attachment-loading">Đang tải tệp…</span>;
  return attachment.mimeType.startsWith("audio/") ? (
    <div className="chat-audio-attachment">
      <audio
        controls
        preload="metadata"
        src={url}
        aria-label={`Tin nhắn thoại: ${attachment.fileName}`}
      />
      <a href={url} download={attachment.fileName}>
        Tải bản ghi âm
      </a>
    </div>
  ) : (
    <a
      className="chat-attachment-card"
      href={url}
      download={attachment.fileName}
      target="_blank"
      rel="noreferrer"
    >
      {attachment.mimeType.startsWith("image/") ? (
        <div className="attachment-image-wrap">
          <img src={url} alt={attachment.fileName} loading="lazy" />
        </div>
      ) : (
        <div className="attachment-file-wrap">
          <div className="attachment-doc-badge">
            <Icon name="file" size={20} />
          </div>
          <div className="attachment-text-meta">
            <strong className="attachment-filename">{attachment.fileName}</strong>
            <span className="attachment-filesize">
              {formatFileSize(attachment.fileSize)} · {attachment.fileName.split(".").pop()?.toUpperCase() || "Tệp đính kèm"}
            </span>
          </div>
          <span className="attachment-download-circle" aria-hidden="true">
            <Icon name="download" size={16} />
          </span>
        </div>
      )}
    </a>
  );
}
