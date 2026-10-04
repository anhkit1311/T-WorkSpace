import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionProvider } from "./shared/motion/MotionProvider";
import { ControlFeedback } from "./shared/motion/ControlFeedback";
import { App } from "./app/App";
import { AppProvider } from "./app/providers/AppContext";
import { SocketProvider } from "./app/providers/SocketContext";
import { MeetingProvider } from "./app/providers/MeetingContext";
import "./app/styles/styles.css";
import "./app/styles/editorial-workspace.css";
import "./app/styles/unified-surfaces.css";
import "./shared/motion/motion.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionProvider>
      <ControlFeedback />
      <AppProvider>
        <SocketProvider>
          <MeetingProvider>
            <App />
          </MeetingProvider>
        </SocketProvider>
      </AppProvider>
    </MotionProvider>
  </StrictMode>,
);
