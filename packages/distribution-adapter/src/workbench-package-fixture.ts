import { computeRuntimeIdentityDigest } from './canonical-digest.js';
import { buildSyntheticStageSnapshot } from './synthetic-stage-fixture.js';
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
  return `window.__ModuleLoader__.load({
  id: '@local/${packageIdentity}',
  factory: (require) => {
    const module = { exports: {} };
    const React = require('react');
    const panelId = '${packageIdentity}';
    const healthPath = 'api/team-knowledge-workbench.health';
    const syntheticSnapshot = ${syntheticSnapshot};

    function SyntheticStage() {
      const [scenario, setScenario] = React.useState('owner');
      const [browsing, setBrowsing] = React.useState(false);
      const [intention, setIntention] = React.useState(false);
      const entries = ['我的工作台', '提炼知识&经验', '打磨可复用的技能', '连接业务数据源', '团队业务资产大盘'];
      const allowed = scenario === 'owner';
      return React.createElement('section', null,
        React.createElement('h2', null, '虚构样本 · 材料核证与创作边界'),
        React.createElement('p', null, 'PRJ-ORION-7 / AS-ORION · 2026-07-15 · 本机模拟，无真实授权'),
        React.createElement('p', null, '材料：' + syntheticSnapshot.review.blockers.join(', ') +
          '；报价有效至 ' + syntheticSnapshot.review.quoteValidThrough + '；不可送审'),
        React.createElement('p', null, '质量审计结论缺失；R3 适配试验未完成；2026-08-31 是内部采购目标，不是供应商承诺'),
        React.createElement('p', null, '来源摘要 SHA-256：' + syntheticSnapshot.sourceDigest),
        React.createElement('p', null, '五文件基线 SHA-256：' + syntheticSnapshot.baselineDigest),
        React.createElement('ul', null, ...entries.map((name, index) =>
          React.createElement('li', { key: name }, name + ' · fixture_only' +
            (index === 0 ? '' : ' · external_provider_unavailable')))),
        React.createElement('button', { disabled: !allowed, onClick: () => { if (allowed) setBrowsing(true); } }, '浏览来源锚点'),
        React.createElement('button', { onClick: () => setBrowsing(false) }, '取消浏览'),
        browsing && allowed ? React.createElement('ul', null, ...syntheticSnapshot.anchors.map((anchor) =>
          React.createElement('li', { key: anchor.id }, anchor.id + '：' + anchor.text))) : null,
        React.createElement('label', null, '模拟情境 ', React.createElement('select', {
          'aria-label': '模拟情境', value: scenario, onChange: (event) => {
            setScenario(event.target.value);
            setBrowsing(false);
            setIntention(false);
          },
        },
          React.createElement('option', { value: 'owner' }, '虚构项目成员'),
          React.createElement('option', { value: 'cross_space' }, '跨空间：拒绝'),
          React.createElement('option', { value: 'revoked' }, '已撤权：拒绝'),
          React.createElement('option', { value: 'stale_baseline' }, '旧基线：拒绝'))),
        React.createElement('p', null, allowed ? '仅可模拟待补证草稿，不能提交候选' : '模拟请求已拒绝：无草稿副作用'),
        React.createElement('button', {
          disabled: !allowed, onClick: () => { if (allowed) setIntention(true); },
        }, '模拟建立待补证草稿意向'),
        intention ? React.createElement('p', null, '本地待补证草稿意向：1 · pending_checks · quote_expired · 非真实会话/草稿') : null,
        React.createElement('button', { disabled: true }, '提交候选（缺证禁用）'),
        React.createElement('p', null, '本区域不会调用 DSH Session；下方事实/经验草稿审核是独立功能。')
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
        style: { padding: 'var(--dsh-frame-top-clearance, 48px) 24px 24px' },
      },
        React.createElement('h1', null, panelId),
        React.createElement('p', null, 'v${packageVersion}'),
        React.createElement('p', null, '状态：' + status),
        React.createElement(SyntheticStage, null),
        React.createElement(DraftReview, { sessions }),
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
