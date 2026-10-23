import { lazy, Suspense, useEffect } from "react";
import { useApp } from "./providers/AppContext";
import { AnimatePresence, motion } from "motion/react";
import { DURATION, EASE_OUT } from "../shared/motion/tokens";
import { useMotionSafe, motionDebugEnabled } from "../shared/motion/MotionProvider";
import { ToastViewport } from "../shared/ui/Primitives";
import { MeetingInviteListener } from "../features/meetings/MeetingInviteListener";

const LoginPage = lazy(() =>
  import("../features/auth/LoginPage").then((m) => ({ default: m.LoginPage })),
);
const AppShell = lazy(() => import("./layout/AppShell").then((m) => ({ default: m.AppShell })));
// DEV diagnostics are entirely absent from the production dependency graph.
const MotionDebug = motionDebugEnabled
  ? lazy(() => import("../shared/motion/MotionDebug")) : null;

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
  const safe = useMotionSafe();
  const { screen } = useApp();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [screen]);
  return (
    <>
      <a className="skip-link" href="#main-content">
        Đi đến nội dung chính
      </a>
      <div className={`screen-stage ${screen !== "app" ? "screen-stage--public" : ""}`}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={screen === "app" ? "app" : "login"}
            className={`screen-transition screen-transition--${screen === "app" ? "app" : "login"}`}
            initial={safe.reduced ? false : { opacity: 0, y: screen === "app" ? 0 : 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{
              opacity: safe.reduced ? 1 : 0,
              transition: { duration: safe.duration(DURATION.exit), ease: EASE_OUT },
            }}
            transition={{
              duration: safe.duration(screen === "app" ? DURATION.enter : 0.25),
              ease: EASE_OUT,
            }}
          >
            <Suspense fallback={<ScreenFallback />}>
              {screen === "app" ? <AppShell /> : <LoginPage />}
            </Suspense>
          </motion.div>
        </AnimatePresence>
      </div>
      <ToastViewport />
      {screen === "app" && <MeetingInviteListener />}
      {MotionDebug && <Suspense fallback={null}><MotionDebug /></Suspense>}
    </>
  );
}
