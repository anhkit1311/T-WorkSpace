import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ApiError, requestPasswordResetApi, resetPasswordApi } from "./api";
import { Brand, Button, Field, IconButton } from "../../shared/ui/Primitives";
import { Icon } from "../../shared/ui/Icon";
import { useApp } from "../../app/providers/AppContext";

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
          shape: "rectangular",
          logo_alignment: "left",
          width: Math.min(400, Math.max(240, buttonRef.current.clientWidth)),
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
    return (
      <p className="google-auth-status" role="status">
        Đăng nhập Google chưa được cấu hình cho môi trường này.
      </p>
    );
  }

  return (
    <div
      className={`google-auth-control is-${status} ${disabled ? "is-disabled" : ""}`}
      aria-busy={status === "loading"}
      aria-disabled={disabled}
    >
      <div ref={buttonRef} className="google-auth-button" />
      {status === "loading" && <p className="google-auth-status">Đang tải đăng nhập Google…</p>}
      {status === "error" && (
        <button
          type="button"
          className="google-auth-retry"
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
      setResending(false);
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
    <main id="main-content" className="auth-page">
      <section className="auth-panel auth-panel--brand">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            width: "100%",
            zIndex: 2,
          }}
        >
          <button className="brand-button auth-brand" onClick={() => setScreen("landing")}>
            <Brand />
          </button>
        </div>

        <div className="auth-brand__content">
          <span className="auth-kicker">
            <i /> Không gian làm việc thời gian thực
          </span>
          <h1>
            Bước vào một không gian
            <br />
            <span>cùng chung quỹ đạo.</span>
          </h1>
          <p>Trò chuyện nhóm và họp video trong cùng một không gian làm việc.</p>

          <div className="auth-snapshot">
            <div className="auth-snapshot-head">
              <strong>Công cụ dành cho nhóm</strong>
              <span>CollabSpace</span>
            </div>
            <div className="auth-snapshot-body">
              <div className="auth-snapshot-row">
                <Icon name="message" size={16} />
                <span>Trao đổi qua kênh trò chuyện thời gian thực</span>
              </div>
              <div className="auth-snapshot-row">
                <Icon name="video" size={16} />
                <span>Tham gia họp video trong nhóm của bạn</span>
              </div>
              <div className="auth-snapshot-agenda">
                <strong>Quản lý nhóm và thành viên</strong>
                <span>Quyền truy cập gắn với tài khoản của bạn</span>
              </div>
            </div>
          </div>
        </div>

        <div style={{ fontSize: "11px", color: "var(--sidebar-muted)", zIndex: 2 }}>
          © 2026 CollabSpace · Đề tài tốt nghiệp CNTT
        </div>
      </section>

      <section className="auth-panel auth-panel--form">
        <div className="auth-mobile-head">
          <Brand />
          <div style={{ display: "flex", gap: "6px" }}>
            <IconButton label="Đóng" icon="x" onClick={() => setScreen("landing")} />
          </div>
        </div>

        <div className="auth-form-wrap">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={authStep === "form" ? authMode : authStep}
              className="auth-form-transition"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{
                opacity: 0,
                transition: { duration: 0.12, ease: "easeOut" },
              }}
              transition={{
                duration: 0.2,
                ease: [0.16, 1, 0.3, 1],
              }}
            >
              {authStep === "reset-request" || authStep === "reset-confirm" ? (
                <div className="password-reset-flow">
                  <button
                    type="button"
                    className="password-reset-back"
                    onClick={() => {
                      setAuthStep("form");
                      setErrors({});
                    }}
                  >
                    ← Quay lại đăng nhập
                  </button>
                  <h2>{authStep === "reset-request" ? "Quên mật khẩu?" : "Đặt lại mật khẩu"}</h2>
                  <p>
                    {authStep === "reset-request"
                      ? "Nhập email tài khoản để nhận mã xác thực."
                      : resetNotice}
                  </p>
                  {errors.general && (
                    <p className="password-reset-error" role="alert">
                      {errors.general}
                    </p>
                  )}
                  {authStep === "reset-request" ? (
                    <form onSubmit={handleResetRequest} noValidate>
                      <Field label="Email tài khoản" error={errors.email}>
                        <input
                          type="email"
                          autoComplete="email"
                          value={resetEmail}
                          onChange={(event) => setResetEmail(event.target.value)}
                          autoFocus
                        />
                      </Field>
                      <Button
                        size="lg"
                        type="submit"
                        disabled={loading}
                        style={{ width: "100%", marginTop: 16 }}
                      >
                        {loading ? "Đang gửi..." : "Gửi mã đặt lại"}
                      </Button>
                    </form>
                  ) : (
                    <form onSubmit={handleResetConfirm} noValidate>
                      <Field label="Mã xác thực 6 chữ số" error={errors.otp}>
                        <input
                          type="text"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          maxLength={6}
                          value={resetCode}
                          onChange={(event) =>
                            setResetCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                          }
                          autoFocus
                        />
                      </Field>
                      <Field label="Mật khẩu mới (8–128 ký tự)" error={errors.password}>
                        <input
                          type="password"
                          autoComplete="new-password"
                          value={resetPasswordValue}
                          onChange={(event) => setResetPasswordValue(event.target.value)}
                        />
                      </Field>
                      <Button
                        size="lg"
                        type="submit"
                        disabled={loading}
                        style={{ width: "100%", marginTop: 16 }}
                      >
                        {loading ? "Đang cập nhật..." : "Đổi mật khẩu"}
                      </Button>
                      <button
                        type="button"
                        className="password-reset-back"
                        onClick={() => {
                          setAuthStep("reset-request");
                          setErrors({});
                        }}
                      >
                        Yêu cầu mã mới
                      </button>
                    </form>
                  )}
                </div>
              ) : authStep === "otp" ? (
                <div>
                  <button
                    type="button"
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      background: "none",
                      border: "none",
                      color: "var(--text-muted)",
                      fontSize: "13px",
                      cursor: "pointer",
                      padding: 0,
                      marginBottom: "16px",
                    }}
                    onClick={() => {
                      setAuthStep("form");
                      setErrors({});
                    }}
                  >
                    ← Quay lại đăng nhập / đăng ký
                  </button>

                  <span className="eyebrow">XÁC THỰC BẢO MẬT</span>
                  <h2>Kích hoạt tài khoản</h2>
                  <p style={{ marginBottom: "12px" }}>
                    Mã xác thực 6 chữ số đã được gửi tới hòm thư của bạn:
                  </p>

                  <div
                    style={{
                      padding: "10px 14px",
                      borderRadius: "8px",
                      background: "var(--color-surface-hover, rgba(125, 125, 125, 0.08))",
                      fontWeight: 600,
                      color: "var(--color-primary, #6366f1)",
                      marginBottom: "16px",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      wordBreak: "break-all",
                    }}
                  >
                    <Icon name="mail" size={16} />
                    <span>{otpEmail}</span>
                  </div>

                  {errors.general && (
                    <div
                      style={{
                        padding: "10px 14px",
                        borderRadius: "6px",
                        background: "rgba(239, 68, 68, 0.12)",
                        color: "#ef4444",
                        fontSize: "13px",
                        marginBottom: "16px",
                        border: "1px solid rgba(239, 68, 68, 0.3)",
                        fontWeight: 500,
                      }}
                    >
                      {errors.general}
                    </div>
                  )}

                  <form onSubmit={handleVerifyOtpSubmit} noValidate>
                    <Field label="Nhập mã OTP 6 chữ số" error={errors.otp}>
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
                            setErrors((prev) => ({ ...prev, otp: undefined, general: undefined }));
                        }}
                        placeholder="••••••"
                        autoFocus
                        style={{
                          fontSize: "26px",
                          letterSpacing: "12px",
                          textAlign: "center",
                          fontWeight: 700,
                          fontFamily: "monospace",
                          padding: "14px 12px",
                          borderRadius: "8px",
                          border: errors.otp ? "1px solid #ef4444" : "1px solid var(--border)",
                          background: "var(--surface)",
                          color: "var(--text)",
                          width: "100%",
                          boxSizing: "border-box",
                        }}
                      />
                    </Field>

                    <Button
                      size="lg"
                      type="submit"
                      disabled={otpCode.length !== 6 || loading}
                      style={{ width: "100%", marginTop: "16px" }}
                    >
                      {loading ? "Đang xác thực mã..." : "Xác nhận & Vào không gian làm việc"}{" "}
                      <Icon name="arrow-right" />
                    </Button>
                  </form>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginTop: "20px",
                      paddingTop: "16px",
                      borderTop: "1px solid var(--border-subtle, rgba(125, 125, 125, 0.15))",
                    }}
                  >
                    <button
                      type="button"
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--text-muted)",
                        cursor: "pointer",
                        fontSize: "13px",
                      }}
                      onClick={() => {
                        setAuthStep("form");
                        setErrors({});
                      }}
                    >
                      ← Đổi email khác
                    </button>

                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={cooldown > 0 || resending}
                      onClick={handleResendOtpCode}
                    >
                      {resending
                        ? "Đang gửi lại..."
                        : cooldown > 0
                          ? `Gửi lại mã (${cooldown}s)`
                          : "Gửi lại mã OTP"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div>
                  <div
                    style={{
                      display: "flex",
                      gap: "8px",
                      marginBottom: "20px",
                      background: "var(--color-surface-hover, rgba(125, 125, 125, 0.08))",
                      padding: "4px",
                      borderRadius: "8px",
                    }}
                  >
                    <Button
                      variant={isLogin ? "primary" : "ghost"}
                      size="sm"
                      style={{ flex: 1 }}
                      onClick={() => {
                        setAuthMode("login");
                        setErrors({});
                      }}
                    >
                      Đăng nhập
                    </Button>
                    <Button
                      variant={!isLogin ? "primary" : "ghost"}
                      size="sm"
                      style={{ flex: 1 }}
                      onClick={() => {
                        setAuthMode("register");
                        setErrors({});
                      }}
                    >
                      Tạo tài khoản mới
                    </Button>
                  </div>

                  <span className="eyebrow">{isLogin ? "CHÀO MỪNG TRỞ LẠI" : "BẮT ĐẦU NGAY"}</span>
                  <h2>{isLogin ? "Đăng nhập vào workspace" : "Đăng ký tài khoản mới"}</h2>
                  <p>
                    {isLogin
                      ? "Tiếp tục với tài khoản làm việc của bạn."
                      : "Tạo tài khoản và workspace riêng của bạn chỉ trong vài giây."}
                  </p>

                  {errors.general && (
                    <div
                      style={{
                        padding: "10px 14px",
                        borderRadius: "6px",
                        background: "rgba(239, 68, 68, 0.12)",
                        color: "#ef4444",
                        fontSize: "13px",
                        marginBottom: "16px",
                        border: "1px solid rgba(239, 68, 68, 0.3)",
                        fontWeight: 500,
                      }}
                    >
                      {errors.general}
                    </div>
                  )}

                  <div className="sso-row">
                    <GoogleSignInButton onCredential={handleGoogleCredential} disabled={loading} />
                  </div>

                  <div className="auth-divider">
                    <span>
                      {isLogin ? "hoặc đăng nhập bằng email" : "hoặc điền thông tin đăng ký"}
                    </span>
                  </div>

                  <form onSubmit={submit} noValidate>
                    {!isLogin && (
                      <Field label="Họ và tên hiển thị" error={errors.displayName}>
                        <span className="input-with-icon">
                          <Icon name="users" />
                          <input
                            value={displayName}
                            onChange={(event) => setDisplayName(event.target.value)}
                            type="text"
                            aria-invalid={!!errors.displayName}
                            placeholder="Tên hiển thị của bạn"
                            autoFocus
                          />
                        </span>
                      </Field>
                    )}

                    <Field label="Email làm việc / cá nhân" error={errors.email}>
                      <span className="input-with-icon">
                        <Icon name="mail" />
                        <input
                          value={email}
                          onChange={(event) => setEmail(event.target.value)}
                          type="email"
                          aria-invalid={!!errors.email}
                          placeholder="Địa chỉ email của bạn"
                        />
                      </span>
                    </Field>

                    <Field label="Mật khẩu (tối thiểu 8 ký tự)" error={errors.password}>
                      <span className="input-with-icon">
                        <Icon name="lock" />
                        <input
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                          type={showPassword ? "text" : "password"}
                          aria-invalid={!!errors.password}
                        />
                        <button
                          type="button"
                          aria-label="Hiện mật khẩu"
                          onClick={() => setShowPassword(!showPassword)}
                        >
                          <Icon name="eye" />
                        </button>
                      </span>
                    </Field>

                    <Button
                      size="lg"
                      type="submit"
                      disabled={loading}
                      style={{ width: "100%", marginTop: "12px" }}
                    >
                      {loading
                        ? "Đang xử lý..."
                        : isLogin
                          ? "Đăng nhập"
                          : "Tiếp tục tạo tài khoản và nhận mã OTP"}{" "}
                      <Icon name="arrow-right" />
                    </Button>
                  </form>

                  {isLogin && (
                    <button
                      type="button"
                      className="password-reset-link"
                      onClick={() => {
                        setResetEmail(email.trim());
                        setAuthStep("reset-request");
                        setErrors({});
                      }}
                    >
                      Quên mật khẩu?
                    </button>
                  )}

                  <p className="auth-switch">
                    {isLogin ? "Chưa có tài khoản? " : "Đã có tài khoản? "}
                    <button
                      type="button"
                      onClick={() => {
                        setAuthMode(isLogin ? "register" : "login");
                        setErrors({});
                      }}
                    >
                      {isLogin ? "Đăng ký ngay" : "Đăng nhập ngay"}
                    </button>
                  </p>

                  <div className="auth-secure">
                    <Icon name="lock" size={13} /> Xác thực bảo mật với JWT & HttpOnly Session
                    Cookie
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </section>
    </main>
  );
}
