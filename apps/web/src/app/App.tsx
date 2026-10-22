import { lazy, Suspense, useEffect } from "react";
import { useApp } from "./providers/AppContext";
import { AnimatePresence, motion } from "motion/react";
import { DURATION, EASE_OUT } from "../shared/motion/tokens";
import { useMotionSafe, motionDebugEnabled } from "../shared/motion/MotionProvider";
import { ToastViewport } from "../shared/ui/Primitives";
import { MeetingInviteListener } from "../features/meetings/MeetingInviteListener";
import { GlobalCallBar } from "../features/call-center/GlobalCallBar";

const LandingPage = lazy(() =>
  import("../features/landing/LandingPage").then((m) => ({ default: m.LandingPage })),
);
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
  const { screen, isAuthChecking } = useApp();
  // An /app/ link reloads into the landing screen until the session is restored; show a skeleton instead.
  const restoring = isAuthChecking && screen === "landing" && window.location.pathname.startsWith("/app/");
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
            key={screen}
            className={`screen-transition screen-transition--${screen}`}
            initial={safe.reduced ? false : { opacity: 0, y: screen === "login" ? 12 : 0 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{
              opacity: safe.reduced ? 1 : 0,
              transition: { duration: safe.duration(DURATION.exit), ease: EASE_OUT },
            }}
            transition={{
              duration: safe.duration(screen === "login" ? 0.32 : DURATION.enter),
              ease: EASE_OUT,
            }}
          >
            <Suspense fallback={<ScreenFallback />}>
              {screen === "landing" && (restoring ? <ScreenFallback /> : <LandingPage />)}
              {screen === "login" && <LoginPage />}
              {screen === "app" && <AppShell />}
            </Suspense>
          </motion.div>
        </AnimatePresence>
      </div>
      <ToastViewport />
      {screen === "app" && <MeetingInviteListener />}
      {screen === "app" && <GlobalCallBar />}
      {MotionDebug && <Suspense fallback={null}><MotionDebug /></Suspense>}
    </>
  );
}
