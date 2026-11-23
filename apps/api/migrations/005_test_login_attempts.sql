-- Only for isolated loopback TEST login. Never treat these attempts as OIDC assertions.
CREATE TABLE test_login_attempts (
  attempt_id text PRIMARY KEY,
  claim_digest text NOT NULL,
  host_id text NOT NULL,
  environment text NOT NULL,
  csrf_digest text NOT NULL,
  subject text NOT NULL CHECK (subject IN ('memberA', 'memberB')),
  principal_id text REFERENCES workbench_identity_bindings (principal_id),
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  failures integer NOT NULL DEFAULT 0 CHECK (failures >= 0)
);

-- Serialize claims for the same TEST client so a switch cannot leave two live handles.
CREATE TABLE test_login_host_locks (
  host_id text NOT NULL,
  environment text NOT NULL,
  PRIMARY KEY (host_id, environment)
);
