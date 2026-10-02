import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  RotateCw,
  ShieldCheck,
  User,
} from "lucide-react";
import { ApiError, requestPasswordResetApi, resetPasswordApi } from "./api";
import { useApp } from "../../app/providers/AppContext";
import "./editorial-auth.css";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
          }) => void;
          prompt: (
            momentListener?: (notification: {
              isNotDisplayed: () => boolean;
              isSkippedMoment: () => boolean;
            }) => void,
          ) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
          disableAutoSelect: () => void;
        };
      };
    };
  }
}

let googleSdkPromise: Promise<void> | null = null;

function loadGoogleSdk(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();
  googleSdkPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.id = "google-identity-services";
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      googleSdkPromise = null;
      script.remove();
      reject(new Error("Không tải được dịch vụ đăng nhập Google."));
    };
    document.head.appendChild(script);
  });
  return googleSdkPromise;
}

function GoogleSignInButton({
  onCredential,
  disabled,
}: {
  onCredential: (credential: string) => void;
  disabled: boolean;
}) {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID?.trim();
  const buttonRef = useRef<HTMLDivElement>(null);
  const callbackRef = useRef(onCredential);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    callbackRef.current = onCredential;
  }, [onCredential]);

  useEffect(() => {
    if (!clientId) return;
    let active = true;
    setStatus("loading");
    loadGoogleSdk()
      .then(() => {
        if (!active || !buttonRef.current || !window.google?.accounts?.id) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: ({ credential }) => {
            if (credential) callbackRef.current(credential);
          },
          auto_select: false,
          cancel_on_tap_outside: true,
        });
        buttonRef.current.replaceChildren();
        window.google.accounts.id.renderButton(buttonRef.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          text: "continue_with",
          shape: "pill",
          logo_alignment: "left",
          width: Math.min(360, Math.max(240, buttonRef.current.clientWidth || 300)),
          locale: "vi",
        });
        setStatus("ready");
      })
      .catch(() => {
        if (active) setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [clientId, retry]);

  if (!clientId) {
    return null;
  }

  return (
    <div
      style={{ display: "flex", justifyContent: "center", width: "100%" }}
      className={disabled ? "opacity-50 pointer-events-none" : ""}
      aria-busy={status === "loading"}
      aria-disabled={disabled}
    >
      <div ref={buttonRef} />
      {status === "loading" && (
        <p
          style={{
            color: "hsl(215, 25%, 45%)",
            fontSize: "12px",
            textAlign: "center",
            padding: "8px 0",
          }}
        >
          Đang nạp Google Sign-In…
        </p>
      )}
      {status === "error" && (
        <button
          type="button"
          style={{
            color: "#0f172a",
            fontSize: "12px",
            textDecoration: "underline",
            padding: "8px 0",
            background: "none",
            border: "none",
            cursor: "pointer",
          }}
          onClick={() => setRetry((value) => value + 1)}
        >
          Không tải được Google. Thử lại
        </button>
      )}
    </div>
  );
}

export function LoginPage() {
  const {
    setScreen,
    notify,
    login,
    register,
    verifyOtp,
    resendOtp,
    loginWithGoogle,
    authMode,
    setAuthMode,
  } = useApp();

  const [authStep, setAuthStep] = useState<"form" | "otp" | "reset-request" | "reset-confirm">(
    "form",
  );
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // OTP state
  const [otpCode, setOtpCode] = useState("");
  const [otpEmail, setOtpEmail] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [resending, setResending] = useState(false);

  // Password reset state
  const [resetEmail, setResetEmail] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [resetPasswordValue, setResetPasswordValue] = useState("");
  const [resetNotice, setResetNotice] = useState("");

  const [errors, setErrors] = useState<{
    displayName?: string;
    email?: string;
    password?: string;
    otp?: string;
    general?: string;
  }>({});
  const [loading, setLoading] = useState(false);

  const isLogin = authMode === "login";

  // Cooldown countdown
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => {
      setCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const handleGoogleCredential = useCallback(
    async (credential: string) => {
      if (loading) return;
      setLoading(true);
      setErrors({});
      try {
        const result = await loginWithGoogle({ credential });
        if (result?.requireOtp) {
          setOtpEmail(result.email ?? "");
          setAuthStep("otp");
          setCooldown(60);
          setOtpCode("");
          notify("Xác thực OTP", "Kiểm tra email để tiếp tục đăng nhập.", "info");
        }
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : "Không thể đăng nhập bằng Google. Vui lòng thử lại.";
        setErrors({ general: message });
      } finally {
        setLoading(false);
      }
    },
    [loading, loginWithGoogle, notify],
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: typeof errors = {};

    if (!isLogin && (!displayName.trim() || displayName.trim().length < 2)) {
      next.displayName = "Tên hiển thị cần từ 2 đến 80 ký tự.";
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      next.email = "Vui lòng nhập email hợp lệ.";
    }
    if (password.length < 8) {
      next.password = "Mật khẩu cần có ít nhất 8 ký tự.";
    }

    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setLoading(true);
    try {
      if (isLogin) {
        await login({ email, password });
      } else {
        const res = await register({
          displayName: displayName.trim(),
          email: email.trim(),
          password,
        });
        if (res.requireOtp) {
          setOtpEmail(res.email);
          setAuthStep("otp");
          setCooldown(60);
          setOtpCode("");
          notify("Mã xác thực đã gửi", "Vui lòng kiểm tra email để lấy mã OTP 6 chữ số.", "info");
        }
      }
    } catch (err: unknown) {
      if (err instanceof ApiError && err.code === "EMAIL_NOT_VERIFIED") {
        setOtpEmail(email.trim());
        setAuthStep("otp");
        setCooldown(60);
        setOtpCode("");
        setErrors({
          general:
            "Tài khoản này chưa được kích hoạt. Vui lòng nhập mã OTP để tiếp tục hoàn tất đăng nhập.",
        });
        return;
      }
      const message = err instanceof Error ? err.message : "Đã xảy ra lỗi không xác định.";
      setErrors({ general: message });
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtpSubmit = async (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (otpCode.length !== 6) {
      setErrors({ otp: "Mã OTP phải có đúng 6 chữ số." });
      return;
    }
    setLoading(true);
    setErrors({});
    try {
      await verifyOtp({ email: otpEmail, otp: otpCode });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Mã xác thực không đúng hoặc đã hết hạn.";
      setErrors({ otp: message, general: message });
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtpCode = async () => {
    if (cooldown > 0 || resending || !otpEmail) return;
    setResending(true);
    try {
      const res = await resendOtp(otpEmail);
      setCooldown(res.cooldownSeconds || 60);
      setErrors({});
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Không thể gửi lại mã OTP. Vui lòng thử lại sau.";
      setErrors({ general: message });
    } finally {
      setLoading(false);
    }
  };

  const handleResetRequest = async (event: FormEvent) => {
    event.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(resetEmail.trim())) {
      setErrors({ email: "Vui lòng nhập email hợp lệ." });
      return;
    }
    setLoading(true);
    setErrors({});
    try {
      const result = await requestPasswordResetApi(resetEmail.trim());
      setResetNotice(result.message);
      setResetCode("");
      setAuthStep("reset-confirm");
    } catch (error) {
      setErrors({
        general: error instanceof Error ? error.message : "Không thể gửi mã. Vui lòng thử lại.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleResetConfirm = async (event: FormEvent) => {
    event.preventDefault();
    const next: typeof errors = {};
    if (!/^\d{6}$/.test(resetCode)) next.otp = "Mã xác thực phải gồm 6 chữ số.";
    if (resetPasswordValue.length < 8 || resetPasswordValue.length > 128)
      next.password = "Mật khẩu phải có từ 8 đến 128 ký tự.";
    setErrors(next);
    if (Object.keys(next).length) return;
    setLoading(true);
    try {
      const result = await resetPasswordApi({
        email: resetEmail.trim(),
        otp: resetCode,
        password: resetPasswordValue,
      });
      setPassword("");
      setResetPasswordValue("");
      setResetCode("");
      setEmail(resetEmail.trim());
      setAuthMode("login");
      setAuthStep("form");
      setErrors({});
      notify("Đã đổi mật khẩu", result.message, "info");
    } catch (error) {
      setErrors({
        general: error instanceof Error ? error.message : "Không thể đặt lại mật khẩu.",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <main id="main-content" className="editorial-auth-shell">
      {/* Top Bar with Brand & Back */}
      <header className="editorial-auth-nav">
        <button type="button" onClick={() => setScreen("landing")} className="editorial-auth-brand">
          CollabSpace<sup>®</sup>
        </button>

        <button
          type="button"
          onClick={() => setScreen("landing")}
          className="editorial-auth-back-btn"
          aria-label="Quay lại"
        >
          <ArrowLeft style={{ width: 14, height: 14 }} />
          <span>Về trang chủ</span>
        </button>
      </header>

      {/* Central Editorial Card */}
      <div className="editorial-auth-card">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={authStep === "form" ? authMode : authStep}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8, transition: { duration: 0.15 } }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            {/* Step: Password Reset */}
            {authStep === "reset-request" || authStep === "reset-confirm" ? (
              <div>
                <button
                  type="button"
                  className="editorial-sublink"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    marginBottom: "16px",
                  }}
                  onClick={() => {
                    setAuthStep("form");
                    setErrors({});
                  }}
                >
                  <ArrowLeft style={{ width: 14, height: 14 }} />
                  <span>Quay lại đăng nhập</span>
                </button>

                <h1 className="editorial-auth-title">
                  {authStep === "reset-request" ? "Khôi phục truy cập" : "Thiết lập mật khẩu mới"}
                </h1>

                <p className="editorial-auth-desc">
                  {authStep === "reset-request"
                    ? "Nhập email tài khoản để nhận mã OTP khôi phục mật khẩu."
                    : resetNotice || "Nhập mã 6 chữ số và mật khẩu mới của bạn."}
                </p>

                {errors.general && (
                  <div className="editorial-error-banner" role="alert">
                    {errors.general}
                  </div>
                )}

                {authStep === "reset-request" ? (
                  <form onSubmit={handleResetRequest} noValidate>
                    <div className="editorial-field">
                      <label className="editorial-field-label">Email tài khoản</label>
                      <div className="editorial-input-wrap">
                        <Mail className="editorial-input-icon" style={{ width: 16, height: 16 }} />
                        <input
                          type="email"
                          autoComplete="email"
                          value={resetEmail}
                          onChange={(e) => setResetEmail(e.target.value)}
                          placeholder="tenban@congty.com"
                          className="editorial-input"
                          autoFocus
                        />
                      </div>
                      {errors.email && <div className="editorial-field-error">{errors.email}</div>}
                    </div>

                    <button type="submit" disabled={loading} className="editorial-submit-btn">
                      {loading ? "Đang gửi mã..." : "Gửi mã đặt lại mật khẩu"}
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleResetConfirm} noValidate>
                    <div className="editorial-field">
                      <label className="editorial-field-label">Mã xác thực 6 chữ số</label>
                      <div className="editorial-input-wrap">
                        <KeyRound
                          className="editorial-input-icon"
                          style={{ width: 16, height: 16 }}
                        />
                        <input
                          type="text"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          maxLength={6}
                          value={resetCode}
                          onChange={(e) =>
                            setResetCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                          }
                          placeholder="••••••"
                          className="editorial-input"
                          style={{
                            textAlign: "center",
                            letterSpacing: "6px",
                            fontFamily: "monospace",
                          }}
                          autoFocus
                        />
                      </div>
                      {errors.otp && <div className="editorial-field-error">{errors.otp}</div>}
                    </div>

                    <div className="editorial-field">
                      <label className="editorial-field-label">Mật khẩu mới (8–128 ký tự)</label>
                      <div className="editorial-input-wrap">
                        <Lock className="editorial-input-icon" style={{ width: 16, height: 16 }} />
                        <input
                          type="password"
                          autoComplete="new-password"
                          value={resetPasswordValue}
                          onChange={(e) => setResetPasswordValue(e.target.value)}
                          placeholder="Nhập mật khẩu mới..."
                          className="editorial-input"
                        />
                      </div>
                      {errors.password && (
                        <div className="editorial-field-error">{errors.password}</div>
                      )}
                    </div>

                    <button type="submit" disabled={loading} className="editorial-submit-btn">
                      {loading ? "Đang cập nhật..." : "Cập nhật mật khẩu"}
                    </button>

                    <div style={{ textAlign: "center", marginTop: "16px" }}>
                      <button
                        type="button"
                        className="editorial-sublink"
                        onClick={() => {
                          setAuthStep("reset-request");
                          setErrors({});
                        }}
                      >
                        Yêu cầu gửi mã mới
                      </button>
                    </div>
                  </form>
                )}
              </div>
            ) : authStep === "otp" ? (
              /* Step: OTP Verification */
              <div>
                <button
                  type="button"
                  className="editorial-sublink"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    marginBottom: "16px",
                  }}
                  onClick={() => {
                    setAuthStep("form");
                    setErrors({});
                  }}
                >
                  <ArrowLeft style={{ width: 14, height: 14 }} />
                  <span>Quay lại</span>
                </button>

                <h1 className="editorial-auth-title">
                  Xác thực <em>danh tính</em>
                </h1>

                <p className="editorial-auth-desc">
                  Mã xác thực 6 chữ số đã được gửi tới địa chỉ email:
                </p>

                <div className="editorial-otp-target-pill">
                  <Mail style={{ width: 16, height: 16 }} />
                  <span>{otpEmail}</span>
                </div>

                {errors.general && (
                  <div className="editorial-error-banner" role="alert">
                    {errors.general}
                  </div>
                )}

                <form onSubmit={handleVerifyOtpSubmit} noValidate>
                  <div className="editorial-field">
                    <label className="editorial-field-label" style={{ textAlign: "center" }}>
                      Nhập mã OTP 6 chữ số
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      value={otpCode}
                      onChange={(e) => {
                        const val = e.target.value.replace(/\D/g, "").slice(0, 6);
                        setOtpCode(val);
                        if (errors.otp)
                          setErrors((prev) => ({
                            ...prev,
                            otp: undefined,
                            general: undefined,
                          }));
                      }}
                      placeholder="••••••"
                      autoFocus
                      className="editorial-otp-input"
                    />
                    {errors.otp && (
                      <div className="editorial-field-error" style={{ textAlign: "center" }}>
                        {errors.otp}
                      </div>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={otpCode.length !== 6 || loading}
                    className="editorial-submit-btn"
                  >
                    {loading ? (
                      "Đang xác thực..."
                    ) : (
                      <>
                        <span>Xác nhận & Vào không gian</span>
                        <Check style={{ width: 16, height: 16 }} />
                      </>
                    )}
                  </button>
                </form>

                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginTop: "20px",
                    paddingTop: "16px",
                    borderTop: "1px solid rgba(15, 23, 42, 0.08)",
                  }}
                >
                  <button
                    type="button"
                    className="editorial-sublink"
                    onClick={() => {
                      setAuthStep("form");
                      setErrors({});
                    }}
                  >
                    Đổi email khác
                  </button>

                  <button
                    type="button"
                    disabled={cooldown > 0 || resending}
                    onClick={handleResendOtpCode}
                    className="editorial-sublink"
                    style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
                  >
                    <RotateCw
                      style={{
                        width: 12,
                        height: 12,
                        animation: resending ? "spin 1s linear infinite" : undefined,
                      }}
                    />
                    <span>
                      {resending
                        ? "Đang gửi..."
                        : cooldown > 0
                          ? `Gửi lại (${cooldown}s)`
                          : "Gửi lại OTP"}
                    </span>
                  </button>
                </div>
              </div>
            ) : (
              /* Step: Main Form (Login / Register) */
              <div>
                {/* Mode Switcher Tabs */}
                <div className="editorial-tab-switcher">
                  <button
                    type="button"
                    className={`editorial-tab-btn ${isLogin ? "is-active" : ""}`}
                    onClick={() => {
                      setAuthMode("login");
                      setErrors({});
                    }}
                  >
                    Đăng nhập
                  </button>
                  <button
                    type="button"
                    className={`editorial-tab-btn ${!isLogin ? "is-active" : ""}`}
                    onClick={() => {
                      setAuthMode("register");
                      setErrors({});
                    }}
                  >
                    Tạo tài khoản
                  </button>
                </div>

                <h1 className="editorial-auth-title">
                  {isLogin ? "Bước vào không gian" : "Khởi tạo tài khoản"}
                </h1>

                <p className="editorial-auth-desc">
                  {isLogin
                    ? "Đăng nhập để vào không gian cộng tác thời gian thực của nhóm."
                    : "Đăng ký tài khoản để tạo và tham gia các không gian làm việc số."}
                </p>

                {errors.general && (
                  <div className="editorial-error-banner" role="alert">
                    {errors.general}
                  </div>
                )}

                {/* Google Sign In Button */}
                <div style={{ marginBottom: "16px" }}>
                  <GoogleSignInButton onCredential={handleGoogleCredential} disabled={loading} />
                </div>

                <div className="editorial-auth-divider">
                  <span>hoặc tiếp tục với email</span>
                </div>

                <form onSubmit={submit} noValidate>
                  {!isLogin && (
                    <div className="editorial-field">
                      <label className="editorial-field-label">Họ và tên hiển thị</label>
                      <div className="editorial-input-wrap">
                        <User className="editorial-input-icon" style={{ width: 16, height: 16 }} />
                        <input
                          type="text"
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          placeholder="Ví dụ: Nguyễn Văn A"
                          className="editorial-input"
                          autoFocus
                        />
                      </div>
                      {errors.displayName && (
                        <div className="editorial-field-error">{errors.displayName}</div>
                      )}
                    </div>
                  )}

                  <div className="editorial-field">
                    <label className="editorial-field-label">Email tài khoản</label>
                    <div className="editorial-input-wrap">
                      <Mail className="editorial-input-icon" style={{ width: 16, height: 16 }} />
                      <input
                        type="email"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="tenban@congty.com"
                        className="editorial-input"
                      />
                    </div>
                    {errors.email && <div className="editorial-field-error">{errors.email}</div>}
                  </div>

                  <div className="editorial-field">
                    <label className="editorial-field-label">Mật khẩu</label>
                    <div className="editorial-input-wrap">
                      <Lock className="editorial-input-icon" style={{ width: 16, height: 16 }} />
                      <input
                        type={showPassword ? "text" : "password"}
                        autoComplete={isLogin ? "current-password" : "new-password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Tối thiểu 8 ký tự"
                        className="editorial-input"
                      />
                      <button
                        type="button"
                        aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                        onClick={() => setShowPassword(!showPassword)}
                        className="editorial-toggle-btn"
                      >
                        {showPassword ? (
                          <EyeOff style={{ width: 16, height: 16 }} />
                        ) : (
                          <Eye style={{ width: 16, height: 16 }} />
                        )}
                      </button>
                    </div>
                    {errors.password && (
                      <div className="editorial-field-error">{errors.password}</div>
                    )}
                  </div>

                  {isLogin && (
                    <div className="editorial-auth-forgot">
                      <button
                        type="button"
                        className="editorial-sublink"
                        onClick={() => {
                          setResetEmail(email.trim());
                          setAuthStep("reset-request");
                          setErrors({});
                        }}
                      >
                        Quên mật khẩu?
                      </button>
                    </div>
                  )}

                  <button type="submit" disabled={loading} className="editorial-submit-btn">
                    {loading ? "Đang xử lý..." : isLogin ? "Đăng nhập" : "Tiếp tục tạo tài khoản"}
                  </button>
                </form>

                <div
                  style={{
                    marginTop: "24px",
                    paddingTop: "16px",
                    borderTop: "1px solid rgba(15, 23, 42, 0.08)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "6px",
                    fontSize: "12px",
                    color: "hsl(215, 25%, 45%)",
                  }}
                >
                  <ShieldCheck style={{ width: 14, height: 14 }} />
                  <span>Bảo mật phiên đăng nhập qua JWT & HttpOnly Session Cookie</span>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </main>
  );
}
