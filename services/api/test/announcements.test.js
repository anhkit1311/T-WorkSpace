import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { pool } from "../../../dist/api/infrastructure/database/db.js";
import {
  createAnnouncement,
  deleteAnnouncement,
  listAnnouncements,
  setAnnouncementMark,
  updateAnnouncement,
} from "../../../dist/api/modules/announcements/service.js";

test(
  "Announcements: a staff-only post never reaches a student, even one who may publish",
  { skip: process.env.RUN_DB_TESTS !== "1", timeout: 30000 },
  async () => {
    const [staff, student] = [randomUUID(), randomUUID()];
    const suffix = String(Date.now() % 1000000).padStart(6, "0");
    let postId = null;
    try {
      for (const [id, code] of [
        [staff, `QA${suffix}`],
        [student, `52${suffix}`],
      ])
        await pool.query(
          `INSERT INTO users(id,email,password_hash,display_name,email_verified,user_code) VALUES($1,$2,'test-only','Feed QA',true,$3)`,
          [id, `test-${id}@example.test`, code],
        );
      await pool.query(`INSERT INTO announcement_publishers(user_id) VALUES($1),($2)`, [
        staff,
        student,
      ]);

      const input = {
        title: "QA tin nội bộ cán bộ",
        category: "general",
        summary: "",
        content: "",
      };
      await assert.rejects(createAnnouncement(student, { ...input, audience: "staff" }), {
        statusCode: 403,
      });
      const post = await createAnnouncement(staff, { ...input, audience: "staff" });
      postId = post.id;
      assert.equal(post.audience, "staff");

      const has = async (userId) =>
        (await listAnnouncements(userId)).items.some((item) => item.id === postId);
      assert.equal(await has(staff), true);
      assert.equal(await has(student), false);
      await assert.rejects(updateAnnouncement(student, postId, { audience: "all" }), {
        statusCode: 404,
      });
      await assert.rejects(deleteAnnouncement(student, postId), { statusCode: 404 });

      // Marks: a hidden post cannot be liked; a like is per reader, counted once, and removable.
      await assert.rejects(setAnnouncementMark(student, postId, "like", true), { statusCode: 404 });

      await updateAnnouncement(staff, postId, { audience: "all" });
      assert.equal(await has(student), true);

      await setAnnouncementMark(student, postId, "like", true);
      assert.deepEqual(await setAnnouncementMark(student, postId, "like", true), { likeCount: 1 });
      await setAnnouncementMark(student, postId, "save", true);
      const seenBy = async (userId) =>
        (await listAnnouncements(userId)).items.find((item) => item.id === postId);
      const mine = await seenBy(student);
      assert.deepEqual([mine.likeCount, mine.liked, mine.saved], [1, true, true]);
      const theirs = await seenBy(staff);
      assert.deepEqual([theirs.likeCount, theirs.liked, theirs.saved], [1, false, false]);
      assert.deepEqual(await setAnnouncementMark(student, postId, "like", false), { likeCount: 0 });
    } finally {
      if (postId) await pool.query(`DELETE FROM portal_announcements WHERE id=$1`, [postId]);
      await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [[staff, student]]);
    }
  },
);
