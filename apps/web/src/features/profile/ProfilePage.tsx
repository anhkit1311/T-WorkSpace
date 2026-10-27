import { useEffect, useRef, useState, type FormEvent } from "react";
import { AnimatePresence } from "motion/react";
import { useApp } from "../../app/providers/AppContext";
import { Button, Chip, Field, ListItem } from "../../shared/ui/Primitives";
import { LogoutConfirmDialog } from "../auth/LogoutConfirmDialog";
import { Icon } from "../../shared/ui/Icon";
import { changePasswordApi } from "../auth/api";
import "./profile.css";
import { focusFirstInvalid, shouldResetProfile } from "../../shared/lib/interaction";

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

  const handleUpdateProfile = async (event: FormEvent) => {
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

  const handleChangePassword = async (event: FormEvent) => {
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
  const roleLabel = isStudent
    ? "Sinh viên"
    : isAdmin
      ? "Quản trị viên"
      : "Cán bộ / Giảng viên";

  return (
    <div className="profile-page">
      <header className="profile-header">
        <div>
          <h1>Thông tin cá nhân & Tài khoản</h1>
          <p>Quản lý thông tin cá nhân và bảo mật tài khoản người dùng.</p>
        </div>
        <Chip icon="check">
          {isStudent ? "Tài khoản sinh viên" : isAdmin ? "Tài khoản quản trị" : "Tài khoản người dùng"}
        </Chip>
      </header>

      {/* Student / User Profile Summary Card */}
      <section className="profile-card profile-user-summary">
        <div className="profile-avatar-box">
          <div className="profile-avatar-large">
            {avatarUrl ? (
              <img src={avatarUrl} alt={displayName} />
            ) : (
              <span>{displayName.charAt(0).toUpperCase()}</span>
            )}
          </div>
          <label className="profile-avatar-upload-btn">
            <Icon name="camera" size={13} />
            <span>Đổi ảnh</span>
            <input
              id="profile-avatar"
              name="avatar"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => chooseImage(event.target.files?.[0])}
            />
          </label>
          {error && errorField === "avatar" && (
            <p className="field__error" role="alert" style={{ fontSize: 12 }}>
              {error}
            </p>
          )}
        </div>

        <div className="profile-user-details">
          <div className="profile-user-name-row">
            <h2>{displayName || "Chưa cập nhật tên"}</h2>
            <span className="profile-role-badge">{roleLabel}</span>
            <span className="profile-status-badge">Đang hoạt động</span>
          </div>
          <div className="profile-meta-tags">
            <div className="profile-meta-tag">
              <Icon name="profile" size={14} />
              <span>Tên đăng nhập: <strong>{username}</strong></span>
            </div>
            <div className="profile-meta-tag">
              <Icon name="mail" size={14} />
              <span>{user?.email || "Chưa có email"}</span>
            </div>
            {phoneNumber && (
              <div className="profile-meta-tag">
                <Icon name="phone" size={14} />
                <span>{phoneNumber}</span>
              </div>
            )}
            {address && (
              <div className="profile-meta-tag">
                <Icon name="home" size={14} />
                <span>{address}</span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Edit Personal Information Form */}
      <section className="profile-card">
        <h3 className="profile-section-title">
          <Icon name="profile" size={16} /> Thông tin cá nhân
        </h3>
        <form onSubmit={handleUpdateProfile} className="profile-form" onInput={() => setError("")}>
          {error && errorField === "profile" && <p className="field__error" role="alert">{error}</p>}

          <div className="profile-form-grid">
            <Field
              label="Họ và tên / Tên hiển thị"
              hint="Tên hiển thị với giảng viên và các thành viên khác."
              error={errorField === "displayName" ? error : undefined}
            >
              <input
                type="text"
                className="profile-field-input"
                value={displayName}
                maxLength={80}
                required
                disabled={saving}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  if (error) setError("");
                }}
                placeholder="Nhập họ và tên của bạn"
              />
            </Field>

            <Field
              label="Tên đăng nhập / Mã số"
              hint="Mã số sinh viên hoặc tên tài khoản (cố định theo trường cấp)."
            >
              <input
                type="text"
                className="profile-field-input is-readonly"
                value={username}
                disabled
                readOnly
              />
            </Field>

            <Field
              label="Địa chỉ Email"
              hint="Email đăng nhập chính của tài khoản (không thể thay đổi)."
            >
              <input
                type="email"
                className="profile-field-input is-readonly"
                value={user?.email || ""}
                disabled
                readOnly
              />
            </Field>

            <Field
              label="Số điện thoại"
              hint="Số điện thoại liên lạc cá nhân."
            >
              <input
                type="tel"
                className="profile-field-input"
                value={phoneNumber}
                maxLength={20}
                disabled={saving}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="Ví dụ: 0912 345 678"
              />
            </Field>

            <div className="profile-form-grid__full">
              <Field
                label="Địa chỉ cư trú"
                hint="Địa chỉ nơi ở hiện tại của sinh viên / người dùng."
              >
                <input
                  type="text"
                  className="profile-field-input"
                  value={address}
                  maxLength={150}
                  disabled={saving}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Ví dụ: 19 Nguyễn Hữu Thọ, Phường Tân Phong, Quận 7, TP. Hồ Chí Minh"
                />
              </Field>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <Button
              type="submit"
              variant="primary"
              icon="check"
              loading={saving}
              disabled={saving || !displayName.trim()}
            >
              Lưu thông tin cá nhân
            </Button>
          </div>
        </form>
      </section>

      {/* Security & Password Change */}
      <section className="profile-card">
        <h3 className="profile-section-title">
          <Icon name="lock" size={16} /> Đổi mật khẩu
        </h3>
        <p className="profile-password-hint">
          Sau khi đổi mật khẩu, phiên đăng nhập hiện tại sẽ được làm mới để đảm bảo an toàn.
        </p>
        <form onSubmit={handleChangePassword} className="profile-form profile-password-form" onInput={() => setPasswordError("")}>
          <Field label="Mật khẩu hiện tại">
            <input
              className="profile-field-input"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              name="currentPassword"
              aria-invalid={Boolean(passwordError && passwordErrorField === "currentPassword")}
              aria-describedby={passwordError ? "profile-password-error" : undefined}
              onChange={(event) => setCurrentPassword(event.target.value)}
              required
            />
          </Field>
          <Field label="Mật khẩu mới">
            <input
              className="profile-field-input"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              name="newPassword"
              aria-invalid={Boolean(passwordError && passwordErrorField === "newPassword")}
              aria-describedby={passwordError ? "profile-password-error" : undefined}
              onChange={(event) => setNewPassword(event.target.value)}
              minLength={8}
              maxLength={128}
              required
            />
          </Field>
          <Field label="Nhập lại mật khẩu mới">
            <input
              className="profile-field-input"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              name="confirmPassword"
              aria-invalid={Boolean(passwordError && passwordErrorField === "confirmPassword")}
              aria-describedby={passwordError ? "profile-password-error" : undefined}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
            />
          </Field>
          {passwordError && (
            <p className="profile-password-error" id="profile-password-error" role="alert">
              {passwordError}
            </p>
          )}
          <div>
            <Button
              type="submit"
              variant="primary"
              icon="lock"
              loading={changingPassword}
              disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
            >
              Cập nhật mật khẩu
            </Button>
          </div>
        </form>
      </section>

      {/* Account Info Details */}
      <section className="profile-card">
        <h3 className="profile-section-title">
          <Icon name="lock" size={16} /> Thông tin tài khoản hệ thống
        </h3>
        <div className="nexo-list-group profile-meta-list" role="list">
          <ListItem
            role="listitem"
            icon="profile"
            title="Mã tài khoản (User ID)"
            subtitle="Định danh nội bộ trên hệ thống T-WorkSpace"
            metaPrimary={user?.id || "—"}
            metaSecondary="Tài khoản TDTU"
          />
          <ListItem
            role="listitem"
            icon="mail"
            title="Email chính thức"
            subtitle="Email định danh người dùng"
            metaPrimary={user?.email || "Chưa có thông tin"}
            metaSecondary="Đã kích hoạt"
          />
        </div>
      </section>

      {/* Danger Zone */}
      <section className="profile-card profile-danger-zone">
        <h3 className="profile-section-title">Đăng xuất tài khoản</h3>
        <p style={{ fontSize: "14px", color: "var(--nexo-text-muted, #8A8780)", margin: "0 0 16px" }}>
          Đăng xuất sẽ kết thúc phiên làm việc hiện tại trên trình duyệt này.
        </p>
        <Button variant="secondary" icon="logout" onClick={() => setLogoutConfirmOpen(true)}>
          Đăng xuất khỏi thiết bị
        </Button>
      </section>

      {/* Logout Confirmation */}
      <AnimatePresence>
        {logoutConfirmOpen && <LogoutConfirmDialog onClose={() => setLogoutConfirmOpen(false)} />}
      </AnimatePresence>
    </div>
  );
}
