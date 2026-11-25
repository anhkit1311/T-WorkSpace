import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import { useApp } from "../../app/providers/AppContext";
import { LogoutConfirmDialog } from "../auth/LogoutConfirmDialog";
import { Icon, type IconName } from "../../shared/ui/Icon";
import { UserAvatar } from "../../shared/ui/kit/user-avatar";
import { cn } from "../../shared/lib/utils";
import { changePasswordApi } from "../auth/api";
import { focusFirstInvalid, shouldResetProfile } from "../../shared/lib/interaction";

const CARD = "rounded-[10px] border bg-card";
const CHIP =
  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap";
const GREEN = "bg-[var(--tint-green-bg)] text-[var(--tint-green-fg)]";
const BTN =
  "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-[7px] px-3.5 text-[13.5px] font-semibold whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY = "bg-primary text-primary-foreground hover:bg-primary/90";
const GHOST = "border bg-card hover:bg-secondary";
const HINT = "text-xs text-muted-foreground";
const ERROR = "text-[13px] text-destructive";

/** A titled card holding one form, with its buttons in a footer bar. */
function Section({
  icon,
  title,
  meta,
  footer,
  children,
  ...form
}: {
  icon: IconName;
  title: string;
  meta: string;
  footer: ReactNode;
  children: ReactNode;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onInput: () => void;
}) {
  return (
    <form className={cn(CARD, "overflow-hidden")} aria-label={title} {...form}>
      <div className="flex items-center gap-2.5 border-b px-[18px] py-3.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground">
          <Icon name={icon} size={16} />
        </span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <p className={HINT}>{meta}</p>
        </div>
      </div>
      {children}
      <div className="flex flex-wrap items-center gap-2.5 border-t bg-background px-[18px] py-3">
        {footer}
      </div>
    </form>
  );
}

export function ProfilePage() {
  const { user, accessToken, updateUser, notify, logout } = useApp();
  const [displayName, setDisplayName] = useState(user?.displayName || "");
  const [phoneNumber, setPhoneNumber] = useState(user?.contactText || "");
  const [address, setAddress] = useState(user?.location || "");
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl || "");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState("displayName");
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordErrorField, setPasswordErrorField] = useState("newPassword");
  const [changingPassword, setChangingPassword] = useState(false);

  const formValues = JSON.stringify([displayName, phoneNumber, address, avatarUrl]);
  const savedValues = useRef(formValues);
  const previousUserId = useRef(user?.id);
  const dirtyRef = useRef(false);
  dirtyRef.current = formValues !== savedValues.current;

  const reset = () => {
    const [name, phone, place, avatar] = JSON.parse(savedValues.current) as string[];
    setDisplayName(name);
    setPhoneNumber(phone);
    setAddress(place);
    setAvatarUrl(avatar);
    setError("");
  };

  useEffect(() => {
    if (!shouldResetProfile(previousUserId.current, user?.id, dirtyRef.current)) return;
    previousUserId.current = user?.id;
    savedValues.current = JSON.stringify([
      user?.displayName || "",
      user?.contactText || "",
      user?.location || "",
      user?.avatarUrl || "",
    ]);
    setDisplayName(user?.displayName || "");
    setPhoneNumber(user?.contactText || "");
    setAddress(user?.location || "");
    setAvatarUrl(user?.avatarUrl || "");
  }, [user]);

  const chooseImage = (file: File | undefined) => {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 2_000_000) {
      setErrorField("avatar");
      setError("Chọn ảnh PNG, JPEG hoặc WebP dưới 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setAvatarUrl(reader.result);
        setError("");
      }
    };
    reader.readAsDataURL(file);
  };

  const handleUpdateProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = displayName.trim();
    if (!trimmed || trimmed.length < 2) {
      setErrorField("displayName");
      setError("Tên hiển thị cần có ít nhất 2 ký tự.");
      focusFirstInvalid(event.currentTarget);
      return;
    }

    setSaving(true);
    setError("");
    try {
      await updateUser({
        displayName: trimmed,
        contactText: phoneNumber.trim(),
        location: address.trim(),
        avatarUrl,
      });
      savedValues.current = formValues;
      notify("Thành công", "Đã cập nhật thông tin cá nhân của bạn.", "success");
    } catch (cause: unknown) {
      setErrorField("profile");
      setError(cause instanceof Error ? cause.message : "Không thể cập nhật hồ sơ.");
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!accessToken) return;
    if (newPassword.length < 8 || newPassword.length > 128) {
      setPasswordErrorField("newPassword");
      setPasswordError("Mật khẩu mới phải có từ 8 đến 128 ký tự.");
      focusFirstInvalid(event.currentTarget);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordErrorField("confirmPassword");
      setPasswordError("Hai lần nhập mật khẩu mới chưa khớp.");
      focusFirstInvalid(event.currentTarget);
      return;
    }
    setChangingPassword(true);
    setPasswordError("");
    try {
      await changePasswordApi(accessToken, { currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      await logout("password-changed");
    } catch (cause) {
      setPasswordErrorField("currentPassword");
      setPasswordError(cause instanceof Error ? cause.message : "Không thể đổi mật khẩu.");
    } finally {
      setChangingPassword(false);
    }
  };

  // Tên đăng nhập / mã số sinh viên
  const username = user?.userCode
    ? user.userCode
    : user?.email
      ? user.email.split("@")[0]
      : user?.id
        ? user.id.slice(0, 8)
        : "—";

  // Any email domain: a student is told apart by the mã số (khóa + mã định danh + STT, digits first).
  const isStudent = /^[0-9]/.test(user?.userCode ?? "");
  const isAdmin = user?.email?.toLowerCase().includes("admin");
  const roleLabel = isStudent ? "Sinh viên" : isAdmin ? "Quản trị viên" : "Cán bộ / Giảng viên";
  const dirty = formValues !== savedValues.current;
  const passwordProps = (field: string) => ({
    type: "password",
    name: field,
    required: true,
    "aria-invalid": Boolean(passwordError && passwordErrorField === field),
    "aria-describedby": passwordError ? "profile-password-error" : undefined,
  });
  const locked = (
    <span className="ml-1 inline-flex items-center gap-1 text-[11.5px]">
      <Icon name="lock" size={11} />
      cấp bởi nhà trường
    </span>
  );

  return (
    <div className="tw tw-form grid min-w-0 gap-3.5 px-7 pt-5 pb-10 text-sm text-foreground max-md:px-3.5">
      <div>
        <h1 className="text-[22px] font-bold">Hồ sơ cá nhân</h1>
        <p className="text-[13px] text-muted-foreground">Thông tin cá nhân và bảo mật tài khoản</p>
      </div>

      <div className="grid min-w-0 items-start gap-4 min-[1000px]:grid-cols-[320px_minmax(0,1fr)]">
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 min-[1000px]:sticky min-[1000px]:top-2">
          <section
            className={cn(
              CARD,
              "grid justify-items-center gap-2.5 px-[18px] pt-[22px] pb-4 text-center",
            )}
            aria-label="Tài khoản của bạn"
          >
            <span className="relative">
              <UserAvatar
                name={displayName || "?"}
                image={avatarUrl || undefined}
                className="size-24 text-[34px]"
              />
              <label
                className="absolute -right-0.5 -bottom-0.5 grid size-8 cursor-pointer place-items-center rounded-full border-[3px] border-card bg-foreground text-background"
                title="Đổi ảnh đại diện"
              >
                <Icon name="camera" size={15} />
                <input
                  id="profile-avatar"
                  name="avatar"
                  type="file"
                  className="sr-only"
                  aria-label="Đổi ảnh đại diện"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(event) => chooseImage(event.target.files?.[0])}
                />
              </label>
            </span>
            {error && errorField === "avatar" && (
              <p className={ERROR} role="alert">
                {error}
              </p>
            )}
            {avatarUrl !== user?.avatarUrl && avatarUrl && (
              <p className={HINT}>Ảnh mới sẽ được lưu khi bấm "Lưu thay đổi".</p>
            )}
            <h2 className="text-[19px] font-bold">{displayName || "Chưa cập nhật tên"}</h2>
            <div className="flex flex-wrap justify-center gap-1.5">
              <span className={cn(CHIP, "bg-[var(--tint-blue-bg)] text-[var(--tint-blue-fg)]")}>
                {roleLabel}
              </span>
              <span className={cn(CHIP, GREEN)}>
                <span className="size-[7px] rounded-full bg-emerald-500" />
                Đang hoạt động
              </span>
            </div>
            <ul className="mt-1 grid w-full list-none gap-2 border-t pt-3 text-left text-[13px]">
              {(
                [
                  [
                    "profile",
                    <>
                      Tên đăng nhập: <b className="font-semibold">{username}</b>
                    </>,
                  ],
                  ["mail", user?.email || "Chưa có email"],
                  ["phone", phoneNumber],
                  ["home", address],
                ] as [IconName, ReactNode][]
              ).map(
                ([icon, text]) =>
                  text && (
                    <li key={icon} className="flex min-w-0 items-center gap-2.5">
                      <Icon name={icon} size={15} className="shrink-0 text-muted-foreground" />
                      <span className="min-w-0 truncate">{text}</span>
                    </li>
                  ),
              )}
            </ul>
          </section>

          <section className={cn(CARD, "py-1")} aria-label="Thông tin tài khoản hệ thống">
            <div className="flex items-center gap-2.5 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <small className={cn(HINT, "block")}>Mã tài khoản (User ID)</small>
                <code className="block truncate font-mono text-[12.5px] font-medium">
                  {user?.id || "—"}
                </code>
              </div>
              {user?.id && (
                <button
                  type="button"
                  className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-[7px] text-muted-foreground hover:bg-secondary hover:text-foreground"
                  aria-label="Sao chép mã tài khoản"
                  onClick={() =>
                    void navigator.clipboard.writeText(user.id).then(
                      () => notify("Đã sao chép mã tài khoản"),
                      () => notify("Không sao chép được mã tài khoản", undefined, "warning"),
                    )
                  }
                >
                  <Icon name="copy" size={14} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2.5 border-t px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <small className={cn(HINT, "block")}>Email chính thức</small>
                <b className="block truncate text-[13px] font-semibold">
                  {user?.email || "Chưa có thông tin"}
                </b>
              </div>
              <span className={cn(CHIP, GREEN)}>
                <Icon name="check" size={11} />
                Đã kích hoạt
              </span>
            </div>
          </section>

          <button
            type="button"
            className={cn(BTN, GHOST, "w-full")}
            onClick={() => setLogoutConfirmOpen(true)}
          >
            <Icon name="logout" size={15} />
            Đăng xuất khỏi thiết bị
          </button>
        </div>

        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3.5">
          <Section
            icon="profile"
            title="Thông tin cá nhân"
            meta="Tên, số điện thoại và địa chỉ hiển thị với đồng nghiệp"
            onSubmit={handleUpdateProfile}
            onInput={() => setError("")}
            footer={
              <>
                {error && errorField === "profile" && (
                  <p className={ERROR} role="alert">
                    {error}
                  </p>
                )}
                {dirty && !(error && errorField === "profile") && (
                  <span className="flex items-center gap-[7px] text-[13px] text-[var(--tint-amber-fg)]">
                    <span className="size-[7px] rounded-full bg-amber-500" />
                    Có thay đổi chưa lưu
                  </span>
                )}
                <div className="ml-auto flex gap-2">
                  {dirty && (
                    <button
                      type="button"
                      className={cn(BTN, GHOST)}
                      onClick={reset}
                      disabled={saving}
                    >
                      Hoàn tác
                    </button>
                  )}
                  <button
                    type="submit"
                    className={cn(BTN, PRIMARY)}
                    disabled={saving || !dirty || !displayName.trim()}
                  >
                    <Icon name="check" size={15} />
                    {saving ? "Đang lưu…" : "Lưu thay đổi"}
                  </button>
                </div>
              </>
            }
          >
            <div className="grid gap-3.5 px-[18px] py-4 md:grid-cols-2">
              <label>
                Họ và tên / Tên hiển thị
                <input
                  type="text"
                  value={displayName}
                  maxLength={80}
                  required
                  disabled={saving}
                  aria-invalid={Boolean(error && errorField === "displayName")}
                  aria-describedby={
                    error && errorField === "displayName" ? "profile-name-error" : undefined
                  }
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Nhập họ và tên của bạn"
                />
                {error && errorField === "displayName" ? (
                  <small id="profile-name-error" className={ERROR} role="alert">
                    {error}
                  </small>
                ) : (
                  <small className={HINT}>
                    Tên hiển thị với giảng viên và các thành viên khác.
                  </small>
                )}
              </label>
              <label>
                Số điện thoại
                <input
                  type="tel"
                  value={phoneNumber}
                  maxLength={20}
                  disabled={saving}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="Ví dụ: 0912 345 678"
                />
                <small className={HINT}>Số điện thoại liên lạc cá nhân.</small>
              </label>
              <label>
                <span>Tên đăng nhập / Mã số{locked}</span>
                <input
                  type="text"
                  className="bg-secondary! text-muted-foreground!"
                  value={username}
                  readOnly
                />
              </label>
              <label>
                <span>Email{locked}</span>
                <input
                  type="email"
                  className="bg-secondary! text-muted-foreground!"
                  value={user?.email || ""}
                  readOnly
                />
              </label>
              <label className="md:col-span-2">
                Địa chỉ cư trú
                <input
                  type="text"
                  value={address}
                  maxLength={150}
                  disabled={saving}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Ví dụ: 19 Nguyễn Hữu Thọ, Phường Tân Phong, Quận 7, TP. Hồ Chí Minh"
                />
              </label>
            </div>
          </Section>

          <Section
            icon="shield"
            title="Đổi mật khẩu"
            meta="Sau khi đổi, bạn sẽ được đăng xuất và đăng nhập lại bằng mật khẩu mới"
            onSubmit={handleChangePassword}
            onInput={() => setPasswordError("")}
            footer={
              <>
                {passwordError && (
                  <p className={ERROR} id="profile-password-error" role="alert">
                    {passwordError}
                  </p>
                )}
                <button
                  type="submit"
                  className={cn(BTN, PRIMARY, "ml-auto")}
                  disabled={
                    changingPassword || !currentPassword || !newPassword || !confirmPassword
                  }
                >
                  <Icon name="lock" size={15} />
                  {changingPassword ? "Đang cập nhật…" : "Cập nhật mật khẩu"}
                </button>
              </>
            }
          >
            <div className="grid gap-3.5 px-[18px] py-4 md:grid-cols-3">
              <label>
                Mật khẩu hiện tại
                <input
                  {...passwordProps("currentPassword")}
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                />
              </label>
              <label>
                Mật khẩu mới
                <input
                  {...passwordProps("newPassword")}
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                />
                <small className={HINT}>Từ 8 đến 128 ký tự.</small>
              </label>
              <label>
                Nhập lại mật khẩu mới
                <input
                  {...passwordProps("confirmPassword")}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                />
              </label>
            </div>
          </Section>
        </div>
      </div>

      <AnimatePresence>
        {logoutConfirmOpen && <LogoutConfirmDialog onClose={() => setLogoutConfirmOpen(false)} />}
      </AnimatePresence>
    </div>
  );
}
