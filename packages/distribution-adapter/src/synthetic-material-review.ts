import { createHash } from 'node:crypto';

type ReviewInput = {
  content: string;
  expectedDigest: string;
  format: string;
  requiredAnchors: readonly string[];
  asOf: string;
};

type ReviewResult = {
  coveredAnchors: string[];
  quoteValidThrough: string | null;
  blockers: string[];
  fixtureCheckPassed: boolean;
};

const blocked = (reason: string): ReviewResult => ({
  coveredAnchors: [], quoteValidThrough: null, blockers: [reason], fixtureCheckPassed: false,
});

export function reviewSyntheticMaterial(input: ReviewInput): ReviewResult {
  if (input.format !== 'fixture-markdown') return blocked('unsupported_format');
  if (input.asOf !== '2026-07-15' && input.asOf !== '2026-07-01' && input.asOf !== '2026-07-02') {
    return blocked('unsupported_evaluation_date');
  }
  if (createHash('sha256').update(input.content).digest('hex') !== input.expectedDigest) {
    return blocked('content_mismatch');
  }

  const lines = new Map([...input.content.matchAll(/^- `(SRC-[A-Z]+-\d{2}#P\d+)`：([^\n]+)/gm)]
    .map(([, anchor, text]) => [anchor, text] as const));
  const coveredAnchors = input.requiredAnchors.filter((anchor) => lines.has(anchor));
  const blockers = input.requiredAnchors.filter((anchor) => !lines.has(anchor))
    .map((anchor) => `missing_anchor:${anchor}`);

  const datedSources = [...input.content.matchAll(/^## (SRC-[A-Z]+-\d{2})｜[^\n]+，([^，\n]+)，版本/gm)];
  const expectedSources = ['SRC-REQ-01', 'SRC-QA-02', 'SRC-QUOTE-03', 'SRC-CHANGE-04', 'SRC-REVIEW-05'];
  const sourceDates = new Map(datedSources.map(([, source, date]) => [source, date]));
  const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date)
    && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
  if (datedSources.some(([, , date]) => validDate(date!) && date! > input.asOf)) blockers.push('future_source');
  if (datedSources.length !== expectedSources.length || expectedSources.some((source) => !sourceDates.has(source))
    || datedSources.some(([, , date]) => !validDate(date!))) blockers.push('source_date_unknown');

  const quote = lines.get('SRC-QUOTE-03#P1') ?? '';
  const quoteValidThrough = quote.match(/报价有效至 \*\*(\d{4}-\d{2}-\d{2}) 当日结束（含当日）\*\*/)?.[1] ?? null;
  if (!quoteValidThrough) blockers.push('quote_expiry_unknown');
  else if (input.asOf > quoteValidThrough) blockers.push('quote_expired');

  return { coveredAnchors, quoteValidThrough, blockers, fixtureCheckPassed: blockers.length === 0 };
}
