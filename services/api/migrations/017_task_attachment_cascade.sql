-- Channel/workspace cascade can visit file storage before tasks.
ALTER TABLE task_attachments DROP CONSTRAINT task_attachments_attachment_id_fkey;
ALTER TABLE task_attachments ADD CONSTRAINT task_attachments_attachment_id_fkey
 FOREIGN KEY(attachment_id) REFERENCES message_attachments(id) ON DELETE CASCADE;
