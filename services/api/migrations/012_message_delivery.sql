ALTER TABLE messages ADD COLUMN client_message_id uuid;
ALTER TABLE messages ADD COLUMN client_payload_hash char(64);
CREATE UNIQUE INDEX messages_delivery_key ON messages(author_id, channel_id, client_message_id)
  WHERE client_message_id IS NOT NULL;
