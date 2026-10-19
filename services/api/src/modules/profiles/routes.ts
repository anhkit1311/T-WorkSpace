import type { RouteContext } from "../../shared/http/context.js";
import { getAuthUserId, readJson, sendJson } from "../../shared/http/utils.js";
import { HttpError } from "../../shared/http/http-error.js";
import { query } from "../../infrastructure/database/db.js";
import { updatePresenceVisibility } from "../../infrastructure/realtime/socket.js";
import { validateId } from "../workspaces/service.js";
export async function profileRoutes({
  request,
  response,
  io,
  pathname,
}: RouteContext): Promise<void> {
  if (request.method === "POST" && pathname === "/auth/profile") {
    const userId = await getAuthUserId(request);
    const body = await readJson(request, 5_000_000);
    const existing = await query<{
      displayName: string;
      bio: string;
      contactText: string;
      statusText: string;
      pronouns: string;
      location: string;
      interests: string[];
      favoriteMusic: string;
      profileVisibility: string;
      showActivity: boolean;
      showContact: boolean;
      notificationsEnabled: boolean;
      avatarUrl: string | null;
      coverUrl: string | null;
    }>(
      `SELECT display_name AS "displayName", bio, contact_text AS "contactText", status_text AS "statusText", pronouns, location, interests, favorite_music AS "favoriteMusic", profile_visibility AS "profileVisibility", show_activity AS "showActivity", show_contact AS "showContact", notifications_enabled AS "notificationsEnabled", avatar_url AS "avatarUrl", cover_url AS "coverUrl" FROM users WHERE id=$1`,
      [userId],
    );
    if (!existing.rowCount) throw new HttpError(401, "INVALID_TOKEN", "Tài khoản không tồn tại.");
    const current = existing.rows[0];
    const name =
      typeof body.displayName === "string" ? body.displayName.trim() : current.displayName;
    if (name.length < 2 || name.length > 80)
      throw new HttpError(400, "INVALID_DISPLAY_NAME", "Tên hiển thị phải có từ 2 đến 80 ký tự.");
    const bio = typeof body.bio === "string" ? body.bio.trim() : current.bio;
    const contactText =
      typeof body.contactText === "string" ? body.contactText.trim() : current.contactText;
    if (bio.length > 280 || contactText.length > 160)
      throw new HttpError(400, "INVALID_PROFILE", "Giới thiệu hoặc liên hệ quá dài.");
    const profileText = (value: unknown, fallback: string, limit: number) => {
      if (value === undefined) return fallback;
      if (typeof value !== "string" || value.trim().length > limit)
        throw new HttpError(400, "INVALID_PROFILE", "Thông tin hồ sơ không hợp lệ.");
      return value.trim();
    };
    const statusText = profileText(body.statusText, current.statusText, 100);
    const pronouns = profileText(body.pronouns, current.pronouns, 40);
    const location = profileText(body.location, current.location, 80);
    const favoriteMusic = profileText(body.favoriteMusic, current.favoriteMusic, 160);
    const interests = body.interests === undefined ? current.interests : body.interests;
    if (
      !Array.isArray(interests) ||
      interests.length > 8 ||
      interests.some((item) => typeof item !== "string" || !item.trim() || item.trim().length > 40)
    )
      throw new HttpError(
        400,
        "INVALID_INTERESTS",
        "Tối đa 8 sở thích, mỗi mục không quá 40 ký tự.",
      );
    const cleanInterests = Array.from(new Set(interests.map((item: string) => item.trim())));
    const profileVisibility =
      body.profileVisibility === "private" || body.profileVisibility === "workspace"
        ? body.profileVisibility
        : current.profileVisibility;
    const image = (value: unknown) =>
      value === null || value === ""
        ? null
        : typeof value === "string" &&
            ((/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value) &&
              value.length < 3_000_000) ||
              (/^https:\/\/[^\s]+$/.test(value) && value.length < 2048))
          ? value
          : undefined;
    const avatarUrl = image(body.avatarUrl === undefined ? current.avatarUrl : body.avatarUrl);
    const coverUrl = image(body.coverUrl === undefined ? current.coverUrl : body.coverUrl);
    if (avatarUrl === undefined || coverUrl === undefined)
      throw new HttpError(
        400,
        "INVALID_IMAGE",
        "Ảnh hồ sơ phải là PNG, JPEG hoặc WebP và không quá 2 MB.",
      );
    const result = await query(
      `UPDATE users SET display_name=$1, bio=$2, contact_text=$3, profile_visibility=$4,
       show_activity=$5, show_contact=$6, notifications_enabled=$7, avatar_url=$8, cover_url=$9,
       status_text=$10, pronouns=$11, location=$12, interests=$13, favorite_music=$14,
       updated_at=now() WHERE id=$15 RETURNING id,email,display_name AS "displayName",
       bio, contact_text AS "contactText", profile_visibility AS "profileVisibility",
       status_text AS "statusText", pronouns, location, interests, favorite_music AS "favoriteMusic",
       show_activity AS "showActivity", show_contact AS "showContact",
       notifications_enabled AS "notificationsEnabled", avatar_url AS "avatarUrl", cover_url AS "coverUrl",
       auth_provider AS "authProvider", email_verified AS "emailVerified"`,
      [
        name,
        bio,
        contactText,
        profileVisibility,
        typeof body.showActivity === "boolean" ? body.showActivity : current.showActivity,
        typeof body.showContact === "boolean" ? body.showContact : current.showContact,
        typeof body.notificationsEnabled === "boolean"
          ? body.notificationsEnabled
          : current.notificationsEnabled,
        avatarUrl,
        coverUrl,
        statusText,
        pronouns,
        location,
        cleanInterests,
        favoriteMusic,
        userId,
      ],
    );
    if (!result.rowCount) throw new HttpError(401, "INVALID_TOKEN", "Tài khoản không tồn tại.");
    updatePresenceVisibility(io, userId, name, result.rows[0].showActivity);
    sendJson(response, 200, { user: result.rows[0] });
    return;
  }

  const memberProfileMatch = pathname.match(/^\/api\/users\/([^/]+)\/profile$/);
  if (request.method === "GET" && memberProfileMatch) {
    const viewerId = await getAuthUserId(request);
    const targetId = memberProfileMatch[1];
    validateId(targetId);
    const result = await query<{
      id: string;
      displayName: string;
      avatarUrl: string | null;
      coverUrl: string | null;
      bio: string;
      contactText: string;
      statusText: string;
      pronouns: string;
      location: string;
      interests: string[];
      favoriteMusic: string;
      profileVisibility: string;
      showContact: boolean;
      showActivity: boolean;
    }>(
      `SELECT u.id, u.display_name AS "displayName", u.avatar_url AS "avatarUrl", u.cover_url AS "coverUrl", u.bio,
       u.contact_text AS "contactText", u.status_text AS "statusText", u.pronouns, u.location, u.interests,
       u.favorite_music AS "favoriteMusic", u.profile_visibility AS "profileVisibility",
       u.show_contact AS "showContact", u.show_activity AS "showActivity"
       FROM users u WHERE u.id=$1 AND ($1=$2 OR EXISTS (
         SELECT 1 FROM memberships own JOIN memberships viewer ON viewer.workspace_id=own.workspace_id
         WHERE own.user_id=$1 AND viewer.user_id=$2) OR EXISTS (
         SELECT 1 FROM direct_conversations d
         WHERE d.user_low=LEAST($1::uuid, $2::uuid) AND d.user_high=GREATEST($1::uuid, $2::uuid)))`,
      [targetId, viewerId],
    );
    const profile = result.rows[0];
    if (!profile || (targetId !== viewerId && profile.profileVisibility === "private"))
      throw new HttpError(404, "PROFILE_NOT_FOUND", "Hồ sơ này không hiển thị.");
    sendJson(response, 200, {
      profile: {
        id: profile.id,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
        coverUrl: profile.coverUrl,
        bio: profile.bio,
        contactText: profile.showContact || targetId === viewerId ? profile.contactText : "",
        statusText: profile.statusText,
        pronouns: profile.pronouns,
        location: profile.location,
        interests: profile.interests,
        favoriteMusic: profile.favoriteMusic,
        showActivity: profile.showActivity,
      },
    });
    return;
  }
}
