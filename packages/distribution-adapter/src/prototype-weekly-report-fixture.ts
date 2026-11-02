import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const prototypeWeeklyReportDigest = 'a760966b5e0ebd75006255581871a306c64412d2229db9bab8c6ea25754b13d5';

export function buildPrototypeWeeklyReport(read = () =>
  readFileSync(new URL('../../../docs/产品/可视化原型/index.html', import.meta.url), 'utf8')) {
  const prototype = read();
  const match = /  const knowledgeSample=`([^`]+)`;/.exec(prototype);
  if (!match) throw new Error('prototype weekly report not found');
  const content = match[1]!;
  if (createHash('sha256').update(content).digest('hex') !== prototypeWeeklyReportDigest) {
    throw new Error('prototype weekly report digest mismatch');
  }
  return { content, digest: prototypeWeeklyReportDigest };
}
