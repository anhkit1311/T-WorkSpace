import { useState } from "react";
import { AnimatePresence } from "motion/react";
import type { ChatMessageItem } from "@doan/shared";
import { Button, Modal } from "../../shared/ui/Primitives";
import { Icon } from "../../shared/ui/Icon";
import { MeetingOutcomesPanel } from "./MeetingOutcomesPanel";
import "./meeting-outcomes.css";

// Rendered in place of a normal bubble for messages of kind "meeting_summary".
export function MeetingSummaryCard({ message }: { message: ChatMessageItem }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="meeting-summary-card">
      <header>
        <Icon name="video" size={14} />
        Tổng kết cuộc họp
      </header>
      <p>{message.content.replace(/^Tổng kết cuộc họp: /, "")}</p>
      {message.meetingSessionId && (
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
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
