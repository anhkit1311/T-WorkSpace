import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import { App } from "./app/App";
import { AppProvider } from "./app/providers/AppContext";
import { SocketProvider } from "./app/providers/SocketContext";
import { MeetingProvider } from "./app/providers/MeetingContext";
import "./app/styles/styles.css";
import "./app/styles/editorial-workspace.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <AppProvider>
        <SocketProvider>
          <MeetingProvider>
            <App />
          </MeetingProvider>
        </SocketProvider>
      </AppProvider>
    </MotionConfig>
  </StrictMode>,
);
