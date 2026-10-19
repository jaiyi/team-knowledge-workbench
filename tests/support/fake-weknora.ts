import type {
  KnowledgeAsset,
  ProviderOperationStatus,
  ProviderResultEvidence,
  RetrievalSmokeEvidence,
  WeKnoraReadbackEvidence,
} from '../../packages/contracts/src/index.js';

type Request = {
  idempotencyKey: string;
  operationId: string;
  correlationId: string;
  asset: KnowledgeAsset;
};

type Readback = Omit<WeKnoraReadbackEvidence, 'kind' | 'reference' | 'status'>;
type Retrieval = Omit<RetrievalSmokeEvidence, 'kind' | 'reference' | 'status'>;
type Evidence = WeKnoraReadbackEvidence | RetrievalSmokeEvidence | ProviderResultEvidence;
type Operation = {
  request: Request;
  fingerprint: string;
  status: ProviderOperationStatus;
  readback?: Readback;
  retrieval?: Retrieval;
};

export const createFakeWeKnora = () => {
  const operations = new Map<string, Operation>();
  const keys = new Map<string, string>();

  const get = (operationId: string): Operation => {
    const operation = operations.get(operationId);
    if (!operation) throw new Error('Unknown fake operation');
    return operation;
  };
  const summary = (operationId: string) => ({ operation_id: operationId, status: get(operationId).status });
  const matches = (operation: Operation, readback: Readback, retrieval: Retrieval): boolean => {
    const asset = operation.request.asset;
    return readback.operation_id === operation.request.operationId
      && readback.knowledge_id === asset.knowledge_id
      && readback.version === asset.version
      && readback.asset_revision === asset.asset_revision
      && readback.asset_space_id === asset.asset_space_id
      && readback.repo_path === asset.repo_path
      && readback.source_commit === asset.source_commit
      && readback.acl_digest === asset.expected_acl_digest
      && retrieval.operation_id === readback.operation_id
      && retrieval.knowledge_id === asset.knowledge_id
      && retrieval.version === asset.version
      && retrieval.asset_revision === asset.asset_revision;
  };
  const resolve = (operationId: string, readback: Readback, retrieval: Retrieval) => {
    const operation = get(operationId);
    if (operation.status === 'failed') throw new Error('Failed fake operation is terminal');
    if (operation.status === 'succeeded') {
      if (!matches(operation, readback, retrieval)
        || JSON.stringify(operation.readback) !== JSON.stringify(readback)
        || JSON.stringify(operation.retrieval) !== JSON.stringify(retrieval)) {
        throw new Error('Conflicting fake read-back');
      }
      return summary(operationId);
    }
    if (matches(operation, readback, retrieval)) {
      operation.readback = { ...readback };
      operation.retrieval = { ...retrieval };
      operation.status = 'succeeded';
    } else {
      operation.status = 'reconciling';
    }
    return summary(operationId);
  };

  return {
    inspect: (operationId: string) => {
      const operation = operations.get(operationId);
      return operation ? { operation_id: operationId, status: operation.status } : null;
    },
    ingest: (request: Request) => {
      if (request.asset.status !== 'publishing' || !request.asset.source_commit) {
        throw new Error('Fake ingest requires publishing Knowledge');
      }
      const fingerprint = JSON.stringify({
        asset: request.asset, correlationId: request.correlationId, operationId: request.operationId,
      });
      const existing = keys.get(request.idempotencyKey);
      if (existing) {
        if (existing !== request.operationId || get(existing).fingerprint !== fingerprint) {
          throw new Error('Conflicting fake idempotency key');
        }
        return summary(existing);
      }
      if (operations.has(request.operationId)) throw new Error('Fake operation ID already belongs to another request');
      const snapshot: Request = { ...request, asset: structuredClone(request.asset) };
      operations.set(request.operationId, { request: snapshot, fingerprint, status: 'waiting_readback' });
      keys.set(request.idempotencyKey, request.operationId);
      return summary(request.operationId);
    },
    timeout: (operationId: string) => {
      const operation = get(operationId);
      if (operation.status === 'waiting_readback') operation.status = 'unknown';
      else if (operation.status !== 'unknown') throw new Error('Fake operation cannot time out now');
      return summary(operationId);
    },
    fail: (operationId: string) => {
      const operation = get(operationId);
      if (!['waiting_readback', 'unknown', 'reconciling', 'failed'].includes(operation.status)) {
        throw new Error('Fake operation cannot fail now');
      }
      operation.status = 'failed';
      return summary(operationId);
    },
    complete: (operationId: string, readback: Readback, retrieval: Retrieval) => {
      if (!['waiting_readback', 'succeeded'].includes(get(operationId).status)) {
        throw new Error('Fake operation requires reconciliation');
      }
      return resolve(operationId, readback, retrieval);
    },
    reconcile: (operationId: string, readback: Readback, retrieval: Retrieval) => {
      if (!['unknown', 'reconciling'].includes(get(operationId).status)) {
        throw new Error('Fake operation is not awaiting reconciliation');
      }
      return resolve(operationId, readback, retrieval);
    },
    readEvidence: (operationId: string): Evidence[] => {
      const operation = get(operationId);
      if (operation.status === 'succeeded' && operation.readback && operation.retrieval) {
        return [
          { kind: 'weknora_readback', reference: `fake-readback/${operationId}`, status: 'succeeded', ...operation.readback },
          { kind: 'retrieval_smoke', reference: `fake-retrieval/${operationId}`, status: 'succeeded', ...operation.retrieval },
        ];
      }
      if (operation.status === 'failed' || operation.status === 'unknown') {
        return [{
          kind: 'provider_result', reference: `fake-result/${operationId}`, operation_id: operationId,
          status: operation.status, knowledge_id: operation.request.asset.knowledge_id,
          asset_revision: operation.request.asset.asset_revision,
        }];
      }
      return [];
    },
    operationCount: () => operations.size,
  };
};
