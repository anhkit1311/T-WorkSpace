import { useState } from "react";
import { AnimatePresence } from "motion/react";
import type { ChatMessageItem } from "@doan/shared";
import { Button, Modal } from "../../shared/ui/Primitives";
import { Icon } from "../../shared/ui/Icon";
import { MeetingOutcomesPanel } from "./MeetingOutcomesPanel";

// Rendered in place of a normal bubble for messages of kind "meeting_summary".
export function MeetingSummaryCard({ message }: { message: ChatMessageItem }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="tw grid max-w-[560px] gap-1.5 rounded-xl border border-[#2f6bff]/20 bg-[var(--tint-blue-bg)] px-3.5 py-3 text-sm text-foreground">
      <header className="flex items-center gap-2 text-xs font-semibold text-[var(--tint-blue-fg)]">
        <Icon name="video" size={14} />
        Tổng kết cuộc họp
      </header>
      <p className="leading-normal whitespace-pre-wrap [overflow-wrap:anywhere]">
        {message.content.replace(/^Tổng kết cuộc họp: /, "")}
      </p>
      {message.meetingSessionId && (
        <Button
          size="sm"
          variant="ghost"
          className="justify-self-start"
          onClick={() => setOpen(true)}
        >
          Xem chi tiết
        </Button>
      )}
      <AnimatePresence>
        {open && message.meetingSessionId && (
          <Modal title="Kết quả cuộc họp" eyebrow="Tổng kết" onClose={() => setOpen(false)}>
            <MeetingOutcomesPanel sessionId={message.meetingSessionId} live={false} />
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}
