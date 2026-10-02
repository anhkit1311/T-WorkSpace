CREATE UNIQUE INDEX memberships_single_owner ON memberships(workspace_id) WHERE role='owner';

CREATE FUNCTION verify_workspace_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target uuid;
BEGIN
  IF TG_TABLE_NAME='workspaces' THEN target := COALESCE(NEW.id, OLD.id);
  ELSE target := COALESCE(NEW.workspace_id, OLD.workspace_id);
  END IF;
  IF EXISTS (SELECT 1 FROM workspaces w WHERE w.id=target AND NOT EXISTS (
    SELECT 1 FROM memberships m WHERE m.workspace_id=w.id AND m.user_id=w.owner_id AND m.role='owner'
  )) THEN RAISE EXCEPTION 'Workspace must retain its owner membership' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER workspaces_owner_integrity AFTER INSERT OR UPDATE ON workspaces
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_workspace_owner();
CREATE CONSTRAINT TRIGGER memberships_owner_integrity AFTER INSERT OR UPDATE OR DELETE ON memberships
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_workspace_owner();
