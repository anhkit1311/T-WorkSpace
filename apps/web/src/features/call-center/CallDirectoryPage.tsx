import { CallCenterWorkspace } from "./CallCenterWorkspace";

/** "Danh sách cuộc gọi": the real call history (cc_calls, recordings, QA) of the switchboard. */
export function CallDirectoryPage() {
  return <CallCenterWorkspace initialTab="history" />;
}
