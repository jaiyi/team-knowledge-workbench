import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import type { createDurableFakeOperation } from '../../apps/api/src/application/durable-fake-operation.js';

type Command = Parameters<ReturnType<typeof createDurableFakeOperation>['enqueue']>[0];
type Evidence = { operationId: string; assetSpaceId: string; knowledgeId: string;
  assetRevision: number; digest: string };

export const createPersistentSyntheticTarget = (directory: string) => {
  const db = new DatabaseSync(join(directory, 'accepted.sqlite'));
  db.exec(`CREATE TABLE IF NOT EXISTS accepted_operations (
    operation_id text PRIMARY KEY, command text NOT NULL, evidence text, submit_count integer NOT NULL
  )`);
  return {
    async inspect(id: string): Promise<Command | null> {
      const row = db.prepare('SELECT command FROM accepted_operations WHERE operation_id = ?')
        .get(id) as { command: string } | undefined;
      return row ? JSON.parse(row.command) as Command : null;
    },
    async submit(command: Command): Promise<void> {
      const prior = db.prepare('SELECT command FROM accepted_operations WHERE operation_id = ?')
        .get(command.operationId) as { command: string } | undefined;
      if (prior && prior.command !== JSON.stringify(command)) throw new Error('Conflicting synthetic target operation');
      db.prepare(`INSERT INTO accepted_operations (operation_id, command, evidence, submit_count)
        VALUES (?, ?, NULL, 1) ON CONFLICT (operation_id) DO UPDATE
        SET submit_count = submit_count + 1`).run(command.operationId, JSON.stringify(command));
    },
    async readback(id: string): Promise<Evidence | null> {
      const row = db.prepare('SELECT evidence FROM accepted_operations WHERE operation_id = ?')
        .get(id) as { evidence: string | null } | undefined;
      return row?.evidence ? JSON.parse(row.evidence) as Evidence : null;
    },
    complete(id: string, evidence: Evidence): void {
      const result = db.prepare('UPDATE accepted_operations SET evidence = ? WHERE operation_id = ?')
        .run(JSON.stringify(evidence), id);
      if (result.changes !== 1) throw new Error('Missing synthetic target operation');
    },
    submitCount(id: string): number {
      const row = db.prepare('SELECT submit_count FROM accepted_operations WHERE operation_id = ?')
        .get(id) as { submit_count: number } | undefined;
      return row?.submit_count ?? 0;
    },
    close(): void { db.close(); },
  };
};
