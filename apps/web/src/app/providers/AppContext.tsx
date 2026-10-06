import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AuthResponse, AuthUser, GoogleAuthInput, RegisterResponse } from "@doan/shared";
import {
  googleAuthApi,
  loginApi,
  logoutApi,
  refreshSessionApi,
  registerApi,
  resendOtpApi,
  verifyOtpApi,
} from "../../features/auth/api";
import type { AuthMode, PublicScreen, ToastMessage, ViewId } from "../types";
import {
  appEntryRoute,
  appRouteUrl,
  isWorkspaceTabView,
  readAppRoute,
  selectWorkspaceRoute,
  type AppRoute,
  type WorkspaceTabId,
} from "../navigation";
import { clearAccountDrafts } from "../../shared/lib/drafts";
import { readSessionHint, shouldTryRestore, writeSessionHint } from "../session-hint";

// One restore request per page load, shared by StrictMode's double-mounted effect.
let restoreRequest: ReturnType<typeof refreshSessionApi> | null = null;
const restoreSessionOnce = () => (restoreRequest ??= refreshSessionApi());

interface AppContextValue {
  screen: PublicScreen;
  setScreen: (screen: PublicScreen) => void;
  activeView: ViewId;
  setActiveView: (view: ViewId) => void;
  route: AppRoute;
  navigate: (route: AppRoute, replace?: boolean) => void;
  openWorkspace: (workspaceId: string, tab?: WorkspaceTabId) => void;
  openChannel: (workspaceId: string, channelId?: string, meeting?: boolean) => void;
  chatNavigation: {
    workspaceId: string;
    channelId: string;
    messageId: string;
    query: string;
  } | null;
  openChatSearchResult: (target: {
    workspaceId: string;
    channelId: string;
    messageId: string;
    query: string;
  }) => void;
  clearChatNavigation: () => void;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (value: boolean) => void;
  mobileNavOpen: boolean;
  setMobileNavOpen: (value: boolean) => void;
  toasts: ToastMessage[];
  notify: (title: string, description?: string, tone?: ToastMessage["tone"], action?: ToastMessage["action"]) => void;
  dismissToast: (id: number) => void;
  user: AuthUser | null;
  accessToken: string | null;
  isAuthChecking: boolean;
  authMode: AuthMode;
  setAuthMode: (mode: AuthMode) => void;
  openAuth: (mode?: AuthMode) => void;
  enterWorkspace: () => void;
  login: (input: { email: string; password: string }) => Promise<void>;
  register: (input: {
    displayName: string;
    email: string;
    password: string;
  }) => Promise<RegisterResponse>;
  verifyOtp: (input: { email: string; otp: string }) => Promise<void>;
  resendOtp: (
    email: string,
  ) => Promise<{ success: boolean; message: string; cooldownSeconds: number }>;
  loginWithGoogle: (
    input: GoogleAuthInput,
  ) => Promise<{ requireOtp?: boolean; email?: string } | void>;
  logout: (reason?: "password-changed") => Promise<void>;
  updateUser: (user: Partial<AuthUser>) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [screen, setScreen] = useState<PublicScreen>(() => /^\/(login|register)\/?$/.test(window.location.pathname) ? "login" : "landing");
  const [route, setRoute] = useState(() => readAppRoute(new URL(window.location.href)));
  const activeView = route.view;
  const navigate = useCallback((target: AppRoute, replace = false) => {
    const url = appRouteUrl(target);
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== url)
      window.history[replace ? "replaceState" : "pushState"]({}, "", url);
    setRoute(target);
    setMobileNavOpen(false);
  }, []);
  const setActiveView = useCallback(
    (view: ViewId) => {
      const keepWorkspace =
        (isWorkspaceTabView(view) || view === "admin") && route.workspaceId
          ? route.workspaceId
          : undefined;
      navigate({ view, workspaceId: keepWorkspace });
    },
    [navigate, route.workspaceId],
  );
  // Re-read the route whenever auth lands in the app; the initial route may come from /login.
  const enterApp = useCallback(() => {
    setRoute(appEntryRoute(new URL(window.location.href)));
    setScreen("app");
    writeSessionHint(true);
  }, []);
  useEffect(() => {
    const onPop = () => {
      setRoute(readAppRoute(new URL(window.location.href)));
      const path = window.location.pathname;
      if (/^\/(login|register)\/?$/.test(path)) { setAuthMode(path.startsWith("/register") ? "register" : "login"); setScreen("login"); }
      else if (path === "/") setScreen("landing");
      else if(path.startsWith("/app/")) setScreen(user ? "app" : "login");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [user]);
  const [chatNavigation, setChatNavigation] = useState<AppContextValue["chatNavigation"]>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const toastId = useRef(0);
  const dismissToast = (id: number) => setToasts(items => items.filter(item => item.id !== id));

  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [authMode, setAuthMode] = useState<AuthMode>(() => window.location.pathname.startsWith("/register") ? "register" : "login");
  useEffect(() => {
    if (isAuthChecking) return;
    const path = window.location.pathname;
    // Retain an incoming protected deep link while authentication is required.
    if(screen === "login" && path.startsWith("/app/")) return;
    const destination = screen === "landing" ? "/" : screen === "login" ? `/${authMode}` : appRouteUrl(route);
    if (`${path}${window.location.search}${window.location.hash}` !== destination)
      window.history[screen === "app" ? "replaceState" : "pushState"]({},"",destination);
  },[screen,authMode,isAuthChecking,route]);

  useEffect(() => {
    // The editorial glass UI is light-only; a dark color-scheme turned native selects,
    // date pickers and scrollbars black on top of light surfaces.
    document.documentElement.dataset.theme = "light";
    document.documentElement.style.colorScheme = "light";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#e8eef6");
    localStorage.removeItem("collabspace-theme");
  }, []);

  useEffect(() => {
    let mounted = true;
    const checkSession = async () => {
      // Never signed in here and not opening an app link: a refresh could only 401.
      if (!shouldTryRestore(window.location.pathname, readSessionHint())) {
        if (mounted) setIsAuthChecking(false);
        return;
      }
      try {
        const result = await restoreSessionOnce();
        if (mounted) {
          setUser(result.user);
          setAccessToken(result.accessToken);
          enterApp();
        }
      } catch {
        // Chưa đăng nhập hoặc phiên đã hết hạn
        writeSessionHint(false);
        if (mounted && window.location.pathname.startsWith("/app/")) setScreen("login");
      } finally {
        if (mounted) {
          setIsAuthChecking(false);
        }
      }
    };
    checkSession();
    return () => {
      mounted = false;
    };
  }, [enterApp]);

  const notify = (title: string, description?: string, tone: ToastMessage["tone"] = "success", action?: ToastMessage["action"]) => {
    // Preserve the owner's previous request to hide login welcome banners.
    if (["Chào mừng trở lại", "Xác thực thành công", "Đăng nhập Google thành công"].includes(title)) return;
    const id = ++toastId.current;
    setToasts((items) => [...items, { id, title, description, tone, action }].slice(-3));
  };

  useEffect(() => {
    if (!accessToken) return;
    let active = true;
    const payload = JSON.parse(
      atob(accessToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
    );
    const timer = window.setTimeout(
      () => {
        refreshSessionApi()
          .then((result) => {
            if (active) {
              setAccessToken(result.accessToken);
              setUser(result.user);
            }
          })
          .catch(() => {
            writeSessionHint(false);
            if (active) {
              setAccessToken(null);
              setUser(null);
              setScreen("login");
            }
          });
      },
      Math.max(1000, payload.exp * 1000 - Date.now() - 60000),
    );
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [accessToken]);

  const openAuth = (mode: AuthMode = "login") => {
    setAuthMode(mode);
    setScreen("login");
  };

  const enterWorkspace = () => {
    if (user) {
      setScreen("app");
      setActiveView("overview");
    } else {
      openAuth("login");
    }
  };

  const handleLogin = async (input: { email: string; password: string }) => {
    const result = await loginApi(input);
    setUser(result.user);
    setAccessToken(result.accessToken);
    enterApp();
    // Preserve an incoming channel/meeting link through authentication.
    notify("Chào mừng trở lại", `Đăng nhập thành công với ${result.user.displayName}.`);
  };

  const handleRegister = async (input: {
    displayName: string;
    email: string;
    password: string;
  }) => {
    return await registerApi(input);
  };

  const handleVerifyOtp = async (input: { email: string; otp: string }) => {
    const result = await verifyOtpApi(input);
    setUser(result.user);
    setAccessToken(result.accessToken);
    enterApp();
    // Preserve the destination after OTP verification.
    notify("Xác thực thành công", `Chào mừng ${result.user.displayName} đến với nexo!`);
  };

  const handleResendOtp = async (email: string) => {
    const result = await resendOtpApi({ email });
    notify("Đã gửi lại mã", result.message, "info");
    return result;
  };

  const handleLoginWithGoogle = async (input: GoogleAuthInput) => {
    const result = await googleAuthApi(input);
    if ("requireOtp" in result && result.requireOtp) {
      return { requireOtp: true, email: result.email };
    }
    const authRes = result as AuthResponse;
    setUser(authRes.user);
    setAccessToken(authRes.accessToken);
    enterApp();
    // Preserve the destination after Google authentication.
    notify("Đăng nhập Google thành công", `Chào mừng ${authRes.user.displayName} đã trở lại!`);
  };

  const handleLogout = async (reason?: "password-changed") => {
    try {
      await logoutApi();
    } catch {
      // Bỏ qua lỗi mạng khi logout
    } finally {
      writeSessionHint(false);
      if (user) await clearAccountDrafts(user.id);
      setUser(null);
      setAccessToken(null);
      setChatNavigation(null);
      setScreen("landing");
      setActiveView("overview");
      if(reason === "password-changed") notify("Đã đổi mật khẩu", "Vui lòng đăng nhập lại.", "info");
      else notify("Đã đăng xuất", "Hẹn gặp lại bạn tại nexo.", "info");
    }
  };

  const updateUser = async (updated: Partial<AuthUser>) => {
    const response = await fetch(`${import.meta.env.VITE_API_URL ?? ""}/auth/profile`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...user, ...updated }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message ?? "Không thể cập nhật tài khoản.");
    setUser(result.user);
  };

  const value = useMemo<AppContextValue>(
    () => ({
      screen,
      setScreen,
      activeView,
      route,
      navigate,
      openWorkspace: (workspaceId, tab = "workspace") =>
        navigate(selectWorkspaceRoute(workspaceId, tab)),
      openChannel: (workspaceId, channelId, meeting = false) =>
        navigate({ view: meeting ? "meetings" : "chat", workspaceId, channelId }),
      chatNavigation,
      openChatSearchResult: (target) => {
        setChatNavigation(target);
        navigate({ view: "chat", ...target });
        setMobileNavOpen(false);
      },
      clearChatNavigation: () => setChatNavigation(null),
      setActiveView: (view) => {
        setActiveView(view);
        setMobileNavOpen(false);
      },
      sidebarCollapsed,
      setSidebarCollapsed,
      mobileNavOpen,
      setMobileNavOpen,
      toasts,
      notify,
      dismissToast,
      user,
      accessToken,
      isAuthChecking,
      authMode,
      setAuthMode,
      openAuth,
      enterWorkspace,
      login: handleLogin,
      register: handleRegister,
      verifyOtp: handleVerifyOtp,
      resendOtp: handleResendOtp,
      loginWithGoogle: handleLoginWithGoogle,
      logout: handleLogout,
      updateUser,
    }),
    [
      activeView,
      route,
      navigate,
      chatNavigation,
      authMode,
      isAuthChecking,
      mobileNavOpen,
      screen,
      sidebarCollapsed,
      toasts,
      user,
      accessToken,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error("useApp must be used within AppProvider");
  return context;
}
