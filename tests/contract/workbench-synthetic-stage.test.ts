import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { buildWorkbenchPackageInput } from '../../packages/distribution-adapter/src/workbench-package-fixture.js';
import { buildSyntheticStageSnapshot } from '../../packages/distribution-adapter/src/synthetic-stage-fixture.js';

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
      if (node.tag === tag && (node.props['aria-label'] === label || node.children.includes(label))) return node;
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
    expect(sheet?.props.className).toBe('tkw-sheet');
    expect(sheet?.props.style).not.toHaveProperty('maxWidth');
    const details = sheet?.children.filter((child): child is Element => typeof child !== 'string' && child !== null && child.tag === 'details') ?? [];
    expect(details).toHaveLength(2);
    expect(details.every((element) => element.props.open !== true)).toBe(true);
    expect(details[0]?.children[0]).toMatchObject({ tag: 'summary', children: ['技术信息'] });
    expect(details[1]?.children[0]).toMatchObject({ tag: 'summary', children: ['独立草稿修订实验'] });
    expect(initial).toContain('PRJ-ORION-7');
    expect(initial).toContain('2026-07-15');
    expect(initial).toContain('报价过期');
    expect(initial).toContain('不可送审');
    expect(initial).toContain('质量审计结论缺失');
    expect(initial).toContain('R3 适配试验未完成');
    expect(initial).toContain('来源摘录');
    expect(initial).not.toContain('sourceDigest');
    expect(stage.find('button', '导入来源 · 固定样本只读').props.disabled).not.toBe(true);
    expect(stage.find('button', '事实梳理 · 固定锚点核对').props.disabled).not.toBe(true);
    expect(stage.find('nav', '材料整理路径').children).toHaveLength(5);
    const workspace = sheet?.children.find((child): child is Element => typeof child !== 'string' && child !== null && child.tag === 'div');
    expect(workspace?.props.className).toBe('tkw-workspace');
    const navigation = stage.findTag(workspace ?? '', 'nav');
    expect(navigation?.props['aria-label']).toBe('Workbench 五个并列入口');
    expect(workspace?.children[0]).toBe(navigation);
    expect(navigation?.props.className).toBe('tkw-navigation');
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
    expect(entries[1]?.children[1]).toMatchObject({ tag: 'small', children: ['当前固定样本'] });
    for (const entry of entries.filter((_, index) => index !== 1)) {
      expect(entry.props.disabled).toBe(true);
      expect(entry.props['aria-current']).toBeUndefined();
      expect(entry.children[1]).toMatchObject({ tag: 'small', children: ['尚未接入 · 当前仅开放固定材料样本'] });
      expect(entry.props.onClick).toBeUndefined();
    }
    expect(JSON.stringify(stage.renderPanel())).not.toContain('Workbench 入口状态');
    expect(initial).toContain('WORKBENCH / 提炼知识&经验');
    expect(initial).toContain('从真实过程里提炼可核对的依据');
    expect(initial).toContain('尊重原始语境，把有权使用的过程材料中的事实、判断和适用边界整理成他人能正确使用的依据；不预设必须新建知识。');
    expect(initial).toContain('这里处理来源与待核内容，不是文件上传即入库');
    expect(initial).toContain('固定虚构样本');
    expect(initial).toContain('未导入整份材料');
    expect(initial).not.toContain('从来源看清哪些结论还不能成立');
    expect(stage.sessions.create).not.toHaveBeenCalled();
    expect(stage.requests.mock.calls.every(([path]) => path === 'api/team-knowledge-workbench.health')).toBe(true);
    expect(stage.find('button', '导入来源 · 固定样本只读').props['aria-current']).toBe('step');
    for (const label of ['经验总结 · 未接入', '加入知识库 · 未接入', '优化已有 Skill · 未接入']) {
      expect(stage.find('button', label).props.disabled).toBe(true);
    }
    stage.click('事实梳理 · 固定锚点核对');
    expect(stage.find('button', '事实梳理 · 固定锚点核对').props['aria-current']).toBe('step');
    expect(JSON.stringify(stage.render())).toContain('模拟建立待补证草稿意向');
    stage.click('查看 报价摘要 · 2026-06-18 的来源摘录');
    expect(JSON.stringify(stage.render())).toContain('SRC-QUOTE-03#P1');
    stage.click('事实梳理 · 固定锚点核对');

    stage.click('导入来源 · 固定样本只读');
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
    const initial = JSON.stringify(stage.render());
    expect(initial).toContain('虚构样本');
    expect(initial).toContain('PRJ-ORION-7');
    expect(initial).toContain('quote_expired');
    expect(initial).toContain('2026-07-01');
    expect(initial).toContain('无真实授权');
    expect(initial).toContain('质量审计结论缺失');
    expect(initial).toContain('R3 适配试验未完成');
    expect(initial).toContain('提炼知识&经验');
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
    stage.click('事实梳理 · 固定锚点核对');
    expect(stage.find('button', '提交候选（缺证禁用）').props.disabled).toBe(true);
    expect(stage.sessions.create).not.toHaveBeenCalled();
    expect(stage.requests.mock.calls.every(([path]) => path === 'api/team-knowledge-workbench.health')).toBe(true);
    expect(JSON.stringify(stage.render())).not.toContain('本地待补证草稿意向：1');
    stage.cleanups.forEach((cleanup) => cleanup());
  });

  it('creates one local pending-checks intention only after an explicit click; declines denied scenarios', () => {
    const stage = mountStage();
    stage.click('浏览来源锚点');
    stage.click('取消浏览');
    stage.click('浏览来源锚点');
    stage.click('事实梳理 · 固定锚点核对');
    stage.choose('cross_space');
    stage.click('导入来源 · 固定样本只读');
    expect(stage.find('button', '浏览来源锚点').props.disabled).toBe(true);
    stage.click('事实梳理 · 固定锚点核对');
    expect(stage.find('button', '查看 报价摘要 · 2026-06-18 的来源摘录').props.disabled).toBe(true);
    stage.click('导入来源 · 固定样本只读');
    expect(JSON.stringify(stage.render())).not.toContain('SRC-REQ-01#P3');
    stage.click('事实梳理 · 固定锚点核对');
    expect(stage.find('button', '模拟建立待补证草稿意向').props.disabled).toBe(true);
    (stage.find('button', '模拟建立待补证草稿意向').props.onClick as () => void)();
    expect(JSON.stringify(stage.render())).not.toContain('本地待补证草稿意向：1');
    stage.choose('revoked');
    expect(stage.find('button', '模拟建立待补证草稿意向').props.disabled).toBe(true);
    stage.choose('stale_baseline');
    expect(stage.find('button', '模拟建立待补证草稿意向').props.disabled).toBe(true);
    expect(JSON.stringify(stage.render())).not.toContain('本地待补证草稿意向：1');
    stage.choose('owner');
    stage.click('模拟建立待补证草稿意向');
    stage.click('模拟建立待补证草稿意向');
    const result = JSON.stringify(stage.render());
    expect(result).toContain('本地待补证草稿意向：1');
    expect(result).toContain('pending_checks');
    expect(result).toContain('quote_expired');
    expect(result).not.toContain('cs_1');
    expect(result).not.toContain('draft_1');
    expect(stage.find('button', '提交候选（缺证禁用）').props.disabled).toBe(true);
    stage.choose('revoked');
    expect(JSON.stringify(stage.render())).not.toContain('本地待补证草稿意向：1');
    expect(stage.sessions.create).not.toHaveBeenCalled();
    expect(stage.requests.mock.calls.every(([path]) => path === 'api/team-knowledge-workbench.health')).toBe(true);
    stage.cleanups.forEach((cleanup) => cleanup());
    expect(JSON.stringify(mountStage().render())).not.toContain('本地待补证草稿意向：1');
  });
});
