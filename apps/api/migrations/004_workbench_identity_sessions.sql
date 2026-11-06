-- Internal identity mapping and session state only; this migration does not issue sessions or connect an IdP.
CREATE TABLE workbench_identity_bindings (
  issuer text NOT NULL,
  subject text NOT NULL,
  principal_id text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  PRIMARY KEY (issuer, subject)
);

-- Only digests of high-entropy handles belong here. Host attestation and issuance require separate approval.
CREATE TABLE workbench_sessions (
  handle_digest text PRIMARY KEY CHECK (handle_digest ~ '^sha256:[0-9a-f]{64}$'),
  principal_id text NOT NULL REFERENCES workbench_identity_bindings (principal_id),
  host_id text NOT NULL,
  environment text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
