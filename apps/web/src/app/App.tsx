import { lazy, Suspense, useEffect } from "react";
import { useApp } from "./providers/AppContext";
import { useMeeting } from "./providers/MeetingContext";
import { AnimatePresence, motion } from "motion/react";
import { AmbientBackdrop } from "../shared/motion/AmbientBackdrop";
import type { AmbientMood } from "../shared/motion/ambient-scene";
import { DURATION, EASE_OUT } from "../shared/motion/tokens";
import "./styles/screen-motion.css";

const LandingPage = lazy(() =>
  import("../features/landing/LandingPage").then((m) => ({ default: m.LandingPage })),
);
const LoginPage = lazy(() =>
  import("../features/auth/LoginPage").then((m) => ({ default: m.LoginPage })),
);
const AppShell = lazy(() => import("./layout/AppShell").then((m) => ({ default: m.AppShell })));

function ScreenFallback() {
  return (
    <div className="page-suspense-fallback" role="status" aria-label="Đang tải giao diện...">
      <div className="page-suspense-line is-title" />
      <div className="page-suspense-line is-body" />
      <div className="page-suspense-card" />
    </div>
  );
}

export function App() {
  const { screen, activeView } = useApp();
  const { inCall } = useMeeting();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [screen]);
  const mood: AmbientMood = screen === "app" ? activeView : screen;
  return (
    <>
      <a className="skip-link" href="#main-content">
        Đi đến nội dung chính
      </a>
      {/* One persistent backdrop (video + three.js atmosphere); Motion owns only the foreground. */}
      <AmbientBackdrop
        mood={mood}
        tone={screen === "app" ? "workspace" : "public"}
        active={!(screen === "app" && inCall)}
      />
      <div className={`screen-stage ${screen !== "app" ? "screen-stage--public" : ""}`}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={screen}
            className={`screen-transition screen-transition--${screen}`}
            initial={{ opacity: 0, y: screen === "login" ? 12 : 0 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{
              opacity: 0,
              transition: { duration: DURATION.exit, ease: "easeOut" },
            }}
            transition={{
              duration: screen === "login" ? 0.32 : DURATION.enter,
              ease: EASE_OUT,
            }}
          >
            <Suspense fallback={<ScreenFallback />}>
              {screen === "landing" && <LandingPage />}
              {screen === "login" && <LoginPage />}
              {screen === "app" && <AppShell />}
            </Suspense>
          </motion.div>
        </AnimatePresence>
      </div>
    </>
  );
}
