ALTER TABLE storage_cleanup ADD COLUMN attempts integer NOT NULL DEFAULT 0;
ALTER TABLE storage_cleanup ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();
CREATE FUNCTION queue_deleted_object() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.storage_provider='s3' AND OLD.object_key IS NOT NULL THEN
    INSERT INTO storage_cleanup(id,object_key) VALUES(gen_random_uuid(),OLD.object_key)
    ON CONFLICT(object_key) DO NOTHING;
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER attachment_object_cleanup BEFORE DELETE ON message_attachments
FOR EACH ROW EXECUTE FUNCTION queue_deleted_object();
