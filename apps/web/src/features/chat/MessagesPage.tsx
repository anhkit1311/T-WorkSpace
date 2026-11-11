import { PageHeader } from "../../shared/ui/Primitives";
import { ChatPage } from "./LiveChatPage";
import "./messages-page.css";

/** Top-level "Tin nhắn" view: group chats and direct conversations in the TDTU page frame. */
export function MessagesPage() {
  return (
    <div className="messages-page">
      <PageHeader
        className="messages-page__header"
        title="Tin nhắn"
        meta="Nhóm chat và trò chuyện riêng với đồng nghiệp"
      />
      <div className="messages-page__card">
        <ChatPage />
      </div>
    </div>
  );
}
