import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { withTransaction } from "../../infrastructure/database/db.js";
import { HttpError } from "../../shared/http/http-error.js";
import type {
  AnnouncementAudience,
  AnnouncementCategory,
  AnnouncementMark,
  CreateAnnouncementInput,
  PortalAnnouncement,
  UpdateAnnouncementInput,
} from "@doan/shared";

export async function checkCanPublish(
  client: PoolClient,
  userId: string,
): Promise<{ canPublish: boolean; role: string }> {
  // 1. Check academic role grants (system_admin, unit_admin, unit_head)
  const roleGrants = await client.query<{ role: string }>(
    `SELECT role FROM academic_role_grants WHERE user_id=$1`,
    [userId],
  );
  if (roleGrants.rows.some((r) => r.role === "system_admin")) {
    return { canPublish: true, role: "system_admin" };
  }
  if (roleGrants.rows.some((r) => r.role === "unit_admin" || r.role === "unit_head")) {
    return { canPublish: true, role: roleGrants.rows[0].role };
  }

  // 2. Check academic staff (lecturers / department faculty)
  const staff = await client.query<{ academic_rank: string }>(
    `SELECT academic_rank FROM academic_staff WHERE user_id=$1 AND active=true`,
    [userId],
  );
  if (staff.rowCount && staff.rowCount > 0) {
    return { canPublish: true, role: "lecturer" };
  }

  // 3. Check explicit announcement publishers
  const publisher = await client.query<{ user_id: string }>(
    `SELECT user_id FROM announcement_publishers WHERE user_id=$1`,
    [userId],
  );
  if (publisher.rowCount && publisher.rowCount > 0) {
    return { canPublish: true, role: "publisher" };
  }

  // 4. Check workspace owner/admin
  const membership = await client.query<{ role: string }>(
    `SELECT role FROM memberships WHERE user_id=$1 AND role IN ('owner', 'admin') LIMIT 1`,
    [userId],
  );
  if (membership.rowCount && membership.rowCount > 0) {
    return { canPublish: true, role: "workspace_admin" };
  }

  return { canPublish: false, role: "student" };
}

/**
 * Readers of staff-only posts: role holders, lecturers and office accounts (a mã số that does not
 * start with a digit, the staff directory's rule). An account without a mã số counts as a student.
 */
async function isStaff(client: PoolClient, userId: string): Promise<boolean> {
  const res = await client.query(
    `SELECT 1 FROM users u WHERE u.id=$1 AND (
       u.user_code ~ '^[^0-9]'
       OR EXISTS(SELECT 1 FROM academic_role_grants g WHERE g.user_id=u.id)
       OR EXISTS(SELECT 1 FROM academic_staff s WHERE s.user_id=u.id AND s.active))`,
    [userId],
  );
  return Boolean(res.rowCount);
}

/** SQL condition: the reader may see the post ($n = staff flag, $n+1 = reader id). */
const visibleTo = (n: number) => `(audience = 'all' OR $${n}::boolean OR author_id = $${n + 1})`;

/** SQL: the reader ($2) has put this mark on the listed post. */
const markedBy = (kind: AnnouncementMark) =>
  `EXISTS(SELECT 1 FROM announcement_marks m WHERE m.announcement_id = portal_announcements.id
     AND m.user_id = $2 AND m.kind = '${kind}')`;

function audienceOf(value: unknown, staff: boolean): AnnouncementAudience {
  if (value !== "staff") return "all";
  if (!staff)
    throw new HttpError(403, "FORBIDDEN", "Chỉ cán bộ, giảng viên được đăng tin nội bộ cán bộ.");
  return "staff";
}

export async function listAnnouncements(
  userId: string,
  category?: string,
): Promise<{ items: PortalAnnouncement[]; canPublish: boolean; role: string; isStaff: boolean }> {
  return withTransaction(async (client) => {
    const perm = await checkCanPublish(client, userId);
    const staff = await isStaff(client, userId);
    let sql = `
      SELECT
        id,
        title,
        category,
        badge,
        summary,
        content,
        scope,
        audience,
        pinned,
        author_id AS "authorId",
        author_name AS "authorName",
        author_title AS "authorTitle",
        unit_id AS "unitId",
        created_at AS "createdAt",
        updated_at AS "updatedAt",
        (SELECT count(*)::int FROM announcement_marks m
          WHERE m.announcement_id = portal_announcements.id AND m.kind = 'like') AS "likeCount",
        ${markedBy("like")} AS liked,
        ${markedBy("save")} AS saved
      FROM portal_announcements
      WHERE ${visibleTo(1)}
    `;
    const params: unknown[] = [staff, userId];
    if (category && category !== "all") {
      sql += ` AND category = $3`;
      params.push(category);
    }
    sql += ` ORDER BY pinned DESC, created_at DESC LIMIT 50`;

    const res = await client.query<PortalAnnouncement>(sql, params);
    const items = res.rows.map((row) => ({
      ...row,
      canManage: perm.canPublish,
    }));

    return { items, canPublish: perm.canPublish, role: perm.role, isStaff: staff };
  });
}

export async function createAnnouncement(
  userId: string,
  input: CreateAnnouncementInput,
): Promise<PortalAnnouncement> {
  return withTransaction(async (client) => {
    const perm = await checkCanPublish(client, userId);
    if (!perm.canPublish) {
      throw new HttpError(403, "FORBIDDEN", "Bạn không có quyền đăng tải thông báo.");
    }

    const title = input.title?.trim();
    if (!title || title.length < 3 || title.length > 255) {
      throw new HttpError(400, "INVALID_INPUT", "Tiêu đề thông báo phải từ 3 đến 255 ký tự.");
    }

    const summary = input.summary?.trim() || title;
    const content = input.content?.trim() || summary;

    // Get author display name
    const userRes = await client.query<{ display_name: string }>(
      `SELECT display_name FROM users WHERE id=$1`,
      [userId],
    );
    const authorName = userRes.rows[0]?.display_name || "Cán bộ TDTU";

    let authorTitle = "Phòng Công tác Sinh viên";
    if (perm.role === "system_admin") authorTitle = "Ban Quản trị Cổng TDTU";
    else if (perm.role === "unit_admin" || perm.role === "unit_head")
      authorTitle = "Văn phòng Khoa";
    else if (perm.role === "lecturer") authorTitle = "Giảng viên / Học vụ";
    else if (perm.role === "publisher") authorTitle = "Ban Truyền thông & Sự kiện";

    const id = randomUUID();
    const category: AnnouncementCategory = input.category || "general";
    const badge = input.badge || (category === "urgent" ? "Khẩn" : "Mới");
    const scope = input.scope?.trim() || "Toàn trường";
    const pinned = Boolean(input.pinned);
    const audience = audienceOf(input.audience, await isStaff(client, userId));

    const insertRes = await client.query<PortalAnnouncement>(
      `
      INSERT INTO portal_announcements (
        id, title, category, badge, summary, content, scope, pinned,
        author_id, author_name, author_title, audience, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), now())
      RETURNING
        id, title, category, badge, summary, content, scope, audience, pinned,
        author_id AS "authorId", author_name AS "authorName", author_title AS "authorTitle",
        unit_id AS "unitId", created_at AS "createdAt", updated_at AS "updatedAt"
      `,
      [
        id,
        title,
        category,
        badge,
        summary,
        content,
        scope,
        pinned,
        userId,
        authorName,
        authorTitle,
        audience,
      ],
    );

    return { ...insertRes.rows[0], canManage: true };
  });
}

export async function updateAnnouncement(
  userId: string,
  announcementId: string,
  input: UpdateAnnouncementInput,
): Promise<PortalAnnouncement> {
  return withTransaction(async (client) => {
    const perm = await checkCanPublish(client, userId);
    if (!perm.canPublish) {
      throw new HttpError(403, "FORBIDDEN", "Bạn không có quyền chỉnh sửa thông báo.");
    }

    // A staff-only post does not exist for a publisher who may not read it.
    const staff = await isStaff(client, userId);
    const current = await client.query(
      `SELECT 1 FROM portal_announcements WHERE id=$1 AND ${visibleTo(2)}`,
      [announcementId, staff, userId],
    );
    if (!current.rowCount) {
      throw new HttpError(404, "NOT_FOUND", "Không tìm thấy thông báo.");
    }

    const updates: string[] = ["updated_at = now()"];
    const values: unknown[] = [announcementId];
    let idx = 2;

    if (input.title !== undefined) {
      const title = input.title.trim();
      if (title.length < 3 || title.length > 255) {
        throw new HttpError(400, "INVALID_INPUT", "Tiêu đề thông báo phải từ 3 đến 255 ký tự.");
      }
      updates.push(`title = $${idx++}`);
      values.push(title);
    }
    if (input.category !== undefined) {
      updates.push(`category = $${idx++}`);
      values.push(input.category);
    }
    if (input.badge !== undefined) {
      updates.push(`badge = $${idx++}`);
      values.push(input.badge);
    }
    if (input.summary !== undefined) {
      updates.push(`summary = $${idx++}`);
      values.push(input.summary.trim());
    }
    if (input.content !== undefined) {
      updates.push(`content = $${idx++}`);
      values.push(input.content.trim());
    }
    if (input.scope !== undefined) {
      updates.push(`scope = $${idx++}`);
      values.push(input.scope.trim());
    }
    if (input.audience !== undefined) {
      updates.push(`audience = $${idx++}`);
      values.push(audienceOf(input.audience, staff));
    }
    if (input.pinned !== undefined) {
      updates.push(`pinned = $${idx++}`);
      values.push(Boolean(input.pinned));
    }

    const res = await client.query<PortalAnnouncement>(
      `
      UPDATE portal_announcements
      SET ${updates.join(", ")}
      WHERE id = $1
      RETURNING
        id, title, category, badge, summary, content, scope, audience, pinned,
        author_id AS "authorId", author_name AS "authorName", author_title AS "authorTitle",
        unit_id AS "unitId", created_at AS "createdAt", updated_at AS "updatedAt"
      `,
      values,
    );

    return { ...res.rows[0], canManage: true };
  });
}

export async function deleteAnnouncement(userId: string, announcementId: string): Promise<void> {
  return withTransaction(async (client) => {
    const perm = await checkCanPublish(client, userId);
    if (!perm.canPublish) {
      throw new HttpError(403, "FORBIDDEN", "Bạn không có quyền xóa thông báo.");
    }

    const res = await client.query(
      `DELETE FROM portal_announcements WHERE id=$1 AND ${visibleTo(2)}`,
      [announcementId, await isStaff(client, userId), userId],
    );
    if (!res.rowCount) {
      throw new HttpError(404, "NOT_FOUND", "Không tìm thấy thông báo để xóa.");
    }
  });
}

/** Sets or clears the reader's heart or bookmark. A post the reader may not see does not exist. */
export async function setAnnouncementMark(
  userId: string,
  announcementId: string,
  kind: AnnouncementMark,
  on: boolean,
): Promise<{ likeCount: number }> {
  return withTransaction(async (client) => {
    const post = await client.query(
      `SELECT 1 FROM portal_announcements WHERE id=$1 AND ${visibleTo(2)}`,
      [announcementId, await isStaff(client, userId), userId],
    );
    if (!post.rowCount) throw new HttpError(404, "NOT_FOUND", "Không tìm thấy thông báo.");
    await client.query(
      on
        ? `INSERT INTO announcement_marks(announcement_id, user_id, kind) VALUES($1,$2,$3)
           ON CONFLICT DO NOTHING`
        : `DELETE FROM announcement_marks WHERE announcement_id=$1 AND user_id=$2 AND kind=$3`,
      [announcementId, userId, kind],
    );
    const likes = await client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM announcement_marks WHERE announcement_id=$1 AND kind='like'`,
      [announcementId],
    );
    return { likeCount: likes.rows[0].n };
  });
}

export async function listPublishers(userId: string) {
  return withTransaction(async (client) => {
    const perm = await checkCanPublish(client, userId);
    const res = await client.query<{
      userId: string;
      email: string;
      displayName: string;
      grantedAt: string;
    }>(
      `
      SELECT
        p.user_id AS "userId",
        u.email,
        u.display_name AS "displayName",
        p.created_at AS "grantedAt"
      FROM announcement_publishers p
      JOIN users u ON u.id = p.user_id
      ORDER BY p.created_at DESC
      `,
    );

    return {
      publishers: res.rows,
      canManage: perm.role === "system_admin" || perm.role === "unit_admin",
    };
  });
}

export async function grantPublisher(adminId: string, email: string) {
  return withTransaction(async (client) => {
    const perm = await checkCanPublish(client, adminId);
    if (
      perm.role !== "system_admin" &&
      perm.role !== "unit_admin" &&
      perm.role !== "workspace_admin"
    ) {
      throw new HttpError(
        403,
        "FORBIDDEN",
        "Chỉ quản trị viên mới có quyền cấp quyền đăng thông báo.",
      );
    }

    const target = await client.query<{ id: string; display_name: string }>(
      `SELECT id, display_name FROM users WHERE lower(email) = lower($1)`,
      [email.trim()],
    );
    if (!target.rowCount) {
      throw new HttpError(404, "NOT_FOUND", "Không tìm thấy người dùng với email này.");
    }

    const targetUserId = target.rows[0].id;
    await client.query(
      `
      INSERT INTO announcement_publishers (user_id, granted_by, created_at)
      VALUES ($1, $2, now())
      ON CONFLICT (user_id) DO NOTHING
      `,
      [targetUserId, adminId],
    );

    return { success: true, userId: targetUserId, displayName: target.rows[0].display_name };
  });
}

export async function revokePublisher(adminId: string, targetUserId: string) {
  return withTransaction(async (client) => {
    const perm = await checkCanPublish(client, adminId);
    if (
      perm.role !== "system_admin" &&
      perm.role !== "unit_admin" &&
      perm.role !== "workspace_admin"
    ) {
      throw new HttpError(
        403,
        "FORBIDDEN",
        "Chỉ quản trị viên mới có quyền thu hồi quyền đăng thông báo.",
      );
    }

    await client.query(`DELETE FROM announcement_publishers WHERE user_id = $1`, [targetUserId]);

    return { success: true };
  });
}
