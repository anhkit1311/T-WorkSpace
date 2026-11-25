import { useState, type FormEvent } from "react";
import { BookOpen, Eye, EyeOff, Lock, Mail, Phone, ShieldCheck, Video } from "lucide-react";
import { useApp } from "../../app/providers/AppContext";
import { TWorkSpaceLogo } from "../../shared/ui/TWorkSpaceLogo";
import { focusFirstInvalid } from "../../shared/lib/interaction";
import { cn } from "../../shared/lib/utils";

const FIELD =
  "flex h-[42px] items-center gap-2.5 rounded-[9px] border bg-background px-3 text-muted-foreground focus-within:border-foreground focus-within:ring-3 focus-within:ring-foreground/10 [&_input]:min-w-0 [&_input]:flex-1 [&_input]:bg-transparent [&_input]:text-sm [&_input]:text-foreground [&_input]:outline-none";
const FIELD_ERROR = "text-[12.5px] font-medium text-destructive";

export function LoginPage() {
  const { login } = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string; general?: string }>({});
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next: typeof errors = {};

    // Email, or a mã số sinh viên / giảng viên (letters and digits only).
    if (!/^\S+@\S+\.\S+$/.test(email.trim()) && !/^[A-Za-z0-9]{4,20}$/.test(email.trim())) {
      next.email = "Vui lòng nhập email hoặc mã số sinh viên / giảng viên hợp lệ.";
    }
    if (password.length < 8) {
      next.password = "Mật khẩu cần có ít nhất 8 ký tự.";
    }

    setErrors(next);
    if (Object.keys(next).length > 0) {
      focusFirstInvalid(event.currentTarget);
      return;
    }

    setLoading(true);
    try {
      await login({ email, password });
    } catch (err: unknown) {
      setErrors({ general: err instanceof Error ? err.message : "Đã xảy ra lỗi không xác định." });
    } finally {
      setLoading(false);
    }
  };

  return (
    // Bubble-phase onInput, not onInputCapture: a capture-phase state update re-renders the
    // controlled input with its old value before React's onChange runs, swallowing keystrokes.
    <main
      id="main-content"
      className="tw grid min-h-screen bg-card text-sm text-foreground min-[900px]:grid-cols-[minmax(0,1.15fr)_minmax(420px,1fr)]"
      onInput={(event) => {
        if (event.target instanceof HTMLInputElement && event.target.name) {
          const name = event.target.name as keyof typeof errors;
          setErrors((previous) =>
            previous[name] === undefined && previous.general === undefined
              ? previous
              : { ...previous, [name]: undefined, general: undefined },
          );
        }
      }}
    >
      <section className="relative flex flex-col overflow-hidden px-9 py-7 text-white max-[899px]:hidden">
        {/* The photo is low resolution, so it is blurred; the gradient on top stays sharp. */}
        <div
          aria-hidden="true"
          className="absolute -inset-[30px] scale-[1.04] bg-[url(/tdtu-campus.jpg)] bg-cover bg-center blur-[6px]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(180deg,rgba(9,9,11,.55)_0%,rgba(9,9,11,.2)_35%,rgba(9,9,11,.3)_55%,rgba(9,9,11,.85)_100%)]"
        />
        <div className="relative flex items-center gap-2.5 text-lg font-bold">
          <img src="/tdtu-mark.png" alt="" className="h-[30px] brightness-0 invert" />
          T-WorkSpace
        </div>
        <div className="relative mt-auto grid max-w-[520px] gap-3.5">
          <h2 className="text-[30px] leading-tight font-bold tracking-tight text-white!">
            Không gian làm việc số của Đại học Tôn Đức Thắng
          </h2>
          <p className="text-[15px] text-white/80">
            Nhắn tin, họp trực tuyến, tổng đài và khóa học nội bộ trong cùng một nơi.
          </p>
          <ul className="mt-1 flex list-none flex-wrap gap-2">
            {(
              [
                [Video, "Họp video"],
                [Phone, "Tổng đài"],
                [BookOpen, "Khóa học"],
              ] as const
            ).map(([FeatureIcon, label]) => (
              <li
                key={label}
                className="inline-flex items-center gap-[7px] rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[13px] font-medium backdrop-blur-sm"
              >
                <FeatureIcon className="size-[15px]" aria-hidden="true" />
                {label}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative mt-[22px] text-xs text-white/55">
          © {new Date().getFullYear()} Trường Đại học Tôn Đức Thắng
        </p>
      </section>

      <section className="flex flex-col px-9 py-7 max-[899px]:px-[18px] max-[899px]:py-5">
        <div className="m-auto grid w-full max-w-[380px] gap-[18px]">
          <div className="flex justify-center min-[900px]:hidden">
            <TWorkSpaceLogo size="md" />
          </div>
          <div>
            <h1 className="text-[26px] font-bold tracking-tight">Đăng nhập</h1>
            <p className="mt-1 text-muted-foreground">
              Dùng tài khoản trường cấp. Chưa có tài khoản? Liên hệ quản trị hệ thống.
            </p>
          </div>

          {errors.general && (
            <div
              className="rounded-[9px] bg-[var(--tint-red-bg)] px-3 py-2.5 text-[13px] text-[var(--tint-red-fg)]"
              role="alert"
            >
              {errors.general}
            </div>
          )}

          <form onSubmit={submit} noValidate className="grid gap-[18px]">
            <div className="grid gap-1.5">
              <label htmlFor="auth-email" className="text-[13px] font-semibold">
                Email hoặc mã số SV / GV
              </label>
              <div className={cn(FIELD, errors.email && "border-destructive")}>
                <Mail className="size-[17px] shrink-0" aria-hidden="true" />
                <input
                  type="text"
                  autoComplete="username"
                  value={email}
                  id="auth-email"
                  name="email"
                  aria-invalid={Boolean(errors.email)}
                  aria-describedby={errors.email ? "auth-email-error" : undefined}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="523H0048 hoặc mssv@student.tdtu.edu.vn"
                />
              </div>
              {errors.email && (
                <p className={FIELD_ERROR} id="auth-email-error" role="alert">
                  {errors.email}
                </p>
              )}
            </div>

            <div className="grid gap-1.5">
              <label htmlFor="auth-password" className="text-[13px] font-semibold">
                Mật khẩu
              </label>
              <div className={cn(FIELD, errors.password && "border-destructive")}>
                <Lock className="size-[17px] shrink-0" aria-hidden="true" />
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  id="auth-password"
                  name="password"
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={errors.password ? "auth-password-error" : undefined}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Tối thiểu 8 ký tự"
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
                  onClick={() => setShowPassword(!showPassword)}
                  className="grid size-[30px] shrink-0 cursor-pointer place-items-center rounded-md hover:bg-secondary hover:text-foreground"
                >
                  {showPassword ? (
                    <EyeOff className="size-[17px]" aria-hidden="true" />
                  ) : (
                    <Eye className="size-[17px]" aria-hidden="true" />
                  )}
                </button>
              </div>
              {errors.password && (
                <p className={FIELD_ERROR} id="auth-password-error" role="alert">
                  {errors.password}
                </p>
              )}
            </div>

            <p className="text-[12.5px] text-muted-foreground">
              Quên mật khẩu? Vui lòng liên hệ hotline để được hỗ trợ.
            </p>

            <button
              type="submit"
              disabled={loading}
              aria-busy={loading || undefined}
              className="h-11 cursor-pointer rounded-[9px] bg-primary text-[14.5px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Đang xử lý..." : "Đăng nhập"}
            </button>
          </form>

          <p className="flex items-center justify-center gap-[7px] text-[12.5px] text-muted-foreground">
            <ShieldCheck className="size-[15px] text-emerald-600" aria-hidden="true" />
            Phiên đăng nhập được mã hóa và bảo vệ
          </p>
        </div>
      </section>
    </main>
  );
}
