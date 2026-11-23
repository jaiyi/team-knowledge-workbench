-- Isolated synthetic operation fixtures only. Never migrate a live Workbench profile.
CREATE TABLE synthetic_operations (
  operation_id text PRIMARY KEY,
  asset_space_id text NOT NULL REFERENCES asset_spaces (asset_space_id),
  idempotency_key text NOT NULL,
  knowledge_id text NOT NULL CHECK (knowledge_id ~ '^fixture-[a-z0-9-]+$'),
  asset_revision integer NOT NULL CHECK (asset_revision > 0),
  expected_digest text NOT NULL CHECK (expected_digest ~ '^sha256:[0-9a-f]{64}$'),
  target text NOT NULL CHECK (target = 'synthetic-readback'),
  request_digest text NOT NULL CHECK (request_digest ~ '^sha256:[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN
    ('queued', 'running', 'waiting_readback', 'unknown', 'reconciling', 'succeeded')),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  lease_token text,
  lease_expires_at bigint,
  callback_sequence integer NOT NULL DEFAULT 0 CHECK (callback_sequence >= 0),
  UNIQUE (asset_space_id, idempotency_key),
  UNIQUE (operation_id, asset_space_id),
  CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL))
);

-- Separate executable delivery intent; knowledge_outbox is a transition event, not a Worker job.
CREATE TABLE synthetic_operation_outbox (
  operation_id text PRIMARY KEY,
  asset_space_id text NOT NULL,
  delivery_status text NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'delivered')),
  FOREIGN KEY (operation_id, asset_space_id)
    REFERENCES synthetic_operations (operation_id, asset_space_id)
);
