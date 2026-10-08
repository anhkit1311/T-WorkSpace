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
  const [bio, setBio] = useState(user?.bio || "");
  const [contactText, setContactText] = useState(user?.contactText || "");
  const [statusText, setStatusText] = useState(user?.statusText || "");
  const [pronouns, setPronouns] = useState(user?.pronouns || "");
  const [location, setLocation] = useState(user?.location || "");
  const [interestsText, setInterestsText] = useState((user?.interests || []).join(", "));
  const [favoriteMusic, setFavoriteMusic] = useState(user?.favoriteMusic || "");
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl || "");
  const [coverUrl, setCoverUrl] = useState(user?.coverUrl || "");
  const [profileVisibility, setProfileVisibility] = useState(
    user?.profileVisibility || "workspace",
  );
  const [showActivity, setShowActivity] = useState(user?.showActivity !== false);
  const [showContact, setShowContact] = useState(user?.showContact === true);
  const [notificationsEnabled, setNotificationsEnabled] = useState(
    user?.notificationsEnabled !== false,
  );
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
  const formValues = JSON.stringify([displayName,bio,contactText,statusText,pronouns,location,interestsText,favoriteMusic,avatarUrl,coverUrl,profileVisibility,showActivity,showContact,notificationsEnabled]);
  const savedValues = useRef(formValues);
  const previousUserId = useRef(user?.id);
  const dirtyRef = useRef(false);
  dirtyRef.current = formValues !== savedValues.current;

  useEffect(() => {
    if (!shouldResetProfile(previousUserId.current,user?.id,dirtyRef.current)) return;
    previousUserId.current = user?.id;
    savedValues.current = JSON.stringify([user?.displayName || "",user?.bio || "",user?.contactText || "",user?.statusText || "",user?.pronouns || "",user?.location || "",(user?.interests || []).join(", "),user?.favoriteMusic || "",user?.avatarUrl || "",user?.coverUrl || "",user?.profileVisibility || "workspace",user?.showActivity !== false,user?.showContact === true,user?.notificationsEnabled !== false]);
    setDisplayName(user?.displayName || "");
    setBio(user?.bio || "");
    setContactText(user?.contactText || "");
    setStatusText(user?.statusText || "");
    setPronouns(user?.pronouns || "");
    setLocation(user?.location || "");
    setInterestsText((user?.interests || []).join(", "));
    setFavoriteMusic(user?.favoriteMusic || "");
    setAvatarUrl(user?.avatarUrl || "");
    setCoverUrl(user?.coverUrl || "");
    setProfileVisibility(user?.profileVisibility || "workspace");
    setShowActivity(user?.showActivity !== false);
    setShowContact(user?.showContact === true);
    setNotificationsEnabled(user?.notificationsEnabled !== false);
  }, [user]);

  const chooseImage = (file: File | undefined, kind: "avatar" | "cover") => {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 2_000_000) {
      setErrorField(kind);
      setError("Chọn ảnh PNG, JPEG hoặc WebP dưới 2 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        if (kind === "avatar") setAvatarUrl(reader.result);
        else setCoverUrl(reader.result);
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
    const interests = Array.from(
      new Set(
        interestsText
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    );
    if (interests.length > 8 || interests.some((item) => item.length > 40)) {
      setErrorField("interests");
      setError("Nhập tối đa 8 sở thích, ngăn cách bằng dấu phẩy; mỗi mục tối đa 40 ký tự.");
      focusFirstInvalid(event.currentTarget);
      return;
    }

    setSaving(true);
    setError("");
    try {
      await updateUser({
        displayName: trimmed,
        bio: bio.trim(),
        contactText: contactText.trim(),
        statusText: statusText.trim(),
        pronouns: pronouns.trim(),
        location: location.trim(),
        interests,
        favoriteMusic: favoriteMusic.trim(),
        avatarUrl,
        coverUrl,
        profileVisibility,
        showActivity,
        showContact,
        notificationsEnabled,
      });
      savedValues.current = formValues;
      notify("Thành công", "Đã cập nhật thông tin hồ sơ của bạn.", "success");
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

  return (
    <div className="profile-page">
      <header className="profile-header">
        <div>
          <h1>Cài đặt trang cá nhân</h1>
          <p>Quản lý thông tin hồ sơ, quyền riêng tư và bảo mật tài khoản của bạn.</p>
        </div>
        <Chip icon="lock">
          {profileVisibility === "workspace" ? "Hiển thị cùng nhóm" : "Chỉ mình tôi"}
        </Chip>
      </header>

      {/* Identity preview */}
      <section className="profile-card profile-hero">
        <div
          className="profile-cover"
          style={
            coverUrl
              ? {
                  backgroundImage: `linear-gradient(180deg, transparent, rgba(8,10,12,.45)), url(${coverUrl})`,
                }
              : undefined
          }
        >
          <span>KHÔNG GIAN CỦA BẠN</span>
          <label className="profile-cover-upload">
            <Icon name="image" size={16} />
            <span>Đổi ảnh bìa</span>
            <input
              id="profile-cover"
              name="cover"
              aria-invalid={Boolean(error && errorField === "cover") || undefined}
              aria-describedby={error && errorField === "cover" ? "profile-cover-error" : undefined}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => chooseImage(event.target.files?.[0], "cover")}
            />
          </label>
          {error && errorField === "cover" && <p className="field__error" role="alert" id="profile-cover-error">{error}</p>}
        </div>
        <div className="profile-avatar-wrap">
          <div className="profile-avatar-large">
            {avatarUrl ? (
              <img src={avatarUrl} alt="Ảnh đại diện xem trước" />
            ) : (
              <img src="/avatar-fallback.svg" alt="Ảnh đại diện mặc định nexo" />
            )}
          </div>
          <label className="profile-avatar-upload">
            <Icon name="camera" size={16} />
            <span>Đổi ảnh đại diện</span>
            <input
              id="profile-avatar"
              name="avatar"
              aria-invalid={Boolean(error && errorField === "avatar") || undefined}
              aria-describedby={error && errorField === "avatar" ? "profile-avatar-error" : undefined}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => chooseImage(event.target.files?.[0], "avatar")}
            />
          </label>
          {error && errorField === "avatar" && <p className="field__error" role="alert" id="profile-avatar-error">{error}</p>}
        </div>
        <div className="profile-identity">
          <div className="profile-name-row">
            <h2>{displayName || "Chưa cập nhật thông tin"}</h2>
            {user?.email && <Chip icon="check">Đã đăng nhập</Chip>}
          </div>
          <p className="profile-email">{user?.email || "Chưa cập nhật email"}</p>
          <p className="profile-bio-preview">
            {bio || "Thêm một lời giới thiệu ngắn để đồng đội hiểu hơn về bạn."}
          </p>
          {statusText && <p className="profile-bio-preview">{statusText}</p>}
          <span className={`profile-activity ${showActivity ? "" : "is-hidden"}`}>
            <i /> {showActivity ? "Hiển thị hoạt động" : "Ẩn hoạt động"}
          </span>
          {!user?.displayName && (
            <p className="profile-incomplete-hint">
              Thêm tên hiển thị để thành viên khác nhận ra bạn.
            </p>
          )}
        </div>
      </section>

      {/* Edit Profile Form */}
      <section className="profile-card">
        <h3 className="profile-section-title">
          <Icon name="settings" size={16} /> Thông tin cá nhân
        </h3>
        <form onSubmit={handleUpdateProfile} className="profile-form" onInput={() => setError("")}>
          {error && errorField === "profile" && <p className="field__error" role="alert">{error}</p>}
          <div className="profile-input-row">
            <Field
              label="Tên hiển thị"
              hint="Tên này sẽ hiển thị với các thành viên khác trong nhóm và cuộc họp."
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
                placeholder="Nhập họ và tên hoặc biệt danh của bạn"
              />
            </Field>

            <Field label="Địa chỉ Email" hint="Email đăng nhập của tài khoản (không thể thay đổi).">
              <input
                type="email"
                className="profile-field-input"
                value={user?.email || ""}
                disabled
                style={{ opacity: 0.7, cursor: "not-allowed", background: "var(--surface-soft)" }}
              />
            </Field>
          </div>

          <Field label="Giới thiệu ngắn" hint={`${bio.length}/280 ký tự`}>
            <textarea
              className="profile-field-input"
              rows={3}
              maxLength={280}
              value={bio}
              onChange={(event) => setBio(event.target.value)}
              placeholder="Bạn muốn đồng đội biết điều gì về mình?"
            />
          </Field>
          <div className="profile-input-row">
            <Field
              label="Trạng thái của bạn"
              hint="Một dòng ngắn hiển thị trên hồ sơ, tối đa 100 ký tự."
            >
              <input
                className="profile-field-input"
                maxLength={100}
                value={statusText}
                onChange={(event) => setStatusText(event.target.value)}
                placeholder="Ví dụ: Đang tập trung làm đồ án"
              />
            </Field>
            <Field label="Đại từ xưng hô" hint="Tùy chọn, tối đa 40 ký tự.">
              <input
                className="profile-field-input"
                maxLength={40}
                value={pronouns}
                onChange={(event) => setPronouns(event.target.value)}
                placeholder="Ví dụ: mình / bạn"
              />
            </Field>
          </div>
          <div className="profile-input-row">
            <Field label="Khu vực" hint="Tùy chọn, tối đa 80 ký tự.">
              <input
                className="profile-field-input"
                maxLength={80}
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                placeholder="Ví dụ: TP. Hồ Chí Minh"
              />
            </Field>
            <Field label="Âm nhạc yêu thích" hint="Bài hát, nghệ sĩ hoặc thể loại bạn thích.">
              <input
                className="profile-field-input"
                maxLength={160}
                value={favoriteMusic}
                onChange={(event) => setFavoriteMusic(event.target.value)}
                placeholder="Ví dụ: Lofi khi làm việc"
              />
            </Field>
          </div>
          <Field label="Sở thích" hint="Tối đa 8 mục, ngăn cách bằng dấu phẩy." error={errorField === "interests" ? error : undefined}>
            <input
              className="profile-field-input"
              value={interestsText}
              onChange={(event) => setInterestsText(event.target.value)}
              placeholder="Ví dụ: Thiết kế, đọc sách, chạy bộ"
            />
          </Field>
          <Field
            label="Liên hệ"
            hint="Chỉ chia sẻ với thành viên cùng nhóm khi bật hiển thị liên hệ."
          >
            <input
              className="profile-field-input"
              maxLength={160}
              value={contactText}
              onChange={(event) => setContactText(event.target.value)}
              placeholder="Ví dụ: website hoặc số liên hệ"
            />
          </Field>

          <div className="profile-settings-grid">
            <div className="profile-settings-block">
              <h3>
                <Icon name="lock" size={17} /> Quyền riêng tư
              </h3>
              <label>
                Ai xem hồ sơ của bạn
                <select
                  value={profileVisibility}
                  onChange={(event) =>
                    setProfileVisibility(event.target.value as "workspace" | "private")
                  }
                >
                  <option value="workspace">Thành viên cùng nhóm</option>
                  <option value="private">Chỉ mình tôi</option>
                </select>
              </label>
              <label className="profile-toggle">
                <input
                  type="checkbox"
                  checked={showActivity}
                  onChange={(event) => setShowActivity(event.target.checked)}
                />
                <span>Hiển thị trạng thái hoạt động</span>
              </label>
              <label className="profile-toggle">
                <input
                  type="checkbox"
                  checked={showContact}
                  onChange={(event) => setShowContact(event.target.checked)}
                />
                <span>Hiển thị liên hệ với thành viên cùng nhóm</span>
              </label>
              <p>
                Nhắn tin và gọi trực tiếp chưa có trong hệ thống; trao đổi hiện diễn ra trong kênh
                nhóm.
              </p>
            </div>
            <div className="profile-settings-block">
              <h3>
                <Icon name="bell" size={17} /> Thông báo
              </h3>
              <label className="profile-toggle">
                <input
                  type="checkbox"
                  checked={notificationsEnabled}
                  onChange={(event) => setNotificationsEnabled(event.target.checked)}
                />
                <span>Cho phép thông báo mới trong ứng dụng</span>
              </label>
              <p>
                Ghim, tắt tiếng và đánh dấu đã đọc được điều chỉnh riêng ở từng kênh trò chuyện.
                Thiết bị gọi được chọn ở màn hình trước khi vào phòng.
              </p>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <Button
              type="submit"
              variant="primary"
              icon="check"
              loading={saving}
              disabled={saving || !displayName.trim()}
            >
              Lưu thay đổi
            </Button>
          </div>
        </form>
      </section>

      {/* Account data returned by the authenticated session */}
      {user?.authProvider !== "google" && (
        <section className="profile-card">
          <h3 className="profile-section-title">
            <Icon name="lock" size={16} /> Đổi mật khẩu
          </h3>
          <p className="profile-password-hint">
            Sau khi đổi mật khẩu, các phiên đăng nhập sẽ bị thu hồi và bạn cần đăng nhập lại.
          </p>
          <form onSubmit={handleChangePassword} className="profile-form profile-password-form" onInput={() => setPasswordError("")}>
            <Field label="Mật khẩu hiện tại">
              <input
                className="profile-field-input"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                name="currentPassword" aria-invalid={Boolean(passwordError && passwordErrorField === "currentPassword")} aria-describedby={passwordError ? "profile-password-error" : undefined}
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
                name="newPassword" aria-invalid={Boolean(passwordError && passwordErrorField === "newPassword")} aria-describedby={passwordError ? "profile-password-error" : undefined}
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
                name="confirmPassword" aria-invalid={Boolean(passwordError && passwordErrorField === "confirmPassword")} aria-describedby={passwordError ? "profile-password-error" : undefined}
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
                Đổi mật khẩu
              </Button>
            </div>
          </form>
        </section>
      )}

      {/* Account data returned by the authenticated session */}
      <section className="profile-card">
        <h3 className="profile-section-title">
          <Icon name="lock" size={16} /> Thông tin tài khoản
        </h3>
        <div className="nexo-list-group profile-meta-list" role="list">
          <ListItem
            role="listitem"
            icon="profile"
            title="Mã tài khoản"
            subtitle="Định danh phiên đăng nhập hiện tại"
            metaPrimary={user?.id || "—"}
            metaSecondary="Tài khoản Nexo"
          />
          <ListItem
            role="listitem"
            icon="mail"
            title="Email đăng nhập"
            subtitle="Địa chỉ xác thực chính của tài khoản"
            metaPrimary={user?.email || "Chưa có thông tin"}
            metaSecondary="Đã xác thực"
          />
        </div>
      </section>

      {/* Danger Zone */}
      <section className="profile-card profile-danger-zone">
        <h3 className="profile-section-title">Đăng xuất tài khoản</h3>
        <p style={{ fontSize: "14px", color: "var(--nexo-text-muted, #8A8780)", margin: "0 0 16px" }}>
          Đăng xuất sẽ xóa phiên làm việc hiện tại trên trình duyệt này.
        </p>
        <Button variant="secondary" icon="logout" onClick={() => setLogoutConfirmOpen(true)}>
          Đăng xuất khỏi thiết bị
        </Button>
      </section>

      {/* Logout Confirmation (shared with the account menu) */}
      <AnimatePresence>
        {logoutConfirmOpen && <LogoutConfirmDialog onClose={() => setLogoutConfirmOpen(false)} />}
      </AnimatePresence>
    </div>
  );
}
