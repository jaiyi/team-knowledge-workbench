# Contributing

## 工作方式

1. 先在 Issue 或设计文档中明确目标、边界和验收条件；
2. 一个 Pull Request 聚焦一个纵向切片或一个架构决策；
3. 不直接 push 或 merge `main`；
4. 代码、schema 和配置必须通过 CI；
5. provider 状态未知、Webhook 丢失和超时不得报告为成功；
6. 变更必须说明影响的资产版本、profile、运行归因和回滚方式。

## 测试要求

新增行为优先遵循 RED → GREEN → REFACTOR：先写失败测试，再实现最小行为，最后补充集成和 contract test。涉及关键用户流程时补充 e2e 测试。

## 提交前检查

```bash
npm run typecheck
npm test
npm run lint
```
