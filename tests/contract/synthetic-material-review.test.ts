import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { reviewSyntheticMaterial } from '../../packages/distribution-adapter/src/synthetic-material-review.js';

const material = readFileSync(new URL('../../docs/工程设计/合成测试基线/01-虚构来源资料.md', import.meta.url), 'utf8');
const expectedDigest = 'cb64e758d67558ccb51eeb06d07e898a1a66e43ab0953ea313c9fa40adf2d66f';
const requiredAnchors = [
  'SRC-REQ-01#P1', 'SRC-REQ-01#P2', 'SRC-REQ-01#P3',
  'SRC-QA-02#P1', 'SRC-QA-02#P2', 'SRC-QA-02#P3',
  'SRC-QUOTE-03#P1', 'SRC-QUOTE-03#P2',
  'SRC-CHANGE-04#P1', 'SRC-CHANGE-04#P2', 'SRC-CHANGE-04#P3',
];
const fixture = {
  content: material,
  expectedDigest,
  format: 'fixture-markdown',
  requiredAnchors,
  asOf: '2026-07-15',
};
const digest = (text: string) => createHash('sha256').update(text).digest('hex');

describe('T05 synthetic material gate (fixture only)', () => {
  it('reads each required anchor but fails the fixture check on the expired quote', () => {
    const result = reviewSyntheticMaterial(fixture);
    expect(result.coveredAnchors).toEqual(requiredAnchors);
    expect(result.blockers).toEqual(['quote_expired']);
    expect(result.quoteValidThrough).toBe('2026-07-01');
    expect(result.fixtureCheckPassed).toBe(false);
    expect(material).toContain('`SRC-REQ-01#P3`：采购部内部目标交期为 **2026-08-31**，这是计划日期，不是供应商承诺');
    expect(material).toContain('`SRC-QA-02#P1`：虚构供应商');
    expect(material).toContain('未提供可验证的质量审计结论');
    expect(material).toContain('`SRC-CHANGE-04#P1`：E-17 的项目待核图纸基线改为 `DWG-E17-R3`');
    expect(material).toContain('`SRC-CHANGE-04#P2`：R3 的适配试验尚未完成');
  });

  it('keeps quote expiry inclusive but rejects future source material in the fixture check', () => {
    expect(reviewSyntheticMaterial({ ...fixture, asOf: '2026-07-01' })).toMatchObject({
      quoteValidThrough: '2026-07-01', blockers: ['future_source'], fixtureCheckPassed: false,
    });
    expect(reviewSyntheticMaterial({ ...fixture, asOf: '2026-07-02' }).blockers).toEqual(['future_source', 'quote_expired']);
  });

  it('blocks a missing key paragraph even when the altered text has its own matching digest', () => {
    const incomplete = material.replace(/^\- `SRC-CHANGE-04#P2`：.+\n/m, '');
    expect(incomplete).not.toBe(material);
    expect(reviewSyntheticMaterial({ ...fixture, content: incomplete, expectedDigest: digest(incomplete) })).toMatchObject({
      blockers: ['missing_anchor:SRC-CHANGE-04#P2', 'quote_expired'], fixtureCheckPassed: false,
    });
  });

  it('blocks a missing or unrecognized source date even when the altered text has its own matching digest', () => {
    const undated = material.replace('SRC-QA-02｜虚构质量核验记录，2026-06-12，版本 1',
      'SRC-QA-02｜虚构质量核验记录，日期待确认，版本 1');
    expect(undated).not.toBe(material);
    expect(reviewSyntheticMaterial({ ...fixture, content: undated, expectedDigest: digest(undated) }).blockers)
      .toEqual(['source_date_unknown', 'quote_expired']);

    const wrongSource = material.replace('SRC-CHANGE-04｜工程变更备忘', 'SRC-CHANGE-99｜工程变更备忘');
    expect(wrongSource).not.toBe(material);
    expect(reviewSyntheticMaterial({ ...fixture, content: wrongSource, expectedDigest: digest(wrongSource) }).blockers)
      .toEqual(['source_date_unknown', 'quote_expired']);
  });

  it('blocks truncated or damaged inputs before reporting any anchors as verified', () => {
    const truncated = material.slice(0, material.indexOf('## SRC-CHANGE-04'));
    expect(reviewSyntheticMaterial({ ...fixture, content: truncated })).toEqual({
      coveredAnchors: [], quoteValidThrough: null, blockers: ['content_mismatch'], fixtureCheckPassed: false,
    });
  });

  it('blocks unknown expiry and unsupported formats instead of guessing', () => {
    const unknownExpiry = material.replace('2026-07-01 当日结束（含当日）', '日期待确认');
    expect(reviewSyntheticMaterial({ ...fixture, content: unknownExpiry, expectedDigest: digest(unknownExpiry) })).toMatchObject({
      quoteValidThrough: null, blockers: ['quote_expiry_unknown'], fixtureCheckPassed: false,
    });
    expect(reviewSyntheticMaterial({ ...fixture, format: 'pdf' })).toMatchObject({
      coveredAnchors: [], blockers: ['unsupported_format'], fixtureCheckPassed: false,
    });
    expect(reviewSyntheticMaterial({ ...fixture, asOf: 'not-a-date' })).toMatchObject({
      coveredAnchors: [], blockers: ['unsupported_evaluation_date'], fixtureCheckPassed: false,
    });
    expect(reviewSyntheticMaterial({ ...fixture, asOf: '2026-08-01' })).toMatchObject({
      coveredAnchors: [], blockers: ['unsupported_evaluation_date'], fixtureCheckPassed: false,
    });
  });
});
