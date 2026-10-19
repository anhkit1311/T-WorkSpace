import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MotionProvider, motionDebugEnabled } from "./shared/motion/MotionProvider";
import { ControlFeedback } from "./shared/motion/ControlFeedback";
import { App } from "./app/App";
import { VerifyCertificatePage } from "./features/elearning/Certificate";
import { AppProvider } from "./app/providers/AppContext";
import { SocketProvider } from "./app/providers/SocketContext";
import { MeetingProvider } from "./app/providers/MeetingContext";
import { SoftphoneProvider } from "./app/providers/SoftphoneContext";
import "./app/styles/styles.css";
import "./shared/motion/motion.css";

// Consume only the DEV diagnostic flag before the product router reads the URL.
// Every product query parameter and the current route/hash remain intact.
if (motionDebugEnabled) {
  const url = new URL(window.location.href);
  url.searchParams.delete("motion-debug");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

// EL-8: the QR code on a certificate opens this public page; it needs no session or app shell.
const verifyCode = window.location.pathname.match(/^\/verify\/([A-Za-z0-9-]{1,32})\/?$/)?.[1];

createRoot(document.getElementById("root")!).render(
  verifyCode ? (
    <StrictMode>
      <VerifyCertificatePage code={verifyCode} />
    </StrictMode>
  ) : (
    <StrictMode>
      <MotionProvider>
        <ControlFeedback />
        <AppProvider>
          <SocketProvider>
            <MeetingProvider>
              <SoftphoneProvider>
                <App />
              </SoftphoneProvider>
            </MeetingProvider>
          </SocketProvider>
        </AppProvider>
      </MotionProvider>
    </StrictMode>
  ),
);
