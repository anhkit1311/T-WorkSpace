import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
import { appRouteUrl, readAppRoute, type AppRoute } from "../navigation";
import { clearAccountDrafts } from "../../shared/lib/drafts";

interface AppContextValue {
  screen: PublicScreen;
  setScreen: (screen: PublicScreen) => void;
  activeView: ViewId;
  setActiveView: (view: ViewId) => void;
  route: AppRoute;
  navigate: (route: AppRoute, replace?: boolean) => void;
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
  notify: (title: string, description?: string, tone?: ToastMessage["tone"]) => void;
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
  logout: () => Promise<void>;
  updateUser: (user: Partial<AuthUser>) => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [screen, setScreen] = useState<PublicScreen>("landing");
  const [route, setRoute] = useState(() => readAppRoute(new URL(window.location.href)));
  const activeView = route.view;
  const navigate = useCallback((target: AppRoute, replace = false) => {
    const url = appRouteUrl(target);
    if (`${window.location.pathname}${window.location.search}${window.location.hash}` !== url)
      window.history[replace ? "replaceState" : "pushState"]({}, "", url);
    setRoute(target);
    setMobileNavOpen(false);
  }, []);
  const setActiveView = (view: ViewId) => navigate({ view });
  useEffect(() => {
    const onPop = () => setRoute(readAppRoute(new URL(window.location.href)));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const [chatNavigation, setChatNavigation] = useState<AppContextValue["chatNavigation"]>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [authMode, setAuthMode] = useState<AuthMode>("login");

  useEffect(() => {
    document.documentElement.dataset.theme = "dark";
    document.documentElement.style.colorScheme = "dark";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#0a0a0a");
    localStorage.removeItem("collabspace-theme");
  }, []);

  useEffect(() => {
    let mounted = true;
    const checkSession = async () => {
      try {
        const result = await refreshSessionApi();
        if (mounted) {
          setUser(result.user);
          setAccessToken(result.accessToken);
          setScreen("app");
        }
      } catch {
        // Chưa đăng nhập hoặc phiên đã hết hạn
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
  }, []);

  const notify = (title: string, description?: string, tone: ToastMessage["tone"] = "success") => {
    const id = Date.now();
    setToasts((items) => [...items, { id, title, description, tone }]);
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 3600);
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
    setScreen("app");
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
    setScreen("app");
    // Preserve the destination after OTP verification.
    notify("Xác thực thành công", `Chào mừng ${result.user.displayName} đến với CollabSpace!`);
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
    setScreen("app");
    // Preserve the destination after Google authentication.
    notify("Đăng nhập Google thành công", `Chào mừng ${authRes.user.displayName} đã trở lại!`);
  };

  const handleLogout = async () => {
    try {
      await logoutApi();
    } catch {
      // Bỏ qua lỗi mạng khi logout
    } finally {
      if (user) await clearAccountDrafts(user.id);
      setUser(null);
      setAccessToken(null);
      setChatNavigation(null);
      setScreen("landing");
      setActiveView("overview");
      notify("Đã đăng xuất", "Hẹn gặp lại bạn tại CollabSpace.", "info");
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
