import { ChatPage } from "./LiveChatPage";

/** Top-level "Tin nhắn" view: the chat fills the area under the top bar, edge to edge. */
export function MessagesPage() {
  return (
    <div className="flex min-h-0 flex-1">
      <h1 className="sr-only">Tin nhắn</h1>
      <ChatPage />
    </div>
  );
}
