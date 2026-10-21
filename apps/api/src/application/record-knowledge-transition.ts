import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { AuthenticatedPrincipal, KnowledgeAsset, KnowledgeStatus } from '../../../../packages/contracts/src/index.js';
import type { KnowledgeEvidenceVerifier } from '../../../../packages/contracts/src/evidence.js';
import { knowledgeAssetSchema, knowledgeTransitionCommandSchema } from '../../../../packages/validation/src/index.js';
import { applyKnowledgeTransition } from './knowledge-transition.js';

type Database = Pick<Pool, 'connect'>;
type StateRow = {
  knowledge_id: string;
  team_id: string;
  asset_space_id: string;
  status: KnowledgeStatus;
  state_version: number;
  asset_revision: number;
  asset_digest: string;
};
type EventRow = {
  transition_id: string;
  idempotency_key: string;
  command_digest: string;
  knowledge_id: string;
  team_id: string;
  asset_space_id: string;
  actor_id: string;
  state_version: number;
  outbox_event_id: string | null;
};

type Result =
  | Readonly<{ ok: true; transitionId: string; stateVersion: number; replayed: boolean }>
  | Readonly<{ ok: false; kind: 'validation' | 'authorization' | 'evidence' | 'domain' | 'conflict' | 'database'; message: string }>;

const requiredRoles: Partial<Record<KnowledgeStatus, readonly AuthenticatedPrincipal['roles'][number][]>> = {
  candidate: ['owner', 'steward'],
  reviewing: ['reviewer'],
  approved: ['reviewer'],
  publishing: ['publisher'],
  published: ['publisher'],
  index_failed: ['publisher'],
  index_unknown: ['publisher'],
  manual_required: ['publisher'],
  stale: ['owner', 'steward'],
  deprecated: ['owner', 'steward'],
  rejected: ['reviewer'],
};

const digestOf = (value: unknown): string =>
  `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;

const assetDigest = (asset: KnowledgeAsset): string => digestOf(asset);

export const recordKnowledgeTransition = async (
  database: Database,
  principal: AuthenticatedPrincipal | null,
  rawKnowledge: unknown,
  rawCommand: unknown,
  evidenceVerifier: KnowledgeEvidenceVerifier,
): Promise<Result> => {
  if (!principal || principal.actor.actor_type !== 'human') {
    return { ok: false, kind: 'authorization', message: 'Authenticated principal required' };
  }
  const knowledgeResult = knowledgeAssetSchema.safeParse(rawKnowledge);
  const commandResult = knowledgeTransitionCommandSchema.safeParse(rawCommand);
  if (!knowledgeResult.success || !commandResult.success) {
    return { ok: false, kind: 'validation', message: 'Invalid Knowledge transition input' };
  }
  const knowledge = knowledgeResult.data;
  const command = commandResult.data;
  if (principal.actor.actor_id !== command.actor.actor_id || principal.actor.actor_type !== command.actor.actor_type) {
    return { ok: false, kind: 'authorization', message: 'Command actor does not match authenticated actor' };
  }
  const digest = digestOf([knowledge, command]);
  let client: PoolClient;
  try {
    client = await database.connect();
  } catch {
    return { ok: false, kind: 'database', message: 'Knowledge transition could not be recorded' };
  }
  try {
    await client.query('BEGIN');
    const stateResult = await client.query<StateRow>(
      'SELECT * FROM knowledge_states WHERE knowledge_id = $1 FOR UPDATE', [knowledge.knowledge_id],
    );
    const state = stateResult.rows[0];
    if (!state || state.team_id !== knowledge.team_id || state.asset_space_id !== knowledge.asset_space_id
      || command.asset_space_id !== state.asset_space_id) {
      await client.query('ROLLBACK');
      return { ok: false, kind: 'authorization', message: 'Not authorized for Knowledge transition' };
    }
    const allowedRoles = requiredRoles[command.to] ?? [];
    const claimedRoles = allowedRoles.filter((role) => principal.roles.includes(role));
    if (!principal.team_ids.includes(state.team_id) || !principal.asset_space_ids.includes(state.asset_space_id)
      || claimedRoles.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, kind: 'authorization', message: 'Not authorized for Knowledge transition' };
    }
    const bindingResult = await client.query(
      `SELECT role FROM knowledge_role_bindings
       WHERE actor_id = $1 AND team_id = $2 AND asset_space_id = $3 AND role = ANY($4::text[])
       FOR SHARE`, [principal.actor.actor_id, state.team_id, state.asset_space_id, claimedRoles],
    );
    if (bindingResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return { ok: false, kind: 'authorization', message: 'Not authorized for Knowledge transition' };
    }

    const priorResult = await client.query<EventRow>(
      `SELECT e.*, o.event_id AS outbox_event_id FROM knowledge_transition_events e
       LEFT JOIN knowledge_outbox o ON o.event_id = e.transition_id
       WHERE e.transition_id = $1 OR e.idempotency_key = $2`, [command.transition_id, command.idempotency_key],
    );
    if (priorResult.rows.length) {
      const prior = priorResult.rows[0]!;
      await client.query('ROLLBACK');
      if (priorResult.rows.length !== 1 || prior.transition_id !== command.transition_id
        || prior.idempotency_key !== command.idempotency_key || prior.command_digest !== digest
        || prior.knowledge_id !== state.knowledge_id || prior.team_id !== state.team_id
        || prior.asset_space_id !== state.asset_space_id || prior.actor_id !== principal.actor.actor_id
        || prior.outbox_event_id !== prior.transition_id) {
        return { ok: false, kind: 'conflict', message: 'Conflicting Knowledge transition' };
      }
      return { ok: true, transitionId: prior.transition_id, stateVersion: prior.state_version, replayed: true };
    }
    if (state.status !== knowledge.status || state.state_version !== knowledge.state_version
      || state.asset_revision !== knowledge.asset_revision || state.asset_digest !== assetDigest(knowledge)) {
      await client.query('ROLLBACK');
      return { ok: false, kind: 'conflict', message: 'Knowledge state has changed' };
    }
    const applied = applyKnowledgeTransition(knowledge, command, principal, {
      authorize: () => ({ ok: true, actor: principal.actor }),
    }, evidenceVerifier);
    if (!applied.ok) {
      await client.query('ROLLBACK');
      return applied;
    }
    const updated = await client.query(
      `UPDATE knowledge_states SET status = $1, state_version = $2, asset_digest = $7
       WHERE knowledge_id = $3 AND state_version = $4 AND asset_revision = $5 AND status = $6`,
      [applied.knowledge.status, applied.knowledge.state_version, state.knowledge_id,
        state.state_version, state.asset_revision, state.status, assetDigest(applied.knowledge)],
    );
    if (updated.rowCount !== 1) {
      await client.query('ROLLBACK');
      return { ok: false, kind: 'conflict', message: 'Knowledge state has changed' };
    }
    await client.query(
      `INSERT INTO knowledge_transition_events
       (transition_id, idempotency_key, command_digest, correlation_id, knowledge_id,
        team_id, asset_space_id, actor_id, from_status, to_status, state_version, asset_revision)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [command.transition_id, command.idempotency_key, digest, command.correlation_id,
        state.knowledge_id, state.team_id, state.asset_space_id, principal.actor.actor_id,
        state.status, applied.knowledge.status, applied.knowledge.state_version, state.asset_revision],
    );
    await client.query(
      `INSERT INTO knowledge_outbox (event_id, knowledge_id, asset_space_id, state_version)
       VALUES ($1, $2, $3, $4)`,
      [command.transition_id, state.knowledge_id, state.asset_space_id, applied.knowledge.state_version],
    );
    await client.query('COMMIT');
    return { ok: true, transitionId: command.transition_id,
      stateVersion: applied.knowledge.state_version, replayed: false };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* Preserve the original failure boundary. */ }
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
      && 'constraint' in error && (error.constraint === 'knowledge_transition_events_pkey'
        || error.constraint === 'knowledge_transition_events_idempotency_key_key')) {
      return { ok: false, kind: 'conflict', message: 'Conflicting Knowledge transition' };
    }
    return { ok: false, kind: 'database', message: 'Knowledge transition could not be recorded' };
  } finally {
    client.release();
  }
};
