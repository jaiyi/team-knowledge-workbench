-- P0-14 foundation only. Apply to a dedicated non-production database before enabling any caller.
CREATE TABLE asset_spaces (
  asset_space_id text PRIMARY KEY,
  team_id text NOT NULL,
  UNIQUE (team_id, asset_space_id)
);

CREATE TABLE knowledge_role_bindings (
  actor_id text NOT NULL,
  team_id text NOT NULL,
  asset_space_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'steward', 'reviewer', 'publisher')),
  PRIMARY KEY (actor_id, team_id, asset_space_id, role),
  FOREIGN KEY (team_id, asset_space_id) REFERENCES asset_spaces (team_id, asset_space_id)
);

-- Full asset content is not stored here. Its digest binds the caller's validated snapshot.
CREATE TABLE knowledge_states (
  knowledge_id text PRIMARY KEY,
  team_id text NOT NULL,
  asset_space_id text NOT NULL,
  status text NOT NULL,
  state_version integer NOT NULL CHECK (state_version >= 0),
  asset_revision integer NOT NULL CHECK (asset_revision > 0),
  asset_digest text NOT NULL CHECK (asset_digest ~ '^sha256:[0-9a-f]{64}$'),
  UNIQUE (knowledge_id, team_id, asset_space_id),
  FOREIGN KEY (team_id, asset_space_id) REFERENCES asset_spaces (team_id, asset_space_id)
);

CREATE TABLE knowledge_transition_events (
  transition_id text PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  command_digest text NOT NULL CHECK (command_digest ~ '^sha256:[0-9a-f]{64}$'),
  correlation_id text NOT NULL,
  knowledge_id text NOT NULL,
  team_id text NOT NULL,
  asset_space_id text NOT NULL,
  actor_id text NOT NULL,
  from_status text NOT NULL,
  to_status text NOT NULL,
  state_version integer NOT NULL CHECK (state_version > 0),
  asset_revision integer NOT NULL CHECK (asset_revision > 0),
  UNIQUE (transition_id, knowledge_id, asset_space_id, state_version),
  FOREIGN KEY (knowledge_id, team_id, asset_space_id)
    REFERENCES knowledge_states (knowledge_id, team_id, asset_space_id)
);

-- This is a transition-event delivery intent, not a Provider operation or Worker lease.
CREATE TABLE knowledge_outbox (
  event_id text PRIMARY KEY,
  knowledge_id text NOT NULL,
  asset_space_id text NOT NULL,
  state_version integer NOT NULL CHECK (state_version > 0),
  delivery_status text NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending', 'delivered')),
  FOREIGN KEY (event_id, knowledge_id, asset_space_id, state_version)
    REFERENCES knowledge_transition_events (transition_id, knowledge_id, asset_space_id, state_version)
);
