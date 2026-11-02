# Workbench 首条薄切片：产品接线与阶段效果验收

> 2026-11-02 本地执行记录；尚无该版 package artifact 或 Desktop 安装读回。这里的半导体采购内容是虚构**测试数据**，被测试对象是实际生成的 Workbench Client 包，不是把 `tests/support` 当成产品。P0 overall 仍 `no_go`，P1 仍 `not_started`。

## 固定输入与实现边界

- 输入沿用小基线：五文件 SHA-256 `5d3f913f53878546f381bd9069e77874f6fa93f96974e2204808c813d9856ec2`；来源 Markdown SHA-256 `cb64e758d67558ccb51eeb06d07e898a1a66e43ab0953ea313c9fa40adf2d66f`。构建生成 Client 前重新读文件核对二者，不相符即拒绝；不会接受 UI 提交的内容或摘要作为可信来源。
- T05 固定评测日 `2026-07-15`：11 个必需锚点均存在、`quote_expired`、`fixtureCheckPassed: false`；质量审计结论与 R3 适配试验仍缺失。`2026-08-31` 只是内部目标，不能当供应商承诺。原样本未改变；不展示可送审成功路径，也没有另造“已通过”样本。
- 生成的 Workbench Client 面板接入只读来源展示、固定五入口状态、模拟情境及浏览器内的待补证草稿意向；候选送审始终禁用。此意向不是 DSH Creation Session/Draft，不持久化，也不调用 Host 写路由、真实 API、模型或 Provider。虚构跨空间/撤权/旧基线情境仅用于 UI 拒绝演示，不是可信身份或资源端 ACL。原有 `/healthz` 探测和独立 Session 草稿修订区域保留，不能把该修订区域当作本合成样本的创作链。

## 本地执行结果

- 先编写生成包行为测试；首次因尚无 `synthetic-stage-fixture` 无法收集；补固定摘要与核证逻辑后，生成 Client 操作测试因面板尚未接线而失败。接线后定向运行曾因新组件的测试树遍历和既有健康轮询分别失败；修正测试树定位并区分健康请求与创作请求后，`npm test -- tests/contract/synthetic-baseline.test.ts tests/contract/synthetic-material-review.test.ts tests/contract/synthetic-creation-session.test.ts tests/contract/workbench-package-fixture.test.ts tests/contract/workbench-synthetic-stage.test.ts`：5 文件、47 测试通过。
- `npm test`：22 文件、196 测试通过；`npm run typecheck`、`npm run build`、`git diff --check`：通过。环境：本机 Node v24.22.0，npm 11.19.1。上述最终命令退出码均为 0；失败的中间运行不计作通过证据。
- 生成包契约测试直接运行 Client 字符串：浏览/取消不产生草稿；跨空间模拟情境既不展示锚点也不建立意向，已撤权/旧基线模拟情境拒绝；明确点击仅生成一个本地意向，重复不重复；切换到拒绝情境后不保留意向；送审按钮禁用；没有新 Session `create` 或任何非原健康路由请求。既有独立 Session 修订、Host 健康路由回归未退化。这是**本地自动化结果**，不是用户实际 Desktop 点击读回。

## 待操作及独立门禁

- `npm run package:workbench` **未运行**：脚本必须从干净 Git 工作树取 `source_commit`，当前已有用户先前未提交的文档/测试与本次产品改动；不得擅自提交、清理或用旧 commit 冒充本次源码。新 artifact digest、宿主加载的制品身份、实际 Desktop 操作效果均待验证。
- 隔离 Desktop 的安装前后快照、重开/Host 与 Client 分项 load 及错误、实际样本面板操作、禁用资源释放、卸载残留和旧 digest/空 profile 回滚均 `not_run`；执行前需对目标独立 profile、动作与回退方案分别确认，不碰现有正常 profile。历史健康面板安装记录不等于这版演示已安装。
- T05 后续真实上传/解析范围、T01 服务端可信身份和真正会话创建、Provider/云端目标及读回仍缺。P0 package Spike、Provider/云端和 overall 三种决策分别待责任人、复核人和复审日期；未取得决定前不变更 P0/P1 状态，也不开放真实团队资产写入。Desktop 实际操作所得差异先回流 T05/T01，再继续 T02/T04/T08。
