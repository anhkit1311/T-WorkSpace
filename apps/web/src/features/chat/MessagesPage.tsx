import { ChatPage } from "./LiveChatPage";
import "./messages-page.css";

/** Top-level "Tin nhắn" view: group channels and direct conversations in the TDTU page frame. */
export function MessagesPage() {
  return (
    <div className="messages-page">
      <header className="messages-page__header">
        <div>
          <h1 className="messages-page__title">Tin nhắn</h1>
          <p className="messages-page__subtitle">
            Nhắn tin trực tiếp với đồng nghiệp; kênh nhóm nằm trong tab Trao đổi của từng nhóm
          </p>
        </div>
      </header>
      <div className="messages-page__card">
        <ChatPage />
      </div>
    </div>
  );
}
