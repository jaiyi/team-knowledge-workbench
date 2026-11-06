-- Disabling an identity invalidates its previously issued sessions and completed TEST logins.
ALTER TABLE workbench_identity_bindings
  ADD COLUMN revocation_epoch bigint NOT NULL DEFAULT 0 CHECK (revocation_epoch >= 0);
ALTER TABLE workbench_sessions
  ADD COLUMN identity_epoch bigint NOT NULL DEFAULT 0 CHECK (identity_epoch >= 0);
CREATE FUNCTION advance_identity_revocation_epoch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'active' AND NEW.status = 'disabled' THEN
    NEW.revocation_epoch := OLD.revocation_epoch + 1;
  ELSIF NEW.revocation_epoch <> OLD.revocation_epoch THEN
    RAISE EXCEPTION 'Identity revocation epoch cannot be changed directly';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER identity_revocation_epoch_on_update
  BEFORE UPDATE OF status, revocation_epoch ON workbench_identity_bindings
  FOR EACH ROW EXECUTE FUNCTION advance_identity_revocation_epoch();

-- Do not grandfather sessions that predate the revocation rule.
UPDATE workbench_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE revoked_at IS NULL;
