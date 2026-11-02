import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const files = [
  'README.md',
  '01-虚构来源资料.md',
  '02-知识修订与项目Wiki.md',
  '03-能力矩阵与Skills.md',
  '04-场景与预期.md',
] as const;

type BaselineFile = typeof files[number];
type Baseline = Record<BaselineFile, string>;

const baseline = Object.fromEntries(files.map((file) => [
  file,
  readFileSync(new URL(`../../docs/工程设计/合成测试基线/${file}`, import.meta.url), 'utf8'),
])) as Baseline;

const anchors = (sources: string) => new Map(
  [...sources.matchAll(/^- `(SRC-[A-Z]+-\d{2}#P\d+)`：([^\n]+)/gm)]
    .map(([, id, text]) => [id, text] as const),
);

const expectedAnchors = [
  'SRC-REQ-01#P1', 'SRC-REQ-01#P2', 'SRC-REQ-01#P3',
  'SRC-QA-02#P1', 'SRC-QA-02#P2', 'SRC-QA-02#P3',
  'SRC-QUOTE-03#P1', 'SRC-QUOTE-03#P2',
  'SRC-CHANGE-04#P1', 'SRC-CHANGE-04#P2', 'SRC-CHANGE-04#P3',
  'SRC-REVIEW-05#P1', 'SRC-REVIEW-05#P2',
];

function checkBaseline(docs: Baseline): string[] {
  const problems: string[] = [];
  const sourceAnchors = anchors(docs['01-虚构来源资料.md']);
  const occurrences = [...docs['01-虚构来源资料.md'].matchAll(/^- `(SRC-[A-Z]+-\d{2}#P\d+)`：/gm)]
    .map((match) => match[1]);
  if (occurrences.length !== expectedAnchors.length
    || expectedAnchors.some((id) => occurrences.filter((found) => found === id).length !== 1)) {
    problems.push('source anchor inventory');
  }
  for (const file of files) {
    if (file === '01-虚构来源资料.md') continue;
    for (const [, source, first, last] of docs[file].matchAll(/(SRC-[A-Z]+-\d{2})#P(\d+)(?:`–`P(\d+))?/g)) {
      if (!source || !first) continue;
      const start = Number(first);
      const end = last ? Number(last) : start;
      if (end < start || end - start > 20) {
        problems.push(`invalid source range: ${source}#P${first}`);
        continue;
      }
      for (let paragraph = start; paragraph <= end; paragraph++) {
        const reference = `${source}#P${paragraph}`;
        if (!sourceAnchors.has(reference)) problems.push(`missing source anchor: ${reference}`);
      }
    }
  }
  const requireText = (file: BaselineFile, text: string, reason: string) => {
    if (!docs[file].includes(text)) problems.push(reason);
  };
  for (const file of files) requireText(file, '2026-07-15', `evaluation date: ${file}`);
  requireText('README.md', 'PRJ-ORION-7', 'project identity');
  requireText('README.md', 'AS-ORION', 'authorized space');
  requireText('README.md', 'AS-VEGA', 'denied space');
  requireText('01-虚构来源资料.md', 'PRJ-ORION-7', 'source project');
  if (!sourceAnchors.get('SRC-REQ-01#P3')?.includes('不是供应商承诺')) problems.push('internal target is not a supplier commitment');
  if (!sourceAnchors.get('SRC-QUOTE-03#P1')?.includes('2026-07-01 当日结束（含当日）')) problems.push('quote expiry');
  if (!sourceAnchors.get('SRC-CHANGE-04#P2')?.includes('适配试验尚未完成')) problems.push('R3 approval gap');
  requireText('02-知识修订与项目Wiki.md', 'v1（模拟旧版）', 'old knowledge version');
  requireText('02-知识修订与项目Wiki.md', 'v2（目标待核修订，非已发布）', 'pending revision is not published');
  requireText('03-能力矩阵与Skills.md', '`ROLE-OTHER`（跨空间）', 'cross-space role');
  requireText('03-能力矩阵与Skills.md', '仅访问 `AS-VEGA` 自有数据', 'cross-space restriction');
  requireText('04-场景与预期.md', '`ROLE-BUYER` 授权', 'authorized extract role');
  requireText('04-场景与预期.md', '`ROLE-OTHER` 在 `AS-VEGA`', 'denied extract role');
  requireText('04-场景与预期.md', '遗漏 `SRC-CHANGE-04#P2`', 'missing-evidence negative case');
  requireText('04-场景与预期.md', '须拒绝且无正文/模型输入泄露', 'deny before disclosure expectation');
  requireText('04-场景与预期.md', '撤销后旧 session、job、回调和扫描都须重新核权', 'revocation expectation');
  requireText('04-场景与预期.md', '本地/fake', 'fixture-only evidence tier');
  return problems;
}

describe('T24 synthetic baseline contract (fixture only)', () => {
  it('keeps a fixed SHA-256 of the five test inputs', () => {
    const digest = createHash('sha256');
    for (const file of files) digest.update(file).update('\0').update(baseline[file]).update('\0');
    expect(digest.digest('hex')).toBe('5d3f913f53878546f381bd9069e77874f6fa93f96974e2204808c813d9856ec2');
  });

  it('resolves every exact source reference and keeps fixed dates, roles, states and evidence gaps', () => {
    expect(checkBaseline(baseline)).toEqual([]);
  });

  it('detects missing anchors and changing a planned delivery into a supplier commitment', () => {
    expect(checkBaseline({ ...baseline, '01-虚构来源资料.md': baseline['01-虚构来源资料.md'].replace('`SRC-CHANGE-04#P2`：', '`SRC-CHANGE-04#P9`：') }))
      .toContain('missing source anchor: SRC-CHANGE-04#P2');
    expect(checkBaseline({ ...baseline, '01-虚构来源资料.md': baseline['01-虚构来源资料.md'].replace('不是供应商承诺', '是供应商承诺') }))
      .toContain('internal target is not a supplier commitment');
    expect(checkBaseline({ ...baseline, '04-场景与预期.md': baseline['04-场景与预期.md'].replace('`SRC-CHANGE-04#P1`–`P2`', '`SRC-CHANGE-04#P1`–`P9`') }))
      .toContain('missing source anchor: SRC-CHANGE-04#P9');
  });

  it('detects expiry, unapproved R3, pending knowledge, and cross-space role drift', () => {
    expect(checkBaseline({ ...baseline, '01-虚构来源资料.md': baseline['01-虚构来源资料.md'].replace('2026-07-01 当日结束（含当日）', '2026-08-01 当日结束（含当日）') }))
      .toContain('quote expiry');
    expect(checkBaseline({ ...baseline, '01-虚构来源资料.md': baseline['01-虚构来源资料.md'].replace('适配试验尚未完成', '适配试验已批准') }))
      .toContain('R3 approval gap');
    expect(checkBaseline({ ...baseline, '02-知识修订与项目Wiki.md': baseline['02-知识修订与项目Wiki.md'].replace('v2（目标待核修订，非已发布）', 'v2（已发布）') }))
      .toContain('pending revision is not published');
    expect(checkBaseline({ ...baseline, '03-能力矩阵与Skills.md': baseline['03-能力矩阵与Skills.md'].replace('仅访问 `AS-VEGA` 自有数据', '访问 `AS-ORION` 数据') }))
      .toContain('cross-space restriction');
  });

  it('detects removal of the unauthorized-space and missing-evidence negative expectations', () => {
    expect(checkBaseline({ ...baseline, '04-场景与预期.md': baseline['04-场景与预期.md'].replace('遗漏 `SRC-CHANGE-04#P2`', '资料都齐全') }))
      .toContain('missing-evidence negative case');
    expect(checkBaseline({ ...baseline, '04-场景与预期.md': baseline['04-场景与预期.md'].replace('须拒绝且无正文/模型输入泄露', '可读取正文') }))
      .toContain('deny before disclosure expectation');
    expect(checkBaseline({ ...baseline, '04-场景与预期.md': baseline['04-场景与预期.md'].replace('撤销后旧 session、job、回调和扫描都须重新核权', '撤销后旧 session 仍可访问') }))
      .toContain('revocation expectation');
  });
});
