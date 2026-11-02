import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { reviewSyntheticMaterial } from './synthetic-material-review.js';

const files = [
  'README.md', '01-虚构来源资料.md', '02-知识修订与项目Wiki.md',
  '03-能力矩阵与Skills.md', '04-场景与预期.md',
] as const;
type BaselineFile = typeof files[number];
const baselineDigest = '5d3f913f53878546f381bd9069e77874f6fa93f96974e2204808c813d9856ec2';
const sourceDigest = 'cb64e758d67558ccb51eeb06d07e898a1a66e43ab0953ea313c9fa40adf2d66f';
const requiredAnchors = [
  'SRC-REQ-01#P1', 'SRC-REQ-01#P2', 'SRC-REQ-01#P3',
  'SRC-QA-02#P1', 'SRC-QA-02#P2', 'SRC-QA-02#P3',
  'SRC-QUOTE-03#P1', 'SRC-QUOTE-03#P2',
  'SRC-CHANGE-04#P1', 'SRC-CHANGE-04#P2', 'SRC-CHANGE-04#P3',
] as const;

export function buildSyntheticStageSnapshot(read: (file: BaselineFile) => string = (file) =>
  readFileSync(new URL(`../../../docs/工程设计/合成测试基线/${file}`, import.meta.url), 'utf8')) {
  const contents = files.map((file) => [file, read(file)] as const);
  const source = contents[1]![1];
  if (createHash('sha256').update(source).digest('hex') !== sourceDigest) {
    throw new Error('synthetic source digest mismatch');
  }
  const digest = createHash('sha256');
  for (const [file, content] of contents) digest.update(file).update('\0').update(content).update('\0');
  if (digest.digest('hex') !== baselineDigest) throw new Error('synthetic baseline digest mismatch');

  const review = reviewSyntheticMaterial({
    content: source, expectedDigest: sourceDigest, format: 'fixture-markdown',
    requiredAnchors, asOf: '2026-07-15',
  });
  const lines = new Map([...source.matchAll(/^- `(SRC-[A-Z]+-\d{2}#P\d+)`：([^\n]+)/gm)]
    .map(([, id, text]) => [id, text] as const));
  return {
    baselineDigest, sourceDigest, review,
    anchors: requiredAnchors.map((id) => ({ id, text: lines.get(id) ?? '' })),
  };
}
