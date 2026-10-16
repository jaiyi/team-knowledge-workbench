import type {
  Actor,
  EvidenceReference,
  KnowledgeAsset,
  KnowledgeTransitionRecord,
} from '../../contracts/src/index.js';

const cloneEvidence = (evidence: EvidenceReference): EvidenceReference => {
  switch (evidence.kind) {
    case 'source_confirmation':
      return {
        ...evidence,
        claim_ids: [...evidence.claim_ids],
        source_ref_ids: [...evidence.source_ref_ids],
      };
    case 'git_merge':
      return { ...evidence, changed_paths: [...evidence.changed_paths] };
    default:
      return { ...evidence };
  }
};

const cloneActor = (actor: Actor): Actor => ({ ...actor });

export const cloneKnowledge = (knowledge: KnowledgeAsset): KnowledgeAsset => ({
  ...knowledge,
  ...(knowledge.source_commit === undefined ? {} : { source_commit: knowledge.source_commit }),
  sources: knowledge.sources.map((source) => ({ ...source })),
  content: {
    ...knowledge.content,
    claims: knowledge.content.claims.map((claim) => ({
      ...claim,
      source_refs: [...claim.source_refs],
    })),
    applies_to: [...knowledge.content.applies_to],
    not_applies_to: [...knowledge.content.not_applies_to],
    inferences: [...knowledge.content.inferences],
    unknowns: [...knowledge.content.unknowns],
  },
});

export const cloneTransitionRecord = (
  record: KnowledgeTransitionRecord,
): KnowledgeTransitionRecord => ({
  ...record,
  actor: cloneActor(record.actor),
  evidence: record.evidence.map(cloneEvidence),
});

export const freezeKnowledge = (knowledge: KnowledgeAsset): KnowledgeAsset => {
  knowledge.sources.forEach(Object.freeze);
  knowledge.content.claims.forEach((claim) => {
    Object.freeze(claim.source_refs);
    Object.freeze(claim);
  });
  Object.freeze(knowledge.content.claims);
  Object.freeze(knowledge.content.applies_to);
  Object.freeze(knowledge.content.not_applies_to);
  Object.freeze(knowledge.content.inferences);
  Object.freeze(knowledge.content.unknowns);
  Object.freeze(knowledge.content);
  Object.freeze(knowledge.sources);
  return Object.freeze(knowledge);
};

export const freezeTransitionRecord = (
  record: KnowledgeTransitionRecord,
): KnowledgeTransitionRecord => {
  Object.freeze(record.actor);
  record.evidence.forEach((evidence) => {
    if (evidence.kind === 'source_confirmation') {
      Object.freeze(evidence.claim_ids);
      Object.freeze(evidence.source_ref_ids);
    }
    if (evidence.kind === 'git_merge') Object.freeze(evidence.changed_paths);
    Object.freeze(evidence);
  });
  Object.freeze(record.evidence);
  return Object.freeze(record);
};

export const cloneAndFreezeKnowledge = (knowledge: KnowledgeAsset): KnowledgeAsset =>
  freezeKnowledge(cloneKnowledge(knowledge));

export const cloneAndFreezeTransitionRecord = (
  record: KnowledgeTransitionRecord,
): KnowledgeTransitionRecord => freezeTransitionRecord(cloneTransitionRecord(record));
