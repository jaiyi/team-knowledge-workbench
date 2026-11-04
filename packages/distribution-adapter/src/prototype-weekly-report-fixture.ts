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

const factPoints = [
  {
    id: 'shared-kpi', title: '五项 KPI 仅为报告期快照', roles: ['Data'],
    claim: '周报列出五项当期指标及原因；数值均为虚构示例。',
    interpretation: '指标仅反映报告期说法，不构成长期结论。',
    when: '本报告期；后续变化未核', gap: '逐项核统计时点、口径与有权报表。',
    anchors: [
      [1, '采购订单按时交付率 |'], [1, '到料合格率 |'], [1, '成本改善进度 |'],
      [1, '周转天数 |'], [1, '紧急订单占比 |'],
    ],
  },
  {
    id: 'a-test', title: '备选料试验、订单与预计交货', roles: ['Data'],
    claim: '周报将小试、试制订单与预计交货分开叙述。',
    interpretation: '下单不证明实际交付或替代获批。',
    when: '试验与订单为本期自述；交货是下周期预期', gap: '核试验记录、采购订单和实际到货签收。',
    anchors: [[2, '采购组根据当前计划发出试制订单']],
  },
  {
    id: 'packaging-fact', title: '包装协议续签是本次交易进展',
    claim: '周报提及包装协议进入续签流程及需求聚合。',
    interpretation: '流程进展与假设节约不等于合同生效或跨期收益。',
    when: '本报告期交易自述；未来效果未核', gap: '核合同有效期、履约范围与节约口径。',
    anchors: [[2, '另一包装品类的框架协议进入续签流程']],
  },
  {
    id: 'mro-fact', title: 'MRO 采购与当次紧急调拨',
    claim: '周报记录部分 MRO 需求待下单和一次设备抢修紧急调拨。',
    interpretation: '调拨不能证明恢复时长或长期供应能力。',
    when: '本报告期发生说法', gap: '核调拨、设备恢复和停机影响记录。',
    anchors: [[2, '设备抢修遇到一次紧急调拨']],
  },
  {
    id: 'service-fact', title: '服务续约条款草案待核',
    claim: '周报记录服务续签会议交换条款草案。',
    interpretation: '草案和当次折让不是已生效续约或通用价格。',
    when: '本报告期会议自述；续约结果未核', gap: '核合同生效、现行期限和服务范围。',
    anchors: [[2, '服务续签会议已交换条款草案']],
  },
  {
    id: 'shared-srm', title: 'SRM 测试演示与培训不等于已上线', roles: ['Data'],
    claim: '周报记受控测试环境演示和培训，并计划后续上线。',
    interpretation: '演示及培训不证明正式上线或效率收益达成。',
    when: '演示为本期自述；上线和效果仅为计划／预测', gap: '核验收回执、培训结果、正式上线读回。',
    anchors: [[2, 'SRM 模块在受控测试环境完成阶段性验收演示'], [6, '准备 SRM 上线前的配置与培训考核']],
  },
  {
    id: 'supplier-entry', title: '候选供应商评估不等于准入',
    claim: '周报记录材料评估发起及下周期拟安排现场评估。',
    interpretation: '评估发起或计划不等于通过或已准入。',
    when: '本期评估进展自述；现场评估尚未执行', gap: '核材料评估、现场结果、批准决定和权威名录。',
    anchors: [[3, '本期发起两个候选供应商的材料评估'], [6, '对尚未准入的候选方拟安排现场评估']],
  },
  {
    id: 'quality-fact', title: '批次质量异常与隔离待检',
    claim: '周报称一批次抽样异常并隔离待检，后续要求分析。',
    interpretation: '隔离不等于退货；要求分析不等于根因查明。',
    when: '本期特定批次；后续处理未完成', gap: '核检验、隔离、退货、重检与纠正措施回执。',
    anchors: [[3, '一批次出现抽样异常'], [6, '核实质量异常的原因分析']],
  },
  {
    id: 'price-fact', title: '原料价格波动与成本复核',
    claim: '周报提及当期报价变化及采购与财务开展成本复核。',
    interpretation: '已开展复核不代表合同锁价；报价有时效。',
    when: '本期观察与复核；锁价为下周期讨论计划', gap: '核行情来源、成本复核和后续合同状态。',
    anchors: [[5, '采购与财务已展开成本构成复核']],
  },
  {
    id: 'c-risk', title: '预计延误与停线风险',
    claim: '周报预测交付可能延误并安排后续风险回查。',
    interpretation: '预测不是实际停线，回查计划不是已到货。',
    when: '本期预测；后续事件未发生', gap: '核物流节点、实际到货和生产排程。',
    anchors: [[5, '产品线 C 的跨境运输存在交付延误预测'], [6, '按产品线 C 的运输节点回查风险变化']],
  },
] as const;

export function buildPrototypeWeeklyReportFacts(content = buildPrototypeWeeklyReport().content) {
  const lines = content.split('\n');
  const starts = [0, ...lines.flatMap((line, index) => index > 0 && /^##\s/.test(line) ? [index] : [])];
  if (starts.length !== 7) throw new Error('prototype weekly report fact sections mismatch');
  const endOfBody = lines.findIndex((line) => line === '**附录／报表调阅（仅文件名示意，未读取附件）**');
  if (endOfBody < 0) throw new Error('prototype weekly report fact body boundary missing');
  return factPoints.map((point) => ({
    id: point.id, title: point.title, roles: 'roles' in point ? point.roles : [], claim: point.claim, interpretation: point.interpretation,
    when: point.when, gap: point.gap,
    anchors: point.anchors.map(([section, phrase]) => {
      const matches = lines.flatMap((line, index) => line.includes(phrase) ? [index] : []);
      const index = matches[0];
      if (matches.length !== 1 || index === undefined || index < starts[section]! ||
          index >= (starts[section + 1] ?? lines.length) || index >= endOfBody) {
        throw new Error(`prototype weekly report fact anchor mismatch: ${point.id}`);
      }
      return { section, line: index + 1, phrase };
    }),
  }));
}
