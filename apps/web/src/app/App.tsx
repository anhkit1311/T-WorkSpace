import { lazy, Suspense, useEffect } from "react";
import { useApp } from "./providers/AppContext";
import { AnimatePresence, motion } from "motion/react";
import "./styles/screen-motion.css";

const LandingPage = lazy(() =>
  import("../features/landing/LandingPage").then((m) => ({ default: m.LandingPage })),
);
const LoginPage = lazy(() => import("../features/auth/LoginPage").then((m) => ({ default: m.LoginPage })));
const AppShell = lazy(() =>
  import("./layout/AppShell").then((m) => ({ default: m.AppShell })),
);

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
        {/* Keep the landscape alive across public screens; Motion owns only the foreground. */}
        {screen !== "app" && (
          <div className="public-screen-backdrop" aria-hidden="true">
            <video
              src="https://designerstephen.github.io/public-assets/videos/serene-art-hero.mp4"
              autoPlay
              loop
              muted
              playsInline
              preload="auto"
            />
          </div>
        )}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={screen}
            className={`screen-transition screen-transition--${screen}`}
            initial={{ opacity: 0, y: screen === "login" ? 12 : 0 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{
              opacity: 0,
              transition: { duration: 0.12, ease: "easeOut" },
            }}
            transition={{
              duration: screen === "login" ? 0.32 : 0.18,
              ease: [0.16, 1, 0.3, 1],
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
