import { computeRuntimeIdentityDigest } from './canonical-digest.js';
import { buildSyntheticStageSnapshot } from './synthetic-stage-fixture.js';
import { buildPrototypeWeeklyReport, buildPrototypeWeeklyReportFacts } from './prototype-weekly-report-fixture.js';
import type { LocalPackageBuildInput } from './local-package-builder.js';

const packageIdentity = 'team-knowledge-workbench';
const packageVersion = '0.1.0';

const packageManifest = `{
  "name": "@local/team-knowledge-workbench",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./index.js", "./client": "./client/index.js" },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": ["@deepseek-ai/dsh-api-session-controller", "@deepseek-ai/dsh-client-ui-layout", "@deepseek-ai/dsh-client-ui-sidebar"]
    }
  }
}\n`;

const buildServerEntry = (sourceCommit: string): string => {
  const runtimeIdentityDigest = computeRuntimeIdentityDigest({
    package_identity: packageIdentity,
    package_version: packageVersion,
    source_commit: sourceCommit,
  });
  return `import { apply as workbenchHostApply } from './workbench-host.js';

export const packageIdentity = '${packageIdentity}';
export const packageVersion = '${packageVersion}';
export const inject = ['connection'];
export function apply(ctx, config = {}) {
  const expected = {
    package_identity: packageIdentity,
    package_version: packageVersion,
    source_commit: '${sourceCommit}',
    runtime_identity_digest: '${runtimeIdentityDigest}',
  };
  for (const [key, value] of Object.entries(config)) {
    if (key in expected && value !== expected[key]) {
      throw new Error('DSH host Workbench runtime identity mismatch');
    }
  }
  return workbenchHostApply(ctx, { ...expected, backendEndpoint: config.backendEndpoint });
}
`;
};

const hostEntry = `const digestPattern = /^sha256:[0-9a-f]{64}$/;
const sourceCommitPattern = /^[0-9a-f]{40}$/;

function localHealthUrl(endpoint) {
  if (typeof endpoint !== 'string') return null;
  try {
    const url = new URL(endpoint);
    if (
      url.protocol !== 'http:' || url.hostname !== '127.0.0.1' ||
      !url.port || url.username || url.password || url.search || url.hash ||
      (url.pathname !== '/' && url.pathname !== '') ||
      endpoint !== url.origin && endpoint !== url.origin + '/'
    ) return null;
    return url.origin + '/healthz';
  } catch {
    return null;
  }
}

export function apply(ctx, config) {
  if (
    config === null || typeof config !== 'object' ||
    typeof config.package_identity !== 'string' ||
    typeof config.package_version !== 'string' ||
    typeof config.source_commit !== 'string' ||
    typeof config.runtime_identity_digest !== 'string' ||
    !sourceCommitPattern.test(config.source_commit) ||
    !digestPattern.test(config.runtime_identity_digest)
  ) {
    throw new Error('DSH host must provide the Workbench runtime identity');
  }

  const identity = Object.freeze({
    package_identity: config.package_identity,
    package_version: config.package_version,
    source_commit: config.source_commit,
    runtime_identity_digest: config.runtime_identity_digest,
  });
  let disposed = false;
  const healthUrl = localHealthUrl(config.backendEndpoint);
  const probe = async () => {
    if (disposed) return { status: 'degraded', reference: 'host-disposed' };
    if (config.backendEndpoint === undefined) {
      return { status: 'unknown', reference: 'api-not-configured' };
    }
    if (!healthUrl) return { status: 'unknown', reference: 'api-endpoint-invalid' };
    let response;
    let body;
    try {
      response = await fetch(healthUrl, { signal: AbortSignal.timeout(500), redirect: 'manual' });
      body = await response.text();
    } catch {
      return { status: 'degraded', reference: disposed ? 'host-disposed' : 'api-unavailable' };
    }
    let valid = false;
    if (
      response.status === 200 &&
      response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() === 'application/json' &&
      body.length <= 64
    ) {
      try {
        const parsed = JSON.parse(body);
        valid = parsed !== null && typeof parsed === 'object' &&
          !Array.isArray(parsed) && Object.keys(parsed).length === 1 && parsed.status === 'ok';
      } catch {
        // A malformed response is not a healthy API.
      }
    }
    return disposed ? { status: 'degraded', reference: 'host-disposed' } :
      valid ? { status: 'ok', reference: 'api-health-reachable' } :
      { status: 'degraded', reference: 'api-health-invalid' };
  };
  const connection = Reflect.get(ctx, 'connection');
  if (typeof connection?.fetch?.register !== 'function') {
    throw new Error('DSH host requires Connection fetch service');
  }
  connection.fetch.register({
    path: '/api/team-knowledge-workbench.health',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => new Response(JSON.stringify(await probe()), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    }),
  });
  const registration = Object.freeze({
    kind: 'workbench',
    identity,
    readiness: Object.freeze({ status: 'pending', probe }),
    lifecycle: 'active',
  });
  if (typeof ctx.provide === 'function') ctx.provide('workbenchIdentity', registration);
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      disposed = true;
    }, 'team-knowledge-workbench lifecycle');
  }
}
`;

// Client-only draft review. No Host route or backend write is involved.
const draftReviewClient = `    function completedRevision(snapshot, requestId) {
      if (!snapshot || snapshot.hasMore || !Array.isArray(snapshot.entries)) return null;
      if (snapshot.entries.some((entry) => entry?.type !== 'event')) return null;
      const events = snapshot.entries.map((entry) => entry.event);
      if (events.some((event) => event?.surfaceOp === 'replace')) throw new Error('replaced message');
      const users = events.filter((event) => event?.type === 'user/message' &&
        event.surfaceOp === 'append' && event.data?.source?.kind === 'user' &&
        event.data.source.rpcId === requestId);
      if (users.length > 1) throw new Error('ambiguous user');
      if (users.length !== 1 || !Number.isSafeInteger(users[0].seq)) return null;
      const user = users[0];
      if (events.some((event) => event?.type === 'user/message' && event !== user)) throw new Error('unrelated user');
      const starts = events.filter((event) => event?.type === 'turn/start');
      if (starts.length > 1) throw new Error('ambiguous turn');
      if (starts.length !== 1 || starts[0].seq >= user.seq || !Number.isSafeInteger(starts[0].data?.turn)) return null;
      const turn = starts[0].data.turn;
      const ends = events.filter((event) => event?.type === 'turn/end' && event.data?.turn === turn);
      if (ends.length > 1) throw new Error('ambiguous end');
      if (ends.length !== 1 || ends[0].seq <= user.seq) return null;
      if (ends[0].data?.reason?.kind !== 'completed') throw new Error('turn not completed');
      if (events.some((event) => event?.type === 'assistant/message' && event.seq >= ends[0].seq)) throw new Error('late assistant');
      const inTurn = events.filter((event) => event?.seq > user.seq && event.seq < ends[0].seq);
      if (inTurn.some((event) => event.type === 'user/message' || event.type === 'turn/start' || event.type === 'turn/end' ||
        event.type === 'tool/call' || event.type === 'tool/result')) {
        throw new Error('ambiguous turn');
      }
      const replies = inTurn.filter((event) => event.type === 'assistant/message' &&
        event.surfaceOp === 'append' && event.data?.turn === turn);
      if (replies.length > 1 || events.some((event) => event.type === 'assistant/message' &&
        event.data?.turn === turn && event !== replies[0])) throw new Error('ambiguous assistant');
      if (replies.length !== 1) return null;
      const content = replies[0].data?.message?.content;
      if (!Array.isArray(content) || !content.length || content.some((part) => part?.type !== 'text' || typeof part.text !== 'string')) {
        throw new Error('unsupported assistant content');
      }
      const text = content.map((part) => part.text).join('').trim();
      if (!text || text.length > 20000) throw new Error('invalid draft');
      return text;
    }

    function waitForRevision(binding, requestId, signal) {
      return new Promise((resolve, reject) => {
        const source = binding.eventSource;
        let unsubscribe;
        let settled = false;
        const cleanup = () => {
          settled = true;
          unsubscribe?.();
          signal.removeEventListener('abort', aborted);
        };
        const aborted = () => { cleanup(); reject(new Error('cancelled')); };
        const inspect = () => {
          if (settled) return;
          try {
            if (signal.aborted) return aborted();
            const state = binding.session.getSnapshot();
            if (state.removed || state.openState === 'error' || state.openError || state.lastAgentError || state.promptError) {
              throw new Error('session failed');
            }
            const text = completedRevision(source.getSnapshot(), requestId);
            if (text !== null) { cleanup(); resolve(text); }
          } catch (error) { cleanup(); reject(error); }
        };
        signal.addEventListener('abort', aborted, { once: true });
        unsubscribe = source.subscribe(inspect);
        if (settled) unsubscribe();
        else inspect();
      });
    }

    function DraftReview({ sessions }) {
      const [kind, setKind] = React.useState('事实');
      const [draft, setDraft] = React.useState('');
      const [comment, setComment] = React.useState('');
      const [review, setReview] = React.useState('待审核');
      const [progress, setProgress] = React.useState('');
      const operation = React.useRef(null);
      const mounted = React.useRef(true);
      React.useEffect(() => () => {
        mounted.current = false;
        operation.current?.stop();
      }, []);
      const supported = typeof sessions?.create === 'function' && typeof sessions?.retain === 'function';
      const revise = async () => {
        if (!supported || operation.current || !draft.trim() || !comment.trim() || draft.length > 20000 || comment.length > 2000) return;
        const previous = draft;
        const controller = new AbortController();
        let reference;
        let session;
        let timer;
        let rejectStopped;
        const stopped = new Promise((_, reject) => { rejectStopped = reject; });
        const stop = () => {
          if (controller.signal.aborted) return;
          controller.abort();
          rejectStopped(new Error('cancelled'));
          if (session) Promise.resolve().then(() => session.cancel?.()).catch(() => {});
        };
        const current = { stop };
        operation.current = current;
        setProgress('修订中');
        timer = setTimeout(stop, 30000);
        try {
          const sessionId = await Promise.race([sessions.create(), stopped]);
          if (typeof sessionId !== 'string' || !sessionId) throw new Error('invalid session');
          reference = sessions.retain(sessionId, { source: 'team-knowledge-workbench', signal: controller.signal });
          const binding = await Promise.race([reference.ready, stopped]);
          session = binding.session;
          if (typeof session?.beginSubmission !== 'function' || typeof session?.prompt !== 'function' ||
            typeof session?.cancel !== 'function' || typeof binding.eventSource?.subscribe !== 'function' ||
            typeof binding.eventSource?.getSnapshot !== 'function' || typeof session?.getSnapshot !== 'function') {
            throw new Error('unsupported session');
          }
          const text = '请仅返回修订后的' + kind + '草稿纯文本，不要执行工具、发布或声称已完成审核。\\n当前草稿：\\n' +
            previous + '\\n审核评论：\\n' + comment;
          const submission = session.beginSubmission({ mode: 'queue', text, attachments: [] });
          if (typeof submission?.requestId !== 'string' || !submission.requestId || typeof submission.abandon !== 'function') {
            throw new Error('unsupported submission');
          }
          let result;
          try {
            result = await Promise.race([session.prompt([{ type: 'text', text }], 'queue', controller.signal, submission.requestId), stopped]);
          } catch (error) { submission.abandon(); throw error; }
          if (!result?.ok) { submission.abandon(); throw new Error('prompt rejected'); }
          const revised = await Promise.race([waitForRevision(binding, submission.requestId, controller.signal), stopped]);
          if (mounted.current && operation.current === current && !controller.signal.aborted) {
            setDraft(revised);
            setComment('');
            setReview('待审核');
            setProgress('已生成待审核修订；尚未批准或发布');
          }
        } catch {
          if (mounted.current && operation.current === current) setProgress('修订未确认，保留原草稿');
        } finally {
          clearTimeout(timer);
          controller.abort();
          reference?.release();
          if (operation.current === current) operation.current = null;
        }
      };
      return React.createElement('section', null,
        React.createElement('h2', null, '事实/经验草稿审核'),
        React.createElement('label', null, '类型 ', React.createElement('select', {
          value: kind, disabled: !!operation.current, onChange: (event) => setKind(event.target.value),
        }, React.createElement('option', { value: '事实' }, '事实'), React.createElement('option', { value: '经验' }, '经验'))),
        React.createElement('label', null, '草稿 ', React.createElement('textarea', {
          'aria-label': '草稿', value: draft, disabled: !!operation.current,
          onChange: (event) => { setDraft(event.target.value); setReview('待审核'); },
        })),
        React.createElement('label', null, '审核评论 ', React.createElement('textarea', {
          'aria-label': '审核评论', value: comment, disabled: !!operation.current,
          onChange: (event) => setComment(event.target.value),
        })),
        React.createElement('button', {
          disabled: !supported || !!operation.current || !draft.trim() || !comment.trim() || draft.length > 20000 || comment.length > 2000, onClick: revise,
        }, '按评论修订'),
        React.createElement('button', { disabled: !operation.current, onClick: () => operation.current?.stop() }, '取消修订'),
        React.createElement('button', {
          disabled: !!operation.current || !draft.trim() || review === '已批准（未完成）',
          onClick: () => setReview('已批准（未完成）'),
        }, '批准当前草稿'),
        React.createElement('p', null, '审核：' + review),
        React.createElement('p', null, supported ? progress : 'Session API 不可用，修订已禁用'),
      );
    }
`;

const buildClientEntry = (): string => {
  const syntheticSnapshot = JSON.stringify(buildSyntheticStageSnapshot());
  const prototype = buildPrototypeWeeklyReport();
  const prototypeReport = JSON.stringify(prototype.content);
  const reportFacts = JSON.stringify(buildPrototypeWeeklyReportFacts(prototype.content));
  return `window.__ModuleLoader__.load({
  id: '@local/${packageIdentity}',
  factory: (require) => {
    const module = { exports: {} };
    const React = require('react');
    const panelId = '${packageIdentity}';
    const healthPath = 'api/team-knowledge-workbench.health';
    const syntheticSnapshot = ${syntheticSnapshot};
    const prototypeReport = ${prototypeReport};
    const reportFacts = ${reportFacts};
    const prototypeReportDigest = '${prototype.digest}';
    const reportLines = prototypeReport.split('\\n');
    const reportStarts = [0, ...reportLines.flatMap((line, index) => index > 0 && /^##\\s/.test(line) ? [index] : [])];
    const reportSections = reportStarts.map((start, index) => ({
      start, end: reportStarts[index + 1] ?? reportLines.length,
      title: start === 0 ? '来源信息与标题' : reportLines[start].replace(/^##\\s*/, '').trim(),
      body: reportLines.slice(start, reportStarts[index + 1] ?? reportLines.length).join('\\n'),
    }));

    function reportDocument(body) {
      const lines = body.split('\\n');
      const cells = (line) => line.slice(1, -1).split('|').map((cell) => cell.trim());
      const inline = (text) => text.split(/(\\*\\*[^*\\n]+\\*\\*)/g).map((part, index) =>
        part.startsWith('**') && part.endsWith('**') ? React.createElement('strong', { key: index }, part.slice(2, -2)) : part);
      const nodes = [];
      let index = 0;
      while (index < lines.length) {
        const line = lines[index];
        if (!line.trim()) { index++; continue; }
        if (line === '~~~') {
          nodes.push(React.createElement('pre', { key: index, style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', background: '#edf3ee', padding: 12 } }, line));
          index++;
          continue;
        }
        if (line.startsWith('演示包装尾注：')) {
          nodes.push(React.createElement('p', { key: index, style: { margin: '8px 0', color: '#52615b' } }, line));
          index++;
          continue;
        }
        const heading = /^(#{1,3})\\s+(.+)$/.exec(line);
        if (heading) {
          const tag = 'h' + heading[1].length;
          nodes.push(React.createElement(tag, { key: index, style: { margin: '18px 0 8px' } }, heading[2]));
          index++;
          continue;
        }
        if (line === '---') {
          nodes.push(React.createElement('hr', { key: index, style: { border: 0, borderTop: '1px solid #e4ebe6', margin: '16px 0' } }));
          index++;
          continue;
        }
        if (line.startsWith('|') && lines[index + 1]?.startsWith('|') && cells(line).length > 1 &&
          cells(line).length === cells(lines[index + 1]).length && cells(lines[index + 1]).every((cell) => /^:?-{3,}:?$/.test(cell))) {
          const start = index;
          const columns = cells(line).length;
          const headers = cells(line);
          index += 2;
          const rows = [];
          while (index < lines.length && lines[index].startsWith('|') && cells(lines[index]).length === columns) rows.push(cells(lines[index++]));
          const header = React.createElement('thead', null, React.createElement('tr', null, ...headers.map((cell, column) =>
            React.createElement('th', { key: column, scope: 'col', style: { padding: '8px 11px', borderBottom: '1px solid #e4ebe6', textAlign: 'left' } }, ...inline(cell)))));
          const body = React.createElement('tbody', null, ...rows.map((row, rowIndex) => React.createElement('tr', { key: rowIndex }, ...row.map((cell, column) =>
            React.createElement('td', { key: column, style: { padding: '8px 11px', borderBottom: '1px solid #e4ebe6', textAlign: 'left', maxWidth: 290, whiteSpace: 'normal' } }, ...inline(cell))))));
          nodes.push(React.createElement('div', { key: start, role: 'region', 'aria-label': '来源表格，可横向滚动', tabIndex: 0,
            style: { maxWidth: '100%', overflowX: 'auto', border: '1px solid #e4ebe6', borderRadius: 8, margin: '12px 0' } },
            React.createElement('table', { style: { borderCollapse: 'collapse', minWidth: 'max-content', width: '100%', fontSize: 12 } }, header, body)));
          continue;
        }
        if (line.startsWith('* ')) {
          const start = index;
          const items = [];
          while (index < lines.length && lines[index].startsWith('* ')) items.push(lines[index++].slice(2));
          nodes.push(React.createElement('ul', { key: start }, ...items.map((item, itemIndex) => React.createElement('li', { key: itemIndex }, ...inline(item)))));
          continue;
        }
        const start = index;
        const paragraph = [];
        while (index < lines.length && lines[index].trim() && !/^(?:#{1,3}\\s|---$|~~~$|\\* |\\|)/.test(lines[index])) paragraph.push(lines[index++]);
        if (!paragraph.length) paragraph.push(lines[index++]);
        nodes.push(React.createElement('p', { key: start, style: { margin: '8px 0', whiteSpace: 'pre-wrap' } }, ...inline(paragraph.join('\\n'))));
      }
      return nodes;
    }

    function SyntheticStage() {
      const [step, setStep] = React.useState('source');
      const [material, setMaterial] = React.useState('report');
      const [reportSection, setReportSection] = React.useState(0);
      const [reportFact, setReportFact] = React.useState(null);
      const [reportFeedback, setReportFeedback] = React.useState({});
      const [feedbackKind, setFeedbackKind] = React.useState('');
      const [feedbackText, setFeedbackText] = React.useState('');
      const [scenario, setScenario] = React.useState('owner');
      const [browsing, setBrowsing] = React.useState(false);
      const [source, setSource] = React.useState('SRC-REQ-01');
      const [intention, setIntention] = React.useState(false);
      const allowed = scenario === 'owner';
      const groups = [
        ['SRC-REQ-01', '项目需求纪要 · 2026-06-03'],
        ['SRC-QA-02', '质量核验记录 · 2026-06-12'],
        ['SRC-QUOTE-03', '报价摘要 · 2026-06-18'],
        ['SRC-CHANGE-04', '工程变更备忘 · 2026-07-08'],
      ];
      const card = { background: '#fff', border: '1px solid #e4ebe6', borderRadius: 8, padding: '16px', marginBottom: 14, overflowWrap: 'anywhere' };
      const muted = { color: '#52615b', fontSize: 13, lineHeight: 1.6 };
      const button = { padding: '9px 12px', borderRadius: 6, border: '1px solid #cbd8d0', background: '#fff', color: '#245b43', whiteSpace: 'normal', overflowWrap: 'anywhere' };
      const unavailable = { ...button, background: '#f7f9f6', color: '#687a70' };
      const feedbackKinds = [
        ['correction', '纠正待核理解'], ['locator', '提供证据定位'], ['previous', '旧版理解待核'],
        ['conflict', '认为可能冲突'], ['unsure', '暂无法判断／非本人负责'],
      ];
      const clearFeedbackInput = () => { setFeedbackKind(''); setFeedbackText(''); };
      const openSource = (id) => { if (allowed) { setSource(id); setBrowsing(true); setStep('source'); } };
      const selectMaterial = (next) => {
        setMaterial(next);
        setStep('source');
        setBrowsing(false);
        setSource('SRC-REQ-01');
        setReportSection(0);
        setReportFact(null);
        setReportFeedback({});
        clearFeedbackInput();
        setScenario('owner');
        setIntention(false);
      };
      const reportSectionFacts = reportFacts.filter((fact) => fact.anchors.some((anchor) => anchor.section === reportSection));
      const selectedReportFact = reportSectionFacts.find((fact) => fact.id === reportFact);
      const selectReportSection = (index) => { setReportSection(index); setReportFact(null); clearFeedbackInput(); };
      const selectReportFact = (id) => { setReportFact(id); clearFeedbackInput(); };
      const selectStep = (next) => { setStep(next); setReportFact(null); clearFeedbackInput(); };
      const recordFeedback = () => {
        if (!selectedReportFact || !feedbackKinds.some(([kind]) => kind === feedbackKind) ||
          (feedbackKind !== 'unsure' && !feedbackText.trim())) return;
        setReportFeedback({ ...reportFeedback, [selectedReportFact.id]: { kind: feedbackKind, text: feedbackText.trim() } });
        clearFeedbackInput();
      };
      return React.createElement('section', { style: { color: '#202d29', lineHeight: 1.55 } },
        React.createElement('header', { style: { marginBottom: 17 } },
          React.createElement('h1', { style: { fontSize: 24, lineHeight: 1.35, margin: '0 0 6px', overflowWrap: 'anywhere' } }, '从真实过程里提炼可核对的依据'),
          React.createElement('p', { style: { color: '#42544a', fontSize: 14, margin: 0 } }, '尊重原始语境，把有权使用的过程材料中的事实、判断和适用边界整理成他人能正确使用的依据；不预设必须新建知识。')),
        React.createElement('div', { role: 'group', 'aria-label': '示例材料', style: { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 } },
          React.createElement('button', { type: 'button', style: button, 'aria-pressed': material === 'report', onClick: () => selectMaterial('report') }, '采购协同周报 · 虚构样本'),
          React.createElement('button', { type: 'button', style: button, 'aria-pressed': material === 'orion', onClick: () => selectMaterial('orion') }, 'ORION · 负例样本')),
        material === 'orion' ? React.createElement('div', null,
        React.createElement('p', { style: { ...muted, margin: '0 0 10px' } }, 'PRJ-ORION-7 / AS-ORION · 评测日 2026-07-15'),
        React.createElement('div', { role: 'status', style: { ...card, borderColor: '#e7d9ae', background: '#faf1dd' } },
          React.createElement('strong', { style: { color: '#754d16', fontSize: 17 } }, '报价过期 · 不可送审'),
          React.createElement('p', { style: { margin: '7px 0' } }, 'quote_expired · 报价有效至 ' + syntheticSnapshot.review.quoteValidThrough),
          React.createElement('p', { style: { ...muted, margin: 0 } }, '质量审计结论缺失；R3 适配试验未完成。2026-08-31 是内部目标，非供应商承诺。'))) : null,
        React.createElement('nav', { 'aria-label': '材料整理路径', className: 'tkw-step-navigation', style: { ...card, display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8 } },
          React.createElement('button', { style: { ...button, minWidth: 0, background: step === 'source' ? '#eaf1eb' : '#fff' },
            'aria-current': step === 'source' ? 'step' : undefined, onClick: () => selectStep('source') }, '来源阅读'),
          React.createElement('button', { style: { ...button, minWidth: 0, background: step === 'review' ? '#eaf1eb' : '#fff' },
            'aria-current': step === 'review' ? 'step' : undefined,
            onClick: () => selectStep('review') },
            material === 'report' ? '事实梳理' : '锚点核对'),
          ...['经验总结 · 未开放', '加入知识库 · 未开放', '优化已有 Skill · 未开放'].map((name) =>
            React.createElement('button', { key: name, style: { ...unavailable, minWidth: 0 }, disabled: true }, name))),
        step === 'source' && material === 'report' ? React.createElement('section', { style: card },
          React.createElement('h2', null, '采购协同周报 · 来源全文'),
          React.createElement('p', { style: muted }, '虚构样本 · ' + reportLines.length + ' 行；附件仅列文件名，未读取。'),
          React.createElement('div', { className: 'tkw-source-layout', style: { display: 'grid', gridTemplateColumns: 'minmax(170px, 1fr) minmax(0, 3fr)', gap: 14, minWidth: 0 } },
            React.createElement('nav', { 'aria-label': '材料章节', style: { display: 'grid', alignContent: 'start', gap: 6, maxHeight: 480, overflowY: 'auto', overscrollBehavior: 'contain' } },
              ...reportSections.map((section, index) => React.createElement('button', { key: section.start, type: 'button',
                'aria-pressed': reportSection === index, style: { ...button, textAlign: 'left', background: reportSection === index ? '#eaf1eb' : '#fff' },
                onClick: () => selectReportSection(index) }, section.title,
                React.createElement('small', { style: { display: 'block', color: '#276b48', fontSize: 11 } }, '行 ' + (section.start + 1) + '–' + section.end)))),
            React.createElement('article', { role: 'region', 'aria-label': '周报原文 · ' + reportSections[reportSection].title,
              key: reportSection, tabIndex: 0, style: { minWidth: 0, maxHeight: 480, overflowY: 'auto', overscrollBehavior: 'contain', padding: '20px 23px', background: '#fbfcfa', border: '1px solid #e4ebe6', borderRadius: 8, overflowWrap: 'anywhere', fontSize: 13, lineHeight: 1.75 } },
              ...reportDocument(reportSections[reportSection].body)))) :
        step === 'review' && material === 'report' ? React.createElement('section', { style: card },
          React.createElement('h2', { style: { margin: '0 0 6px' } }, '事实梳理 · 待核'),
          React.createElement('p', { style: { ...muted, margin: '0 0 12px' } }, '人工整理的待核事实；选择条目查看原文及核查缺口。'),
          React.createElement('div', { className: 'tkw-source-layout', style: { display: 'grid', gridTemplateColumns: 'minmax(170px, 1fr) minmax(0, 3fr)', gap: 14, minWidth: 0 } },
            React.createElement('nav', { 'aria-label': '事实梳理 · 材料章节', style: { display: 'grid', alignContent: 'start', gap: 6, maxHeight: 480, overflowY: 'auto', overscrollBehavior: 'contain' } },
              ...reportSections.map((section, index) => React.createElement('button', { key: section.start, type: 'button',
                'aria-pressed': reportSection === index, style: { ...button, textAlign: 'left', background: reportSection === index ? '#eaf1eb' : '#fff' },
                onClick: () => selectReportSection(index) }, section.title,
                React.createElement('small', { style: { display: 'block', color: '#276b48', fontSize: 11 } },
                  '行 ' + (section.start + 1) + '–' + section.end + ' · ' + reportFacts.filter((fact) => fact.anchors.some((anchor) => anchor.section === index)).length + ' 条关联事实')))),
            React.createElement('div', { style: { minWidth: 0 } },
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10 } },
                React.createElement('strong', null, reportSections[reportSection].title + ' · ' + reportSectionFacts.length + ' 条关联事实'),
                React.createElement('button', { type: 'button', style: button, onClick: () => selectStep('source') }, '返回本章来源全文')),
              reportSectionFacts.length ? React.createElement('nav', { 'aria-label': '本章关联的待核事实', style: { display: 'grid', gap: 6 } },
                ...reportSectionFacts.map((fact) => React.createElement('button', { key: fact.id, type: 'button', 'data-fact-id': fact.id,
                  'aria-pressed': reportFact === fact.id, style: { ...button, textAlign: 'left', background: reportFact === fact.id ? '#eaf1eb' : '#fff' },
                  onClick: () => selectReportFact(fact.id) }, '查看待核事实 · ' + fact.title))) :
                React.createElement('p', { role: 'status', style: muted }, '本章没有待核事实。'),
              selectedReportFact ? React.createElement('section', { 'aria-label': '待核事实详情', style: { ...card, background: '#fbfcfa', margin: '10px 0 0', padding: '12px 14px' } },
                React.createElement('h3', { style: { margin: '0 0 8px' } }, selectedReportFact.title + ' · 待核'),
                React.createElement('p', { style: { margin: '4px 0' } }, '时态：' + selectedReportFact.when),
                React.createElement('strong', null, '本章原文'),
                ...selectedReportFact.anchors.filter((anchor) => anchor.section === reportSection).map((anchor) =>
                  React.createElement('p', { key: anchor.line, style: { margin: '5px 0', padding: '7px 10px', background: '#edf3ee', overflowWrap: 'anywhere' } }, '行 ' + anchor.line + ' · ' + reportLines[anchor.line - 1])),
                React.createElement('p', { style: { margin: '6px 0' } }, '来源说法：' + selectedReportFact.claim),
                React.createElement('p', { style: { margin: '6px 0' } }, '待核理解：' + selectedReportFact.interpretation),
                React.createElement('p', { style: { margin: '6px 0' } }, '核查缺口：' + selectedReportFact.gap),
                React.createElement('p', { style: muted }, '以上理解或时态有需要更正的吗？仅填写脱敏说明或证据定位，勿输入真实资料。'),
                React.createElement('label', { style: { display: 'block', marginBottom: 8 } }, '待核意见类型 ',
                  React.createElement('select', { 'aria-label': '待核意见类型', value: feedbackKind,
                    onChange: (event) => setFeedbackKind(event.target.value) },
                    React.createElement('option', { value: '' }, '请选择'),
                    ...feedbackKinds.map(([kind, label]) => React.createElement('option', { key: kind, value: kind }, label)))),
                React.createElement('label', { style: { display: 'block' } }, '待核意见说明（最多 200 字）',
                  React.createElement('textarea', { 'aria-label': '待核意见说明', value: feedbackText, maxLength: 200, rows: 2,
                    onChange: (event) => setFeedbackText(event.target.value.slice(0, 200)),
                    style: { display: 'block', boxSizing: 'border-box', width: '100%', margin: '5px 0 8px' } })),
                React.createElement('button', { type: 'button', style: button, disabled: !feedbackKind || (feedbackKind !== 'unsure' && !feedbackText.trim()),
                  onClick: recordFeedback }, '记录本机待核意见'),
                reportFeedback[selectedReportFact.id] ? React.createElement('section', { 'aria-label': '本机待核意见', role: 'status', style: { marginTop: 10, padding: 10, background: '#faf1dd' } },
                  React.createElement('strong', null, '本机待核意见 · ' + feedbackKinds.find(([kind]) => kind === reportFeedback[selectedReportFact.id].kind)[1]),
                  React.createElement('p', { style: { margin: '4px 0' } }, reportFeedback[selectedReportFact.id].text),
                  React.createElement('small', null, '仅本机暂存，未核实；刷新后消失。')) : null) : null))) :
        step === 'source' ? React.createElement('section', { style: card },
          React.createElement('h2', null, 'ORION · 来源摘录'),
          React.createElement('p', { style: muted }, '4 条记录 · 11 个原文锚点；附件未读取。'),
          React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 } },
            React.createElement('button', { style: button, disabled: !allowed, onClick: () => { if (allowed) setBrowsing(true); } }, '浏览来源锚点'),
            React.createElement('button', { style: button, onClick: () => setBrowsing(false) }, '取消浏览')),
          browsing && allowed ? React.createElement('div', { className: 'tkw-source-layout', style: { display: 'grid', gridTemplateColumns: 'minmax(170px, 1fr) minmax(0, 3fr)', gap: 14, minWidth: 0 } },
            React.createElement('nav', { 'aria-label': '来源章节', style: { display: 'grid', alignContent: 'start', gap: 6, maxHeight: 320, overflowY: 'auto', overscrollBehavior: 'contain' } },
              ...groups.map(([id, title]) => React.createElement('button', { key: id, style: { ...button, textAlign: 'left', background: source === id ? '#eaf1eb' : '#fff' },
                'aria-pressed': source === id, onClick: () => setSource(id) }, title))),
            React.createElement('article', { style: { minWidth: 0, padding: 16, borderRadius: 7, background: '#f7f9f6', maxHeight: 320, overflowY: 'auto', overflowWrap: 'anywhere' } },
              React.createElement('h3', null, source + ' · 固定段落摘录'),
              React.createElement('ul', null, ...syntheticSnapshot.anchors.filter((anchor) => anchor.id.startsWith(source + '#')).map((anchor) =>
                React.createElement('li', { key: anchor.id, style: { marginBottom: 12 } },
                  React.createElement('strong', null, anchor.id), '：' + anchor.text))))) :
            React.createElement('p', { style: muted }, allowed ? '仅查看来源，不建立草稿。' : '当前情境不可查看来源。')) :
          React.createElement('section', { style: card },
            React.createElement('h2', null, '锚点与报价时效'),
            React.createElement('p', { style: muted }, '来源锚点可定位；事实与材料完整性仍待核。'),
            React.createElement('p', null, '锚点覆盖 ' + syntheticSnapshot.review.coveredAnchors.length + '/' + syntheticSnapshot.anchors.length +
              ' · quote_expired · 报价有效至 ' + syntheticSnapshot.review.quoteValidThrough + ' · 不可送审'),
            React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 } },
              ...groups.map(([id, title]) => React.createElement('button', { key: id, style: button, disabled: !allowed,
                onClick: () => openSource(id) }, '查看 ' + title + ' 的来源摘录'))),
            React.createElement('h3', null, '测试情境'),
            React.createElement('p', { style: muted }, '以下权限选择只模拟拒绝结果，不代表实际授权。'),
            React.createElement('label', null, '模拟情境 ', React.createElement('select', {
              'aria-label': '模拟情境', value: scenario, onChange: (event) => {
                setScenario(event.target.value);
                setSource('SRC-REQ-01');
                setBrowsing(false);
                setIntention(false);
              },
            },
              React.createElement('option', { value: 'owner' }, '虚构项目成员'),
              React.createElement('option', { value: 'cross_space' }, '跨空间：拒绝'),
              React.createElement('option', { value: 'revoked' }, '已撤权：拒绝'),
              React.createElement('option', { value: 'stale_baseline' }, '旧基线：拒绝'))),
            React.createElement('p', { style: muted }, allowed ? '可记录本机待补证意向；仍不可提交。' : '当前情境已拒绝；不会创建草稿。'),
            React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 8 } },
              React.createElement('button', { style: button, disabled: !allowed,
                onClick: () => { if (allowed) setIntention(true); } }, '模拟建立待补证草稿意向'),
              React.createElement('button', { style: button, disabled: true }, '提交候选（缺证禁用）')),
            intention && allowed ? React.createElement('p', { role: 'status', style: { ...muted, padding: 12, background: '#faf1dd' } },
              '本机待补证草稿意向：1 · pending_checks · quote_expired · 尚未创建正式草稿') : null)
      );
    }

${draftReviewClient}
    function WorkbenchPanel({ sessions }) {
      const [status, setStatus] = React.useState('未验证');
      React.useEffect(() => {
        let disposed = false;
        let timer;
        let timeout;
        let controller;
        const probe = async () => {
          controller = new AbortController();
          timeout = setTimeout(() => controller.abort(), 1500);
          try {
            const response = await fetch(healthPath, {
              credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
            });
            if (!response.ok || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
              throw new Error('invalid health response');
            }
            const result = await response.json();
            if (disposed) return;
            if (result && Object.keys(result).length === 2 && result.status === 'ok' && result.reference === 'api-health-reachable') {
              setStatus('本机 API 可达（不代表业务就绪）');
            } else if (result && Object.keys(result).length === 2 && result.status === 'degraded' && result.reference === 'api-unavailable') {
              setStatus('本机 API 不可达');
            } else if (result && Object.keys(result).length === 2 && result.status === 'unknown' && result.reference === 'api-not-configured') {
              setStatus('本机 API 未配置');
            } else {
              setStatus('本机 API 无法验证');
            }
          } catch {
            if (!disposed) setStatus('本机 API 无法验证');
          } finally {
            clearTimeout(timeout);
            if (!disposed) timer = setTimeout(probe, 3000);
          }
        };
        probe();
        return () => {
          disposed = true;
          clearTimeout(timer);
          clearTimeout(timeout);
          controller?.abort();
        };
      }, []);
      return React.createElement('main', {
        style: { flex: '1 1 0', minHeight: 0, minWidth: 0, width: '100%', boxSizing: 'border-box', overflowY: 'auto', containerType: 'inline-size', padding: 'var(--dsh-frame-top-clearance, 48px) 12px 12px', background: '#f1f5f2' },
      },
        React.createElement('style', null, [
          '.tkw-workspace { display: grid !important; grid-template-columns: 232px minmax(0, 1fr); }',
          '.tkw-navigation button { width: 100%; font: inherit; font-size: 13px; min-height: 40px; }',
          '.tkw-sheet .tkw-content { min-width: 0; }',
          '@container (max-width: 1000px) {',
          ' .tkw-source-layout { grid-template-columns: minmax(0, 1fr) !important; }',
          ' .tkw-step-navigation { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }',
          ' .tkw-step-navigation button:last-child { grid-column: 1 / -1; }',
          '}',
          '@container (max-width: 760px) {',
          ' .tkw-workspace { grid-template-columns: minmax(0, 1fr); }',
          ' .tkw-navigation { position: static !important; max-height: none !important; overflow-y: visible !important; padding: 14px 12px !important; border-radius: 12px 12px 0 0 !important; }',
          ' .tkw-sheet .tkw-content { padding: 18px 16px !important; }',
          '}',
          '@container (max-width: 420px) {',
          ' .tkw-sheet .tkw-content { padding: 16px 12px !important; }',
          '}',
        ].join('')),
        React.createElement('div', { className: 'tkw-sheet', style: { width: '100%', boxSizing: 'border-box', background: '#fff', border: '1px solid #e4ebe6', borderRadius: 12 } },
          React.createElement('div', { className: 'tkw-workspace', style: { display: 'flex', flexWrap: 'wrap', alignItems: 'stretch' } },
            React.createElement('nav', { 'aria-label': 'Workbench 五个并列入口', className: 'tkw-navigation', style: { flex: '1 1 232px', minWidth: 0, display: 'grid', alignContent: 'start', gap: 3, padding: '20px 12px', background: '#f1f5f2', position: 'sticky', alignSelf: 'start', top: 'var(--dsh-frame-top-clearance, 48px)', maxHeight: 'calc(100dvh - var(--dsh-frame-top-clearance, 48px) - 24px)', overflowY: 'auto', boxSizing: 'border-box', borderRadius: '12px 0 0 0' } },
              React.createElement('div', { style: { padding: '0 12px 12px', overflowWrap: 'anywhere' } },
                React.createElement('strong', { style: { display: 'block', fontSize: 14, lineHeight: 1.4 } }, 'Team Knowledge Workbench'),
                React.createElement('small', { style: { display: 'block', marginTop: 3, color: '#687a70', fontSize: 11 } }, '团队知识复利工作台')),
              ...['我的工作台', '提炼知识&经验', '打磨可复用的技能', '连接业务数据源', '团队业务资产大盘'].map((name, index) =>
                React.createElement('button', {
                  key: name, type: 'button', disabled: index !== 1, 'aria-current': index === 1 ? 'page' : undefined,
                  style: { textAlign: 'left', padding: '10px 12px', borderRadius: 7, border: 0, fontSize: 13,
                    background: index === 1 ? '#dfe8e1' : 'transparent', color: index === 1 ? '#202d29' : '#52615b',
                    fontWeight: index === 1 ? 700 : 400, overflowWrap: 'anywhere' },
                }, name, React.createElement('small', { style: { display: 'block', marginTop: 3, fontWeight: 400, color: '#687a70' } },
                  index === 1 ? '当前入口' : '未开放')))),
            React.createElement('div', { className: 'tkw-content', style: { flex: '4 1 480px', minWidth: 0, padding: 24, boxSizing: 'border-box' } }, React.createElement(SyntheticStage, null))),
          React.createElement('details', { style: { margin: '0 16px 12px', padding: 12, border: '1px solid #e4ebe6', borderRadius: 8 } },
            React.createElement('summary', null, '技术信息'),
            React.createElement('p', null, panelId + ' · v${packageVersion}'),
            React.createElement('p', null, '本机 API 健康：' + status + '；仅代表连接状态，不代表业务就绪。'),
            React.createElement('p', { style: { overflowWrap: 'anywhere' } }, '原型周报文章 SHA-256：' + prototypeReportDigest),
            React.createElement('p', { style: { overflowWrap: 'anywhere' } }, 'ORION 来源摘要 SHA-256：' + syntheticSnapshot.sourceDigest),
            React.createElement('p', { style: { overflowWrap: 'anywhere' } }, 'ORION 五文件基线 SHA-256：' + syntheticSnapshot.baselineDigest),
            React.createElement('p', null, 'fixture_only · external_provider_unavailable')),
          React.createElement('details', { style: { marginTop: 12, padding: 12, border: '1px solid #e4ebe6', borderRadius: 8 } },
            React.createElement('summary', null, '独立草稿修订实验'),
            React.createElement('p', null, '与固定材料样本无关；不会将待补证意向转为真实创作会话。'),
            React.createElement(DraftReview, { sessions }))),
      );
    }

    function WorkbenchIcon({ size }) {
      return React.createElement('span', {
        style: { fontSize: size, fontWeight: 'bold' },
        'aria-hidden': 'true',
      }, 'W');
    }

    module.exports.inject = ['slots', 'sessions'];
    module.exports.apply = (ctx) => {
      const panel = () => WorkbenchPanel({ sessions: ctx.sessions });
      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main', key: panelId,
      }, panel));
      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist', id: panelId, label: 'Team Knowledge Workbench',
      }, WorkbenchIcon));
    };
    return module.exports;
  },
});
`;
};

const buildCordisRegistration = (sourceCommit: string, backendEndpoint?: string): string => {
  const runtimeIdentityDigest = computeRuntimeIdentityDigest({
    package_identity: packageIdentity,
    package_version: packageVersion,
    source_commit: sourceCommit,
  });
  return `# Candidate fixture: verify registration fields against the pinned DSH loader before install.\n- insert:\n    - id: ${packageIdentity}\n      name: '@local/${packageIdentity}'\n      config:\n        package_identity: '${packageIdentity}'\n        package_version: '${packageVersion}'\n        source_commit: '${sourceCommit}'\n        runtime_identity_digest: '${runtimeIdentityDigest}'\n${backendEndpoint === undefined ? '' : `        backendEndpoint: '${backendEndpoint}'\n`}`;
};

export type WorkbenchPackageFixtureInput = Readonly<{
  sourceCommit: string;
  backendEndpoint?: string;
}>;

export const buildWorkbenchPackageInput = (
  input: WorkbenchPackageFixtureInput,
): LocalPackageBuildInput => {
  if (!/^[0-9a-f]{40}$/.test(input.sourceCommit)) {
    throw new Error('source commit must be a 40-character lowercase Git commit');
  }
  if (input.backendEndpoint !== undefined) {
    let url: URL;
    try {
      url = new URL(input.backendEndpoint);
    } catch {
      throw new Error('backend endpoint must be a canonical loopback HTTP origin');
    }
    if (
      url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port ||
      url.username || url.password || url.search || url.hash ||
      (url.pathname !== '/' && url.pathname !== '') ||
      (input.backendEndpoint !== url.origin && input.backendEndpoint !== `${url.origin}/`)
    ) {
      throw new Error('backend endpoint must be a canonical loopback HTTP origin');
    }
  }

  return {
  packageIdentity,
  packageVersion,
  sourceCommit: input.sourceCommit,
  serverEntry: 'index.js',
  clientEntry: 'client/index.js',
  files: [
    { path: 'package.json', content: packageManifest },
    { path: 'index.js', content: buildServerEntry(input.sourceCommit) },
    { path: 'workbench-host.js', content: hostEntry },
    { path: 'client/index.js', content: buildClientEntry() },
    { path: 'cordis.patch.yml', content: buildCordisRegistration(input.sourceCommit, input.backendEndpoint) },
  ],
  };
};
