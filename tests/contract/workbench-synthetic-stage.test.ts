import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { buildWorkbenchPackageInput } from '../../packages/distribution-adapter/src/workbench-package-fixture.js';
import { buildSyntheticStageSnapshot } from '../../packages/distribution-adapter/src/synthetic-stage-fixture.js';
import { buildPrototypeWeeklyReport, buildPrototypeWeeklyReportFacts, prototypeWeeklyReportDigest } from '../../packages/distribution-adapter/src/prototype-weekly-report-fixture.js';

const sourceCommit = '0123456789abcdef0123456789abcdef01234567';
type Element = { tag: string | ((props: Record<string, unknown>) => Element); props: Record<string, unknown>; children: Array<Element | string> };

function mountStage() {
  const client = buildWorkbenchPackageInput({ sourceCommit }).files.find((file) => file.path === 'client/index.js')?.content ?? '';
  const hooks: unknown[] = [];
  const cleanups: Array<() => void> = [];
  let cursor = 0;
  let main: (() => Element) | undefined;
  const sessions = { create: vi.fn(), retain: vi.fn() };
  const requests = vi.fn();
  const react = {
    createElement: (tag: Element['tag'], props: Record<string, unknown> | null, ...children: Element['children']): Element => (
      { tag, props: props ?? {}, children }
    ),
    useState: (initial: unknown) => {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = initial;
      return [hooks[index], (next: unknown) => { hooks[index] = next; }];
    },
    useRef: (initial: unknown) => {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = { current: initial };
      return hooks[index];
    },
    useEffect: (effect: () => (() => void) | void) => {
      const index = cursor++;
      if (!(index in hooks)) {
        hooks[index] = true;
        const cleanup = effect();
        if (cleanup) cleanups.push(cleanup);
      }
    },
  };
  let module: { apply: (context: unknown) => void } | undefined;
  runInNewContext(client, {
    window: { __ModuleLoader__: { load: ({ factory }: { factory: (require: () => unknown) => typeof module }) => {
      module = factory(() => react);
    } } },
    fetch: requests,
    AbortController,
    TextDecoder,
    TextEncoder,
    setTimeout: () => 1,
    clearTimeout: () => {},
  });
  module?.apply({
    sessions,
    slots: {
      inject: (_name: string, callback: () => void) => callback(),
      register: (options: { name: string }, component: () => Element) => {
        if (options.name === 'main') main = component;
        return () => {};
      },
    },
  });
  const renderPanel = () => {
    cursor = 0;
    const root = main?.();
    if (!root) throw new Error('missing main panel');
    return root;
  };
  const render = () => {
    const root = renderPanel();
    const sheet = root.children.find((child): child is Element => typeof child !== 'string' && child !== null && child.tag === 'div');
    const workspace = sheet?.children.find((child): child is Element => typeof child !== 'string' && child !== null && child.tag === 'div');
    const content = workspace?.children.find((child): child is Element => typeof child !== 'string' && child !== null && child.tag === 'div');
    const stage = content?.children.find((child): child is Element => typeof child !== 'string' && child !== null && typeof child.tag === 'function' && child.tag.name === 'SyntheticStage');
    if (!stage || typeof stage.tag !== 'function') throw new Error('missing synthetic stage');
    return stage.tag(stage.props);
  };
  const find = (tag: string, label: string): Element => {
    const visit = (node: Element | string): Element | undefined => {
      if (node === null || typeof node === 'string') return undefined;
      if (node.tag === tag && (node.props['aria-label'] === label || node.children.some((child) =>
        child === label || (typeof child === 'string' && child.replace(/^[1-5] · /, '') === label)))) return node;
      for (const child of node.children) {
        const match = visit(child);
        if (match) return match;
      }
    };
    const match = visit(render());
    if (!match) throw new Error(`missing ${tag}: ${label}`);
    return match;
  };
  const findTag = (node: Element | string, tag: string): Element | undefined => {
    if (node === null || typeof node === 'string') return undefined;
    if (node.tag === tag) return node;
    for (const child of node.children) {
      const match = findTag(child, tag);
      if (match) return match;
    }
  };
  const click = (label: string) => (find('button', label).props.onClick as () => void)();
  const choose = (value: string) => (find('select', '模拟情境').props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
  return { client, render, renderPanel, find, findTag, click, choose, sessions, requests, cleanups };
}

describe('installed Client synthetic material stage', () => {
  it('presents the limited material path with the prototype hierarchy, not an unlocked knowledge workflow', () => {
    const stage = mountStage();
    const page = stage.renderPanel();
    const sheet = page.children.find((child): child is Element => typeof child !== 'string' && child !== null && child.tag === 'div');
    const initial = JSON.stringify(stage.render());
    expect(page.props.style).toMatchObject({ background: '#f1f5f2', flex: '1 1 0', minHeight: 0, minWidth: 0, boxSizing: 'border-box', overflowY: 'auto' });
    expect(page.props.style).not.toHaveProperty('minHeight', '100vh');
    expect(page.props.style).toHaveProperty('containerType', 'inline-size');
    const localStyle = stage.findTag(page, 'style');
    expect(localStyle?.children[0]).toContain('grid-template-columns: 232px minmax(0, 1fr)');
    expect(localStyle?.children[0]).toContain('@container (max-width: 760px)');
    expect(localStyle?.children[0]).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(localStyle?.children[0]).toContain('.tkw-navigation { position: static !important;');
    expect(localStyle?.children[0]).toContain('.tkw-step-navigation { grid-template-columns: repeat(2, minmax(0, 1fr)) !important;');
    expect(localStyle?.children[0]).toContain('.tkw-step-navigation button:last-child { grid-column: 1 / -1; }');
    expect(localStyle?.children[0]).toContain('.tkw-fact-reading { grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); }');
    expect(localStyle?.children[0]).toContain('.tkw-fact-reading > * { min-width: 0; }');
    expect(localStyle?.children[0]).toContain('@container tkw-review (max-width: 700px) { .tkw-fact-reading { grid-template-columns: minmax(0, 1fr) !important; } }');
    expect(localStyle?.children[0]).toMatch(/@container \(max-width: 1000px\)[^}]*\.tkw-source-layout \{ grid-template-columns: minmax\(0, 1fr\)/);
    expect(sheet?.props.className).toBe('tkw-sheet');
    expect(sheet?.props.style).not.toHaveProperty('overflow', 'hidden');
    expect(sheet?.props.style).not.toHaveProperty('maxWidth');
    const details = sheet?.children.filter((child): child is Element => typeof child !== 'string' && child !== null && child.tag === 'details') ?? [];
    expect(details).toHaveLength(2);
    expect(details.every((element) => element.props.open !== true)).toBe(true);
    expect(details[0]?.children[0]).toMatchObject({ tag: 'summary', children: ['技术信息'] });
    expect(details[1]?.children[0]).toMatchObject({ tag: 'summary', children: ['独立草稿修订实验'] });
    expect(initial).toContain('采购协同周报 · 来源全文');
    expect(initial).not.toContain('PRJ-ORION-7');
    expect(initial).not.toContain('quote_expired');
    expect(stage.find('button', '2 · 事实梳理').props.disabled).not.toBe(true);
    stage.click('2 · 事实梳理');
    expect(JSON.stringify(stage.render())).toContain('本章没有待核事实');
    stage.click('1 · 导入来源');
    const steps = stage.find('nav', '材料整理路径');
    expect(steps.children).toHaveLength(5);
    expect(steps.children.map((entry) => (entry as Element).children[0])).toEqual([
      '1 · 导入来源', '2 · 事实梳理', '3 · 经验总结 · 未开放',
      '4 · 加入知识库 · 未开放', '5 · 优化已有 Skill · 可跳过 · 未开放',
    ]);
    expect(steps.props.className).toBe('tkw-step-navigation');
    expect(steps.props.style).toMatchObject({ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' });
    expect(steps.children).toMatchObject(Array.from({ length: 5 }, () => ({ props: { style: { minWidth: 0 } } })));
    const reportNav = stage.find('nav', '材料章节');
    expect(reportNav.children.map((entry) => (entry as Element).children[0])).toEqual([
      '来源信息与标题', '一、部门本周核心 KPI 概览', '二、本周重点采购工作进展',
      '三、供应商管理与开发', '四、成本控制与降本项目', '五、采购风险预测及应对措施', '六、下周重点工作计划',
    ]);
    expect(reportNav.props.style).toMatchObject({ maxHeight: 480, overflowY: 'auto' });
    expect(stage.findTag(stage.render(), 'article')?.props.style).toMatchObject({ maxHeight: 480, overflowY: 'auto' });
    expect(JSON.stringify(stage.render())).toContain('采购协同周报（完整虚构演示文档）');
    stage.click('四、成本控制与降本项目');
    const costArticle = stage.findTag(stage.render(), 'article');
    const costTable = stage.findTag(costArticle ?? '', 'table');
    expect(costTable?.children.map((entry) => (entry as Element).tag)).toEqual(['thead', 'tbody']);
    expect(JSON.stringify(costTable)).toContain('需求整合');
    expect(JSON.stringify(costTable)).toContain('结构件');
    expect(stage.find('div', '来源表格，可横向滚动').props.style).toHaveProperty('overflowX', 'auto');
    expect(stage.find('button', '四、成本控制与降本项目').props['aria-pressed']).toBe(true);
    stage.click('ORION · 负例样本');
    const orion = JSON.stringify(stage.render());
    expect(orion).toContain('PRJ-ORION-7');
    expect(orion).toContain('2026-07-15');
    expect(orion).toContain('报价过期');
    expect(orion).toContain('不可送审');
    expect(orion).toContain('质量审计结论缺失');
    expect(orion).toContain('R3 适配试验未完成');
    expect(orion).toContain('ORION · 来源摘录');
    expect(orion).not.toContain('sourceDigest');
    expect(stage.find('button', '1 · 导入来源').props.disabled).not.toBe(true);
    expect(stage.find('button', '2 · 锚点核对').props.disabled).not.toBe(true);
    const workspace = sheet?.children.find((child): child is Element => typeof child !== 'string' && child !== null && child.tag === 'div');
    expect(workspace?.props.className).toBe('tkw-workspace');
    const navigation = stage.findTag(workspace ?? '', 'nav');
    expect(navigation?.props['aria-label']).toBe('Workbench 五个并列入口');
    expect(workspace?.children[0]).toBe(navigation);
    expect(navigation?.props.className).toBe('tkw-navigation');
    expect(navigation?.props.style).toMatchObject({ position: 'sticky', alignSelf: 'start', overflowY: 'auto', maxHeight: expect.stringContaining('100') });
    expect(navigation?.children[0]).toMatchObject({ tag: 'div', children: [
      { tag: 'strong', props: {}, children: ['Team Knowledge Workbench'] },
      { tag: 'small', props: {}, children: ['团队知识复利工作台'] },
    ] });
    expect(navigation?.children).toHaveLength(6);
    const entries = navigation?.children.slice(1) as Element[];
    expect(entries.map((entry) => entry.children[0])).toEqual([
      '我的工作台', '提炼知识&经验', '打磨可复用的技能', '连接业务数据源', '团队业务资产大盘',
    ]);
    expect(entries[1]?.props).toMatchObject({ 'aria-current': 'page', disabled: false });
    expect(entries[1]?.children[1]).toMatchObject({ tag: 'small', children: ['当前入口'] });
    for (const entry of entries.filter((_, index) => index !== 1)) {
      expect(entry.props.disabled).toBe(true);
      expect(entry.props['aria-current']).toBeUndefined();
      expect(entry.children[1]).toMatchObject({ tag: 'small', children: ['未开放'] });
      expect(entry.props.onClick).toBeUndefined();
    }
    expect(JSON.stringify(stage.renderPanel())).not.toContain('Workbench 入口状态');
    expect(initial).toContain('从真实过程里提炼可核对的依据');
    expect(initial).toContain('尊重原始语境，把有权使用的过程材料中的事实、判断和适用边界整理成他人能正确使用的依据；不预设必须新建知识。');
    expect(initial).toContain('采购协同周报 · 虚构样本');
    expect(initial).not.toContain('这里处理来源与待核内容');
    expect(initial).not.toContain('仅供排版和来源阅读验收');
    expect(initial).not.toContain('未接入真实材料上传');
    expect(stage.findTag(page, 'style')?.children[0]).toContain('.tkw-source-layout { grid-template-columns: minmax(0, 1fr)');
    expect(stage.sessions.create).not.toHaveBeenCalled();
    expect(stage.requests.mock.calls.every(([path]) => path === 'api/team-knowledge-workbench.health')).toBe(true);
    expect(stage.find('button', '1 · 导入来源').props['aria-current']).toBe('step');
    for (const label of ['3 · 经验总结 · 未开放', '4 · 加入知识库 · 未开放', '5 · 优化已有 Skill · 可跳过 · 未开放']) {
      expect(stage.find('button', label).props.disabled).toBe(true);
    }
    stage.click('2 · 锚点核对');
    expect(stage.find('button', '2 · 锚点核对').props['aria-current']).toBe('step');
    const orionSteps = stage.find('nav', '材料整理路径');
    expect(orionSteps.children.map((entry) => (entry as Element).children[0])).toEqual([
      '1 · 导入来源', '2 · 锚点核对', '3 · 经验总结 · 未开放',
      '4 · 加入知识库 · 未开放', '5 · 优化已有 Skill · 可跳过 · 未开放',
    ]);
    expect(JSON.stringify(stage.render())).toContain('模拟建立待补证草稿意向');
    stage.click('查看 报价摘要 · 2026-06-18 的来源摘录');
    expect(JSON.stringify(stage.render())).toContain('SRC-QUOTE-03#P1');
    stage.click('2 · 锚点核对');

    stage.click('1 · 导入来源');
    expect(JSON.stringify(stage.render())).toContain('浏览来源锚点');
    stage.cleanups.forEach((cleanup) => cleanup());
  });

  it('rejects drift of either the complete T24 sample or its source file at build time', () => {
    const baseline = buildSyntheticStageSnapshot();
    expect(baseline.baselineDigest).toBe('5d3f913f53878546f381bd9069e77874f6fa93f96974e2204808c813d9856ec2');
    expect(baseline.sourceDigest).toBe('cb64e758d67558ccb51eeb06d07e898a1a66e43ab0953ea313c9fa40adf2d66f');
    expect(baseline.review.blockers).toEqual(['quote_expired']);
    expect(baseline.review.fixtureCheckPassed).toBe(false);
    expect(baseline.anchors).toHaveLength(11);
    expect(baseline.anchors.find((entry) => entry.id === 'SRC-REQ-01#P3')?.text).toContain('不是供应商承诺');
    expect(() => buildSyntheticStageSnapshot((file) => {
      const content = readFileSync(new URL(`../../docs/工程设计/合成测试基线/${file}`, import.meta.url), 'utf8');
      return file === '01-虚构来源资料.md' ? content.replace('2026-07-01', '2026-07-30') : content;
    })).toThrow('synthetic source digest mismatch');
    expect(() => buildSyntheticStageSnapshot((file) => {
      const content = readFileSync(new URL(`../../docs/工程设计/合成测试基线/${file}`, import.meta.url), 'utf8');
      return file === '04-场景与预期.md' ? `${content}\n` : content;
    })).toThrow('synthetic baseline digest mismatch');
  });

  it('browses fixed material without starting a session and never treats the expired quote as eligible', () => {
    const stage = mountStage();
    stage.click('ORION · 负例样本');
    const initial = JSON.stringify(stage.render());
    expect(initial).toContain('4 条记录 · 11 个原文锚点');
    expect(initial).toContain('PRJ-ORION-7');
    expect(initial).toContain('quote_expired');
    expect(initial).toContain('2026-07-01');
    expect(initial).toContain('负例样本');
    expect(initial).toContain('质量审计结论缺失');
    expect(initial).toContain('R3 适配试验未完成');
    expect(initial).toContain('从真实过程里提炼可核对的依据');
    expect(JSON.stringify(stage.renderPanel())).toContain('external_provider_unavailable');
    expect(initial).not.toContain('SRC-REQ-01#P3`：');
    stage.click('浏览来源锚点');
    expect(stage.findTag(stage.render(), 'article')?.props.style).toMatchObject({ maxHeight: 320, overflowY: 'auto' });
    expect(JSON.stringify(stage.render())).toContain('SRC-REQ-01#P3');
    expect(JSON.stringify(stage.render())).not.toContain('SRC-QA-02#P1');
    stage.click('取消浏览');
    stage.click('浏览来源锚点');
    (stage.find('button', '报价摘要 · 2026-06-18').props.onClick as () => void)();
    expect(JSON.stringify(stage.render())).toContain('SRC-QUOTE-03#P1');
    expect(JSON.stringify(stage.render())).not.toContain('SRC-REQ-01#P3');
    stage.click('2 · 锚点核对');
    expect(stage.find('button', '提交候选（缺证禁用）').props.disabled).toBe(true);
    expect(stage.sessions.create).not.toHaveBeenCalled();
    expect(stage.requests.mock.calls.every(([path]) => path === 'api/team-knowledge-workbench.health')).toBe(true);
    expect(JSON.stringify(stage.render())).not.toContain('本机待补证草稿意向：1');
    stage.cleanups.forEach((cleanup) => cleanup());
  });

  it('creates one local pending-checks intention only after an explicit click; declines denied scenarios', () => {
    const stage = mountStage();
    stage.click('ORION · 负例样本');
    stage.click('浏览来源锚点');
    stage.click('取消浏览');
    stage.click('浏览来源锚点');
    stage.click('2 · 锚点核对');
    stage.choose('cross_space');
    stage.click('1 · 导入来源');
    expect(stage.find('button', '浏览来源锚点').props.disabled).toBe(true);
    stage.click('2 · 锚点核对');
    expect(stage.find('button', '查看 报价摘要 · 2026-06-18 的来源摘录').props.disabled).toBe(true);
    stage.click('1 · 导入来源');
    expect(JSON.stringify(stage.render())).not.toContain('SRC-REQ-01#P3');
    stage.click('2 · 锚点核对');
    expect(stage.find('button', '模拟建立待补证草稿意向').props.disabled).toBe(true);
    (stage.find('button', '模拟建立待补证草稿意向').props.onClick as () => void)();
    expect(JSON.stringify(stage.render())).not.toContain('本机待补证草稿意向：1');
    stage.choose('revoked');
    expect(stage.find('button', '模拟建立待补证草稿意向').props.disabled).toBe(true);
    stage.choose('stale_baseline');
    expect(stage.find('button', '模拟建立待补证草稿意向').props.disabled).toBe(true);
    expect(JSON.stringify(stage.render())).not.toContain('本机待补证草稿意向：1');
    stage.choose('owner');
    stage.click('模拟建立待补证草稿意向');
    stage.click('模拟建立待补证草稿意向');
    const result = JSON.stringify(stage.render());
    expect(result).toContain('本机待补证草稿意向：1');
    expect(result).toContain('pending_checks');
    expect(result).toContain('quote_expired');
    expect(result).not.toContain('cs_1');
    expect(result).not.toContain('draft_1');
    expect(stage.find('button', '提交候选（缺证禁用）').props.disabled).toBe(true);
    stage.choose('revoked');
    expect(JSON.stringify(stage.render())).not.toContain('本机待补证草稿意向：1');
    expect(stage.sessions.create).not.toHaveBeenCalled();
    expect(stage.requests.mock.calls.every(([path]) => path === 'api/team-knowledge-workbench.health')).toBe(true);
    stage.cleanups.forEach((cleanup) => cleanup());
    expect(JSON.stringify(mountStage().render())).not.toContain('本机待补证草稿意向：1');
  });

  it('navigates the locked weekly report fact index without promoting plans or crossing into ORION', () => {
    const stage = mountStage();
    stage.click('2 · 事实梳理');
    expect(stage.find('nav', '事实梳理 · 材料章节').children).toHaveLength(7);
    expect(stage.find('nav', '事实梳理 · 材料章节').props.style).toMatchObject({ overflowY: 'auto', maxHeight: 480 });
    expect(stage.findTag(stage.render(), 'article')).toBeUndefined();
    expect(JSON.stringify(stage.render())).toContain('本章没有待核事实');
    stage.click('一、部门本周核心 KPI 概览');
    stage.click('查看待核事实 · 五项 KPI 仅为报告期快照');
    const kpiSource = stage.find('div', '本章原文片段');
    expect(kpiSource.children).toHaveLength(1);
    const kpiTable = stage.findTag(kpiSource, 'table');
    expect(kpiTable).toBeDefined();
    const header = kpiTable?.children[0] as Element;
    const body = kpiTable?.children[1] as Element;
    expect(header.tag).toBe('thead');
    expect((header.children[0] as Element).children.map((cell) => (cell as Element).children[0])).toEqual([
      '行号', '指标', '本周实际（虚构）', '本周期目标（虚构）', '状态', '变化', '原因和待核处',
    ]);
    expect(body.tag).toBe('tbody');
    expect(body.children).toHaveLength(5);
    expect(body.children.map((row) => (row as Element).props['data-source-line'])).toEqual([13, 14, 15, 16, 17]);
    expect(JSON.stringify(kpiSource)).toContain('93.7%');
    expect(stage.find('span', '内容角色').children.map((role) => (role as Element).children[0])).toEqual(['Data']);
    const reading = stage.find('div', '事实阅读与已有内容对照');
    expect(stage.client).toContain("className: 'tkw-review-content', style: { minWidth: 0, containerType: 'inline-size', containerName: 'tkw-review' }");
    expect(reading.props.className).toBe('tkw-fact-reading');
    expect((reading.children[0] as Element).props['aria-label']).toBe('待核事实详情');
    const comparison = reading.children[1] as Element;
    expect(comparison).toMatchObject({ tag: 'aside', props: { 'aria-label': '事实已有内容对照' } });
    expect(JSON.stringify(comparison)).toContain('已有内容对照 · 五项 KPI 仅为报告期快照');
    expect(JSON.stringify(comparison)).toContain('仅报告期数值 · 口径未核');
    expect(JSON.stringify(comparison)).toContain('有权报表／真实 Tool 回执未读取');
    expect(JSON.stringify(stage.find('section', '待核事实详情'))).toContain('有权报表');
    stage.click('二、本周重点采购工作进展');
    expect(stage.find('nav', '本章关联的待核事实').children).toHaveLength(5);
    stage.click('查看待核事实 · 包装协议续签是本次交易进展');
    expect(JSON.stringify(stage.find('section', '待核事实详情'))).not.toContain('"aria-label":"内容角色"');
    expect(JSON.stringify(stage.find('aside', '事实已有内容对照'))).toContain('已有内容对照 · 包装协议续签是本次交易进展');
    stage.click('查看待核事实 · 备选料试验、订单与预计交货');
    expect(stage.findTag(stage.render(), 'article')).toBeUndefined();
    expect(JSON.stringify(stage.find('section', '待核事实详情'))).toContain('采购组根据当前计划发出试制订单');
    expect(JSON.stringify(stage.find('section', '待核事实详情'))).toContain('订单成立不表示物料已经交付');
    expect(stage.find('span', '内容角色').children.map((role) => (role as Element).children[0])).toEqual(['Data']);
    expect(JSON.stringify(stage.find('aside', '事实已有内容对照'))).toContain('已有内容对照 · 备选料试验、订单与预计交货');
    expect(JSON.stringify(stage.find('aside', '事实已有内容对照'))).not.toContain('五项 KPI 仅为报告期快照');
    expect(JSON.stringify(stage.find('section', '待核事实详情'))).toContain('下单不证明实际交付');
    stage.click('返回本章来源全文');
    expect(stage.find('article', '周报原文 · 二、本周重点采购工作进展').props.style).toMatchObject({ overflowY: 'auto', maxHeight: 480 });
    stage.click('2 · 事实梳理');
    stage.click('查看待核事实 · SRM 测试演示与培训不等于已上线');
    const srm = JSON.stringify(stage.find('section', '待核事实详情'));
    expect(srm).toContain('受控测试环境');
    expect(stage.find('span', '内容角色').children.map((role) => (role as Element).children[0])).toEqual(['Data']);
    expect(JSON.stringify(stage.find('aside', '事实已有内容对照'))).toContain('已有内容对照 · SRM 测试演示与培训不等于已上线');
    expect(srm).not.toContain('准备 SRM 上线前的配置');
    stage.click('三、供应商管理与开发');
    stage.click('查看待核事实 · 批次质量异常与隔离待检');
    const fallback = JSON.stringify(stage.find('aside', '事实已有内容对照'));
    expect(fallback).toContain('已有内容对照 · 批次质量异常与隔离待检');
    expect(fallback).toContain('无法判断 · 未查询真实库');
    expect(fallback).toContain('没有可核的资产 ID／版本；未检索不等于没有。');
    expect(JSON.stringify(stage.find('section', '待核事实详情'))).toContain('根因查明');
    stage.click('五、采购风险预测及应对措施');
    stage.click('查看待核事实 · 预计延误与停线风险');
    expect(JSON.stringify(stage.find('section', '待核事实详情'))).toContain('预测不是实际停线');
    stage.click('六、下周重点工作计划');
    expect(JSON.stringify(stage.render())).not.toContain('待核事实详情');
    expect(stage.find('button', '查看待核事实 · SRM 测试演示与培训不等于已上线').props['data-fact-id']).toBe('shared-srm');
    stage.click('查看待核事实 · SRM 测试演示与培训不等于已上线');
    const nextWeek = JSON.stringify(stage.find('section', '待核事实详情'));
    expect(nextWeek).toContain('准备 SRM 上线前的配置');
    expect(nextWeek).not.toContain('SRM 模块在受控测试环境');
    expect(nextWeek).not.toContain('演示包装尾注');
    expect(stage.find('span', '内容角色').children.map((role) => (role as Element).children[0])).toEqual(['Data']);
    expect(JSON.stringify(stage.find('aside', '事实已有内容对照'))).toContain('已有内容对照 · SRM 测试演示与培训不等于已上线');
    expect(stage.find('button', '查看待核事实 · 预计延误与停线风险').props['data-fact-id']).toBe('c-risk');
    expect(JSON.stringify(stage.render())).not.toContain('quote_expired');
    expect(JSON.stringify(stage.render())).not.toContain('SRC-REQ-01#P3');
    expect(JSON.stringify(stage.render())).not.toContain('提交候选');
    stage.click('1 · 导入来源');
    expect(stage.find('button', '六、下周重点工作计划').props['aria-pressed']).toBe(true);
    stage.click('2 · 事实梳理');
    expect(JSON.stringify(stage.render())).not.toContain('待核事实详情');
    stage.click('ORION · 负例样本');
    expect(stage.find('button', '2 · 锚点核对').props.disabled).not.toBe(true);
    expect(JSON.stringify(stage.render())).toContain('quote_expired');
    stage.click('采购协同周报 · 虚构样本');
    stage.click('2 · 事实梳理');
    expect(stage.find('button', '来源信息与标题').props['aria-pressed']).toBe(true);
    expect(JSON.stringify(stage.render())).not.toContain('quote_expired');
    expect(stage.sessions.create).not.toHaveBeenCalled();
    expect(stage.requests.mock.calls.every(([path]) => path === 'api/team-knowledge-workbench.health')).toBe(true);
    stage.cleanups.forEach((cleanup) => cleanup());
  });

  it('records only local pending feedback for a selected fact and clears unrecorded or cross-material input', () => {
    const stage = mountStage();
    const update = (tag: string, label: string, value: string) =>
      (stage.find(tag, label).props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
    stage.click('2 · 事实梳理');
    stage.click('二、本周重点采购工作进展');
    stage.click('查看待核事实 · SRM 测试演示与培训不等于已上线');
    expect(stage.find('button', '记录本机待核意见').props.disabled).toBe(true);
    expect(stage.find('textarea', '待核意见说明').props.maxLength).toBe(200);
    expect(stage.find('select', '待核意见类型').children.slice(1)).toMatchObject([
      { props: { value: 'correction' }, children: ['纠正待核理解'] },
      { props: { value: 'locator' }, children: ['提供证据定位'] },
      { props: { value: 'previous' }, children: ['旧版理解待核'] },
      { props: { value: 'conflict' }, children: ['认为可能冲突'] },
      { props: { value: 'unsure' }, children: ['暂无法判断／非本人负责'] },
    ]);
    update('select', '待核意见类型', 'locator');
    update('textarea', '待核意见说明', ' '.repeat(201));
    expect(stage.find('button', '记录本机待核意见').props.disabled).toBe(true);
    update('textarea', '待核意见说明', 'x'.repeat(201));
    expect(stage.find('textarea', '待核意见说明').props.value).toHaveLength(200);
    update('textarea', '待核意见说明', '虚构记录编号 SRM-TEST-01');
    expect(stage.find('button', '记录本机待核意见').props.disabled).toBe(false);
    stage.click('查看待核事实 · 备选料试验、订单与预计交货');
    expect(stage.find('select', '待核意见类型').props.value).toBe('');
    expect(stage.find('textarea', '待核意见说明').props.value).toBe('');
    stage.click('查看待核事实 · SRM 测试演示与培训不等于已上线');
    update('select', '待核意见类型', 'locator');
    update('textarea', '待核意见说明', '虚构记录编号 SRM-TEST-01');
    stage.click('记录本机待核意见');
    const receipt = JSON.stringify(stage.find('section', '本机待核意见'));
    expect(receipt).toContain('虚构记录编号 SRM-TEST-01');
    expect(receipt).toContain('仅本机暂存，未核实');
    stage.click('六、下周重点工作计划');
    expect(JSON.stringify(stage.render())).not.toContain('虚构记录编号 SRM-TEST-01');
    stage.click('查看待核事实 · SRM 测试演示与培训不等于已上线');
    expect(JSON.stringify(stage.find('section', '本机待核意见'))).toContain('虚构记录编号 SRM-TEST-01');
    update('select', '待核意见类型', 'correction');
    update('textarea', '待核意见说明', '未记录的待核更正');
    stage.click('1 · 导入来源');
    stage.click('2 · 事实梳理');
    stage.click('查看待核事实 · SRM 测试演示与培训不等于已上线');
    expect(stage.find('textarea', '待核意见说明').props.value).toBe('');
    expect(JSON.stringify(stage.find('section', '本机待核意见'))).toContain('虚构记录编号 SRM-TEST-01');
    stage.click('ORION · 负例样本');
    expect(JSON.stringify(stage.render())).not.toContain('虚构记录编号 SRM-TEST-01');
    stage.click('采购协同周报 · 虚构样本');
    stage.click('2 · 事实梳理');
    stage.click('六、下周重点工作计划');
    stage.click('查看待核事实 · SRM 测试演示与培训不等于已上线');
    expect(JSON.stringify(stage.render())).not.toContain('虚构记录编号 SRM-TEST-01');
    update('select', '待核意见类型', 'unsure');
    expect(stage.find('button', '记录本机待核意见').props.disabled).toBe(false);
    stage.click('记录本机待核意见');
    expect(JSON.stringify(stage.find('section', '本机待核意见'))).toContain('暂无法判断');
    expect(stage.sessions.create).not.toHaveBeenCalled();
    expect(stage.requests.mock.calls.every(([path]) => path === 'api/team-knowledge-workbench.health')).toBe(true);
    stage.cleanups.forEach((cleanup) => cleanup());
  });

  it('places the material chooser below the numbered path and loads pasted UTF-8 text only on explicit action', () => {
    const stage = mountStage();
    const children = stage.render().children.filter((child): child is Element => typeof child !== 'string' && child !== null);
    const pathIndex = children.findIndex((child) => child.tag === 'nav' && child.props['aria-label'] === '材料整理路径');
    expect(pathIndex).toBeGreaterThanOrEqual(0);
    expect(children[pathIndex + 1]).toMatchObject({ tag: 'section', props: { 'aria-label': '导入一份完整材料' } });
    stage.click('粘贴文字');
    const edit = (value: string) => (stage.find('textarea', '材料文字').props.onChange as
      (event: { target: { value: string } }) => void)({ target: { value } });
    edit('# 虚构来源\n\n预测未核实');
    expect(stage.findTag(stage.render(), 'article')).toBeUndefined();
    stage.click('载入粘贴文字');
    const article = stage.find('article', '粘贴原文 · 来源信息与标题');
    expect(JSON.stringify(article)).toContain('预测未核实');
    expect(JSON.stringify(article)).not.toContain('"tag":"textarea"');
    edit('# 虚构来源\n\n后续草稿不是已载入正文');
    expect(JSON.stringify(stage.find('article', '粘贴原文 · 来源信息与标题'))).toContain('预测未核实');
    expect(JSON.stringify(stage.find('article', '粘贴原文 · 来源信息与标题'))).not.toContain('后续草稿不是已载入正文');
    edit('测'.repeat(Math.floor(200 * 1024 / 3) + 1));
    stage.click('载入粘贴文字');
    expect(JSON.stringify(stage.render())).toContain('文字超过 200 KiB');
    expect(JSON.stringify(stage.find('article', '粘贴原文 · 来源信息与标题'))).toContain('预测未核实');
    expect(JSON.stringify(stage.find('article', '粘贴原文 · 来源信息与标题'))).not.toContain('后续草稿不是已载入正文');
    edit('无效\0文字');
    stage.click('载入粘贴文字');
    expect(JSON.stringify(stage.render())).toContain('文字包含 NUL');
    expect(JSON.stringify(stage.find('article', '粘贴原文 · 来源信息与标题'))).toContain('预测未核实');
    edit('   ');
    stage.click('载入粘贴文字');
    expect(JSON.stringify(stage.render())).toContain('文字为空');
    edit('## 新章节\n已确认载入的虚构内容');
    stage.click('载入粘贴文字');
    expect(JSON.stringify(stage.find('article', '粘贴原文 · 来源信息与标题'))).toContain('已确认载入的虚构内容');
    expect(JSON.stringify(stage.render())).not.toContain('文字为空');
    stage.click('采购协同周报 · 虚构样本');
    stage.click('粘贴文字');
    expect(stage.findTag(stage.render(), 'article')).toBeUndefined();
    expect(stage.find('textarea', '材料文字').props.value).toBe('');
    expect(stage.sessions.create).not.toHaveBeenCalled();
    expect(stage.requests.mock.calls.every(([path]) => path === 'api/team-knowledge-workbench.health')).toBe(true);
    stage.cleanups.forEach((cleanup) => cleanup());
  });

  it('reads the selected K10 Markdown without loading linked originals or creating a session', async () => {
    const stage = mountStage();
    const content = readFileSync(new URL('../../docs/产品/演示素材/虚构半导体采购/知识/10-需求与订单版本对照.md', import.meta.url), 'utf8');
    stage.click('本地演练 Markdown');
    expect(JSON.stringify(stage.render())).not.toContain('K10｜需求与订单版本对照');
    const input = stage.find('input', '选择本地 Markdown');
    const target = { files: [{ name: '10-需求与订单版本对照.md', size: Buffer.byteLength(content), arrayBuffer: async () => Buffer.from(content) }], value: 'C:\\fakepath\\10-需求与订单版本对照.md' };
    await (input.props.onChange as (event: { target: typeof target }) => Promise<void>)({ target });
    expect(target.value).toBe('');
    const nav = stage.find('nav', '材料章节');
    expect(nav.children.length).toBeGreaterThan(10);
    expect((nav.children[0] as Element).children[0]).toBe('来源信息与标题');
    expect((nav.children.at(-1) as Element).children[1]).toMatchObject({ children: ['行 365–380'] });
    expect(JSON.stringify(stage.render())).toContain('K10｜需求与订单版本对照');
    expect(stage.findTag(stage.render(), 'blockquote')).toBeDefined();
    stage.click('使用范围和事实层级');
    const early = JSON.stringify(stage.find('article', '本地原文 · 使用范围和事实层级'));
    expect(stage.findTag(stage.render(), 'code')).toBeDefined();
    expect(early).toContain('PX-A');
    expect(early).toContain('2026-11-13');
    expect(early).toContain('客户提出；未见接受或订单修改回执');
    expect(stage.findTag(stage.render(), 'table')?.children.map((entry) => (entry as Element).tag)).toEqual(['thead', 'tbody']);
    expect(stage.find('div', '来源表格，可横向滚动').props.style).toHaveProperty('overflowX', 'auto');
    expect(early).not.toContain('"tag":"a"');
    expect(early).toContain('引用未打开');
    stage.click('原件权限与摘要来源');
    expect(JSON.stringify(stage.render())).toContain('K07');
    expect(JSON.stringify(stage.render())).not.toContain('"tag":"a"');
    stage.click('请求、评估、承接、对外沟通：分开的状态轴');
    expect(stage.findTag(stage.render(), 'ol')).toBeDefined();
    stage.click('核对清单与后续记录（未执行）');
    expect(JSON.stringify(stage.render())).toContain('无已接受的 11/13 交期');
    expect(JSON.stringify(stage.render())).not.toContain('行 381');
    expect(stage.find('button', '事实梳理 · 未提供').props.disabled).toBe(true);
    expect(stage.sessions.create).not.toHaveBeenCalled();
    expect(stage.requests.mock.calls.every(([path]) => path === 'api/team-knowledge-workbench.health')).toBe(true);
    stage.click('采购协同周报 · 虚构样本');
    expect(JSON.stringify(stage.render())).not.toContain('K10｜需求与订单版本对照');
    stage.click('本地演练 Markdown');
    expect(JSON.stringify(stage.render())).not.toContain('K10｜需求与订单版本对照');
    stage.cleanups.forEach((cleanup) => cleanup());
  });

  it('rejects invalid local files and ignores a stale read after changing samples', async () => {
    const stage = mountStage();
    stage.click('本地演练 Markdown');
    const select = async (file: { name: string; size: number; arrayBuffer: () => Promise<Uint8Array> }) =>
      (stage.find('input', '选择本地 Markdown').props.onChange as (event: { target: { files: unknown[]; value: string } }) => Promise<void>)({ target: { files: [file], value: file.name } });
    await select({ name: 'big.md', size: 200 * 1024 + 1, arrayBuffer: async () => { throw new Error('should not read'); } });
    expect(JSON.stringify(stage.render())).toContain('文件超过 200 KiB');
    await select({ name: 'invalid.md', size: 2, arrayBuffer: async () => Uint8Array.from([0xc3, 0x28]) });
    expect(JSON.stringify(stage.render())).toContain('不是有效的 UTF-8');
    await select({ name: 'null.md', size: 3, arrayBuffer: async () => Buffer.from('a\0b') });
    expect(JSON.stringify(stage.render())).toContain('包含 NUL');
    await select({ name: 'empty.md', size: 0, arrayBuffer: async () => Buffer.alloc(0) });
    expect(JSON.stringify(stage.render())).toContain('文件为空');
    await select({ name: 'failed.md', size: 3, arrayBuffer: async () => { throw new Error('read failed'); } });
    expect(JSON.stringify(stage.render())).toContain('文件读取失败');
    await select({ name: 'misreported.md', size: 1, arrayBuffer: async () => Buffer.alloc(200 * 1024 + 1) });
    expect(JSON.stringify(stage.render())).toContain('文件超过 200 KiB');
    await select({ name: 'wrong.txt', size: 3, arrayBuffer: async () => Buffer.from('abc') });
    expect(JSON.stringify(stage.render())).toContain('只支持 .md 文件');
    let finish: (bytes: Uint8Array) => void = () => {};
    const pending = select({ name: 'old.md', size: 5, arrayBuffer: () => new Promise((resolve) => { finish = resolve; }) });
    await select({ name: 'new.md', size: 5, arrayBuffer: async () => Buffer.from('# new') });
    finish(Buffer.from('# old'));
    await pending;
    expect(JSON.stringify(stage.render())).toContain('new.md · 1 行');
    expect(JSON.stringify(stage.render())).not.toContain('old.md');
    stage.click('采购协同周报 · 虚构样本');
    stage.click('本地演练 Markdown');
    const switching = select({ name: 'stale.md', size: 7, arrayBuffer: () => new Promise((resolve) => { finish = resolve; }) });
    stage.click('采购协同周报 · 虚构样本');
    finish(Buffer.from('# stale'));
    await switching;
    stage.click('本地演练 Markdown');
    expect(JSON.stringify(stage.render())).not.toContain('stale.md');
    expect(stage.sessions.create).not.toHaveBeenCalled();
    expect(stage.requests.mock.calls.every(([path]) => path === 'api/team-knowledge-workbench.health')).toBe(true);
    stage.cleanups.forEach((cleanup) => cleanup());
  });

  it('refuses missing, duplicated or misplaced fact anchors in the prototype article', () => {
    const content = buildPrototypeWeeklyReport().content;
    const facts = buildPrototypeWeeklyReportFacts(content);
    expect(facts.map((fact) => fact.id)).toEqual(['shared-kpi', 'a-test', 'packaging-fact', 'mro-fact', 'service-fact', 'shared-srm', 'supplier-entry', 'quality-fact', 'price-fact', 'c-risk']);
    expect(facts.filter((fact) => (fact.roles as readonly string[]).includes('Data')).map((fact) => fact.id)).toEqual(['shared-kpi', 'a-test', 'shared-srm']);
    for (const fact of facts) for (const anchor of fact.anchors) {
      expect(content.split('\n').filter((line) => line.includes(anchor.phrase))).toHaveLength(1);
      expect(content.split('\n')[anchor.line - 1]).toContain(anchor.phrase);
    }
    expect(() => buildPrototypeWeeklyReportFacts(content.replace('采购订单按时交付率 |', '采购订单延迟率 |'))).toThrow('fact anchor mismatch: shared-kpi');
    expect(() => buildPrototypeWeeklyReportFacts(content.replace('eof', '采购订单按时交付率 |\neof'))).toThrow('fact anchor mismatch: shared-kpi');
    expect(() => buildPrototypeWeeklyReportFacts(content.replace('采购订单按时交付率 |', '按时交付率 |') + '\n采购订单按时交付率 |')).toThrow('fact anchor mismatch: shared-kpi');
  });

  it('locks the complete prototype article without altering the ORION negative baseline', () => {
    const prototype = readFileSync(new URL('../../docs/产品/可视化原型/index.html', import.meta.url), 'utf8');
    const original = /  const knowledgeSample=`([^`]+)`;/.exec(prototype)?.[1];
    const report = buildPrototypeWeeklyReport();
    expect(report.digest).toBe(prototypeWeeklyReportDigest);
    expect(report.content).toBe(original);
    expect(report.content.split('\n')).toHaveLength(111);
    expect(() => buildPrototypeWeeklyReport(() => prototype.replace('93.7%', '96.7%'))).toThrow('prototype weekly report digest mismatch');
    const stage = mountStage();
    expect(stage.client).toContain(JSON.stringify(report.content));
    expect(JSON.stringify(stage.renderPanel())).toContain(`原型周报文章 SHA-256：${prototypeWeeklyReportDigest}`);
    expect(JSON.stringify(stage.renderPanel())).toContain('ORION 五文件基线 SHA-256：');
    const starts = report.content.split('\n').flatMap((line, index) => index > 0 && /^##\s/.test(line) ? [index] : []);
    const boundaries = [0, ...starts, report.content.split('\n').length];
    const navigation = stage.find('nav', '材料章节');
    expect(navigation.children.map((entry) => (entry as Element).children[1])).toEqual(
      boundaries.slice(0, -1).map((start, index) => expect.objectContaining({ children: [`行 ${start + 1}–${boundaries[index + 1]}`] })),
    );
    stage.click('一、部门本周核心 KPI 概览');
    const kpi = stage.findTag(stage.render(), 'article');
    expect(stage.findTag(kpi ?? '', 'table')?.children.map((entry) => (entry as Element).tag)).toEqual(['thead', 'tbody']);
    expect(JSON.stringify(kpi)).toContain('93.7%');
    stage.click('六、下周重点工作计划');
    expect(JSON.stringify(stage.render())).toContain('演示包装尾注：不是周报正文');
    expect(JSON.stringify(stage.render())).toContain('未读取附件');
    expect(stage.find('button', '2 · 事实梳理').props.disabled).not.toBe(true);
    stage.click('2 · 事实梳理');
    expect(stage.find('button', '2 · 事实梳理').props['aria-current']).toBe('step');
    expect(JSON.stringify(stage.render())).not.toContain('quote_expired');
    stage.click('1 · 导入来源');
    stage.click('ORION · 负例样本');
    expect(JSON.stringify(stage.render())).toContain('quote_expired');
    expect(JSON.stringify(stage.render())).not.toContain('准备 SRM 上线前的配置');
    stage.click('浏览来源锚点');
    expect(stage.find('nav', '来源章节').props.style).toMatchObject({ display: 'grid', overflowY: 'auto' });
    stage.click('2 · 锚点核对');
    stage.click('模拟建立待补证草稿意向');
    expect(JSON.stringify(stage.render())).toContain('本机待补证草稿意向：1');
    stage.click('采购协同周报 · 虚构样本');
    expect(JSON.stringify(stage.render())).not.toContain('quote_expired');
    expect(JSON.stringify(stage.render())).not.toContain('本机待补证草稿意向：1');
    expect(stage.find('button', '1 · 导入来源').props['aria-current']).toBe('step');
    expect(stage.find('button', '来源信息与标题').props['aria-pressed']).toBe(true);
    stage.click('ORION · 负例样本');
    expect(JSON.stringify(stage.render())).not.toContain('本机待补证草稿意向：1');
    expect(JSON.stringify(stage.render())).not.toContain('SRC-REQ-01#P3');
    expect(stage.find('button', '1 · 导入来源').props['aria-current']).toBe('step');
    expect(stage.sessions.create).not.toHaveBeenCalled();
    expect(stage.requests.mock.calls.every(([path]) => path === 'api/team-knowledge-workbench.health')).toBe(true);
    stage.cleanups.forEach((cleanup) => cleanup());
  });
});
