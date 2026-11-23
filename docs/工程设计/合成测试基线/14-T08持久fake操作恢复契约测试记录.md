# T08 持久 fake 操作：恢复和调和缺口测试记录

> 本子项无 UI；原型不包含真实持久 Worker／Provider 回执，视觉和宿主点击不适用。已有 SQLite、PGlite 与 fake WeKnora 测试继续独立保留；本次只补 `tests/integration/fake-operation-recovery.test.ts` 缺口，不声称真实 PG／Worker／Provider 恢复。

## 范围与预期（开工登记）

- 源码基点：`1fe8a0195e47a17f8de75d5037d5cc6ad115fe0a`。使用该测试内固定虚构 `knowledge.fixture`、`op-1`、`key-1`、revision 1、合成 digest/commit，另有可控 SQLite 临时库与内存 fake provider；原型 `index.html` SHA-256 `b3a399682402f8eede4d3321dc9b8723fb1077589829c49ae7146be27b8b445d`，无对应持久操作页面，不把其本机状态作验收输入。
- 执行人：本地开发执行；独立复核人、平台／安全 owner、获准真实目标待指定。只用脱敏合成输入，不接生产凭据。
- 已有基线：`tests/support/fake-durable-operation.ts` 的事务 event／operation、持久请求、lease/version CAS、跨进程 SQLite 恢复；`tests/support/fake-weknora.ts` 的同键幂等、读回匹配／不符；现有 integration 的 timeout/unknown/reconciling。不得把 `knowledge_outbox` 的 transition delivery intent 当已连接 Worker outbox。
- 预期新增：provider 已接受但响应丢失且 worker 退出、未保存等待状态时，重开 SQLite 查持久的原请求／原键；查到则不重发，未查到才重发原请求，两者 provider 操作数均为 1。重复／乱序／过期 lease、错误 operation/key/knowledge/revision 或不匹配 provider 身份不得推进；回调不能指定 `succeeded`，只有 fake provider 读回与检索证据匹配持久请求才成功；mismatch 留 `reconciling`，超时保留 `unknown`，重复回调不能推进新 version。若假成功、重复外部副作用或拒绝失效，停测修复。

## 执行结果（2026-11-04，本机 Node v24.22.0 / Vitest 5.0.4）

- 先加响应丢失双路径和伪造／过期回调测试：`npm test -- tests/integration/fake-operation-recovery.test.ts` 首次退出码 1，24 项中 1 失败，旧 `markReconciled` 把 callback 对象误作目标状态，SQLite 报 `Unknown named parameter 'operationId'`；改为从 provider inspect/readEvidence 推导后，一度 2 项失败（原有 metadata-only 测试未持久化请求），修复 fixture 后通过。
- 增加重复序号反例后同命令再次退出码 1，24 项中 1 失败：相同 callback 用最新 version 再次写入 `reconciling`。在同一 SQLite operation 行加入最小 `callback_sequence`，在更新语句中与状态／lease/version 同一原子 CAS 判断；最终 **24/24** 通过，退出码 0；`npm run typecheck` 退出码 0。
- 已核合成范围：新增加的响应丢失两分支、provider 身份与持久请求的 operation/key/knowledge/revision 对齐、读回双证据匹配、重复／旧序号拒绝、过期 lease 和旧版本 fencing。Provider fake 继续留在测试进程的内存中，仅模拟 Worker／SQLite 重启；调和是**测试 fake** 查询其当前快照，不能据此认证真实 callback 发送者、证明外部 Provider 跨进程持久性或真实审计／outbox。已存在的旧 SQLite 文件没有本测试 fake 的真实迁移演练；新增列由新建测试库提供。
- T07 身份与双空间、PG／真实 Worker 重启、备份恢复、secret/path 负例、外部能力准入及团队资产写入全部 `blocked/not_run`；T08 完整票和 `real_verified` 均未通过。最终文件 SHA-256：测试 `c5a86e30b21a2713cb52b41cfa5dbd94aad91694a40c96cb1a773b0372631657`、SQLite fake `3a6e6476bee5a98fa6b79191f357651b9bd455c8b76b1cff8517d40e0a911265`、provider fake `40a9d97fb43c39384e822e3d18df36742fe23f579969a0fc7782be1a7e30804c`。最终 `npm test`：24 文件、224/224 项通过；`npm run typecheck`、`npm run build`、`git diff --check` 均退出码 0；新增证据文档无空白检查报错。没有自动安装、提交或推送。
