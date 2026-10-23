import { useEffect, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  Check,
  Eye,
  EyeOff,
  Lock,
  Mail,
  RotateCw,
  ShieldCheck,
} from "lucide-react";
import { ApiError } from "./api";
import { authErrorField } from "./auth-error-field";
import { useApp } from "../../app/providers/AppContext";
import { TWorkSpaceLogo } from "../../shared/ui/TWorkSpaceLogo";
import "./editorial-auth.css";
import { focusFirstInvalid, withPending } from "../../shared/lib/interaction";
import { useMotionSafe } from "../../shared/motion/MotionProvider";

export function LoginPage() {
  const safe = useMotionSafe();
  const {
    login,
    verifyOtp,
    resendOtp,
  } = useApp();

  const [authStep, setAuthStep] = useState<"form" | "otp">("form");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // OTP state
  const [otpCode, setOtpCode] = useState("");
  const [otpEmail, setOtpEmail] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [resending, setResending] = useState(false);

  const [errors, setErrors] = useState<{
    email?: string;
    password?: string;
    otp?: string;
    general?: string;
  }>({});
  const [loading, setLoading] = useState(false);

  // Cooldown countdown
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setInterval(() => {
      setCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: typeof errors = {};

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      next.email = "Vui lòng nhập email hợp lệ.";
    }
    if (password.length < 8) {
      next.password = "Mật khẩu cần có ít nhất 8 ký tự.";
    }

    setErrors(next);
    if (Object.keys(next).length > 0) { focusFirstInvalid(event.currentTarget); return; }

    setLoading(true);
    try {
      await login({ email, password });
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
      if (e) focusFirstInvalid(e.currentTarget);
      return;
    }
    const form = e?.currentTarget ?? null;
    setLoading(true);
    setErrors({});
    try {
      await verifyOtp({ email: otpEmail, otp: otpCode });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Mã xác thực không đúng hoặc đã hết hạn.";
      // One message, one alert: code errors sit on the field, the rest in the banner.
      if (authErrorField(err) === "otp") {
        setErrors({ otp: message });
        focusFirstInvalid(form);
      } else setErrors({ general: message });
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtpCode = async () => {
    if (cooldown > 0 || resending || !otpEmail) return;
    await withPending(async () => { try {
      const res = await resendOtp(otpEmail);
      setCooldown(res.cooldownSeconds || 60);
      setErrors({});
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Không thể gửi lại mã OTP. Vui lòng thử lại sau.";
      setErrors({ general: message });
    } }, setResending);
  };

  return (
    // Bubble-phase onInput, not onInputCapture: a capture-phase state update re-renders the
    // controlled input with its old value before React's onChange runs, swallowing keystrokes.
    <main id="main-content" className="editorial-auth-shell" onInput={event => {
      if (event.target instanceof HTMLInputElement && event.target.name) {
        const name = event.target.name as keyof typeof errors;
        setErrors(previous =>
          previous[name] === undefined && previous.general === undefined
            ? previous
            : { ...previous, [name]: undefined, general: undefined },
        );
      }
    }}>
      {/* Top Bar with Brand */}
      <header className="editorial-auth-nav">
        <div className="editorial-auth-brand" aria-label="T-WorkSpace">
          <TWorkSpaceLogo size="sm" />
        </div>
      </header>

      {/* Central Editorial Card */}
      <div className="editorial-auth-card">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={authStep}
            initial={safe.reduced ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: safe.reduced ? 1 : 0, y: safe.reduced ? 0 : -8, transition: { duration: safe.duration(0.15) } }}
            transition={{ duration: safe.duration(0.22), ease: [0.16, 1, 0.3, 1] }}
          >
            {authStep === "otp" ? (
              /* Step: OTP Verification */
              <div>
                <button
                  type="button"
                  className="editorial-sublink editorial-auth-style-5"
                  
                  onClick={() => {
                    setAuthStep("form");
                    setErrors({});
                  }}
                >
                  <ArrowLeft className="editorial-auth-style-4" />
                  <span>Quay lại</span>
                </button>

                <h1 className="editorial-auth-title">
                  Xác thực <em>danh tính</em>
                </h1>

                <p className="editorial-auth-desc">
                  Mã xác thực 6 chữ số đã được gửi tới địa chỉ email:
                </p>

                <div className="editorial-otp-target-pill">
                  <Mail className="editorial-auth-style-6" />
                  <span>{otpEmail}</span>
                </div>

                {errors.general && (
                  <div className="editorial-error-banner" role="alert">
                    {errors.general}
                  </div>
                )}

                <form onSubmit={handleVerifyOtpSubmit} noValidate>
                  <div className="editorial-field">
                    <label className="editorial-field-label editorial-auth-style-9" htmlFor="auth-code" >
                      Nhập mã OTP 6 chữ số
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      value={otpCode}
                      id="auth-code" name="otp" autoComplete="one-time-code" aria-invalid={Boolean(errors.otp)} aria-describedby={errors.otp ? "auth-code-error" : undefined}
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
                      <div className="editorial-field-error editorial-auth-style-9" id="auth-code-error" role="alert" >
                        {errors.otp}
                      </div>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={otpCode.length !== 6 || loading}
                    aria-busy={loading || undefined}
                    className="editorial-submit-btn"
                  >
                    {loading ? (
                      "Đang xác thực..."
                    ) : (
                      <>
                        <span>Xác nhận & Vào không gian</span>
                        <Check className="editorial-auth-style-6" />
                      </>
                    )}
                  </button>
                </form>

                <div
                  className="editorial-auth-style-10"
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
                    className="editorial-sublink editorial-auth-style-11"
                    
                  >
                    <RotateCw
                      className={(resending ? "editorial-otp-resending" : undefined) + " editorial-auth-style-12"}
                      
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
              /* Step: Main Form (Login) */
              <div>
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
                  <TWorkSpaceLogo size="lg" />
                </div>

                <h1 className="editorial-auth-title">T-WorkSpace</h1>

                <p className="editorial-auth-desc">
                  Đăng nhập bằng tài khoản trường cấp. Chưa có tài khoản? Liên hệ quản trị hệ thống.
                </p>

                {errors.general && (
                  <div className="editorial-error-banner" role="alert">
                    {errors.general}
                  </div>
                )}

                <form onSubmit={submit} noValidate>
                  <div className="editorial-field">
                    <label className="editorial-field-label" htmlFor="auth-email">Email tài khoản</label>
                    <div className="editorial-input-wrap">
                      <Mail className="editorial-input-icon editorial-auth-style-6"  />
                      <input
                        type="email"
                        autoComplete="email"
                        value={email}
                        id="auth-email" name="email" aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "auth-email-error" : undefined}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="mssv@student.tdtu.edu.vn"
                        className="editorial-input"
                      />
                    </div>
                    {errors.email && <div className="editorial-field-error" id="auth-email-error" role="alert">{errors.email}</div>}
                  </div>

                  <div className="editorial-field">
                    <label className="editorial-field-label" htmlFor="auth-password">Mật khẩu</label>
                    <div className="editorial-input-wrap">
                      <Lock className="editorial-input-icon editorial-auth-style-6"  />
                      <input
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        value={password}
                        id="auth-password" name="password" aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? "auth-password-error" : undefined}
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
                          <EyeOff className="editorial-auth-style-6" />
                        ) : (
                          <Eye className="editorial-auth-style-6" />
                        )}
                      </button>
                    </div>
                    {errors.password && (
                      <div className="editorial-field-error" id="auth-password-error" role="alert">{errors.password}</div>
                    )}
                  </div>

                  <p className="editorial-auth-forgot">
                    Quên mật khẩu? Vui lòng liên hệ hotline để được hỗ trợ.
                  </p>

                  <button type="submit" disabled={loading} aria-busy={loading || undefined} className="editorial-submit-btn">
                    {loading ? "Đang xử lý..." : "Đăng nhập"}
                  </button>
                </form>

                <div
                  className="editorial-auth-style-14"
                >
                  <ShieldCheck className="editorial-auth-style-4" />
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
