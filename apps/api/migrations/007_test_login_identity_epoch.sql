-- A completed TEST browser login fixes the identity generation at authentication time.
ALTER TABLE test_login_attempts
  ADD COLUMN identity_epoch bigint CHECK (identity_epoch >= 0);

-- Do not grandfather attempts that predate the revocation rule.
UPDATE test_login_attempts SET expires_at = CURRENT_TIMESTAMP
  WHERE claimed_at IS NULL AND expires_at > CURRENT_TIMESTAMP;
