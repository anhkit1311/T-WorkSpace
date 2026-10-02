CREATE UNIQUE INDEX messages_attachment_unique_idx
  ON messages(attachment_id) WHERE attachment_id IS NOT NULL;

CREATE UNIQUE INDEX message_attachments_message_unique_idx
  ON message_attachments(message_id) WHERE message_id IS NOT NULL;
