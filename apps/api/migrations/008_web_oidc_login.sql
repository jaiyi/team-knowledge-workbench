-- Browser login is separate from the existing TEST/Host session channel.
ALTER TABLE workbench_sessions ADD COLUMN channel text NOT NULL DEFAULT 'host'
  CHECK (channel IN ('host', 'web'));
ALTER TABLE workbench_sessions ADD COLUMN csrf_digest text;

CREATE TABLE web_oidc_attempts (
  state_digest text PRIMARY KEY,
  browser_digest text NOT NULL,
  environment text NOT NULL,
  nonce text NOT NULL,
  code_verifier text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
