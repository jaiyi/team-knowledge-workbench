-- Internal synthetic authorization contract. No connection is activated by these rows.
CREATE TABLE team_memberships (
  actor_id text NOT NULL,
  team_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'disabled')),
  PRIMARY KEY (actor_id, team_id)
);

CREATE TABLE asset_space_resource_bindings (
  team_id text NOT NULL,
  asset_space_id text NOT NULL,
  git_repository_id text NOT NULL,
  git_protected_ref text NOT NULL CHECK (git_protected_ref = 'refs/heads/main'),
  weknora_space_id text NOT NULL,
  config_version integer NOT NULL CHECK (config_version > 0),
  status text NOT NULL CHECK (status IN ('pending', 'disabled')),
  PRIMARY KEY (team_id, asset_space_id),
  UNIQUE (git_repository_id),
  UNIQUE (weknora_space_id),
  FOREIGN KEY (team_id, asset_space_id) REFERENCES asset_spaces (team_id, asset_space_id)
);
