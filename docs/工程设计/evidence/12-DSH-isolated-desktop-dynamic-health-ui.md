# 隔离 DSH Desktop 动态健康面板读回（2026-10-20）

> 本次只验证目标 Desktop `0.2.0-rc.2` 的临时独立 `DSH_HOME` / `profiles/desktop`。用户明确授权替换该隔离 profile 的旧 Workbench 包、正常重启，并人工读回新面板；没有改动原 `~/.dsh/profiles/desktop`、真实 Provider 或云资源，也没有执行 disable、uninstall、rollback 或 profile 清理。P0-09 仍为 `partial`，P0 overall 仍为 `no_go`。

## 产物与隔离环境

- 新源码提交：`566fd1a045ae8653ef23237342f56ed04d4af910`（分支 `feat/p0-dynamic-health-ui`；本轮未推送）。从干净工作树构建，显式配置 `backendEndpoint: http://127.0.0.1:39871`，本地 `artifact_digest: sha256:1c37cbbbdf79b9e958d01c15bcb0693b2a2ea0e27f55e1962fe10fcdca3e549e`；构建脚本的 payload/完整 digest 自检为 `passed`、`contract_evidence_level: pending_checks`。这**不是 Desktop 宿主对完整 artifact digest 的独立读回**。
- 只读确认旧安装是[前次隔离实验](./11-DSH-isolated-desktop-health-readback.md)的 endpoint-bound 静态 UI 包（source `e568514b6e13d1b7937b8c38e4a4c0ebe14f11fa`，本地 digest `sha256:c36a98f0375ac48c952cab19722ae0882cfe2be2d20f93ccca0fd4f7eba79f3a`）；用户正常退出当前隔离 Desktop，进程检查无 Desktop 后，使用目标随附 CLI 的 `plugin --profile desktop add <new-local-bundle> --offline`，仅在这套临时 `DSH_HOME` 中替换包链接。CLI `list --depth 0` 和符号链接指向新产物；链接目标 manifest 的 source/digest 与构建结果一致，`client/index.js` 包含新增动态文案。随后用相同 `DSH_HOME` 正常启动 Desktop。此链接与 manifest 对比是本地文件检查，不是宿主完整 digest 证明。
- 本机测试 API 使用已提交源码的 `createApiServer()`；实验进程显式 `listen(39871, '127.0.0.1')`，每次启动后经 `lsof` 核查只监听回环地址，`GET /healthz` 返回 HTTP 200 `{"status":"ok"}`。没有接真实 Provider；本轮最终已停止测试 API 并确认该端口无监听、直连失败。隔离 Desktop 保持运行，未对最终停止后的面板作额外人工读回。

## 用户在新面板的人工读回

用户打开 Workbench 面板，直接读回包标识 `team-knowledge-workbench`、版本 `v0.1.0` 和面板文字；不再依赖 Console 手动 `fetch`：

| 顺序 | 测试 API | 用户看到的面板状态 | 本次证明范围 |
|---|---|---|---|
| 1 | 未运行 | `状态：本机 API 不可达` | 面板不会把断连标为成功 |
| 2 | 仅回环地址启动；本地 `/healthz` 为 `ok` | `状态：本机 API 可达（不代表业务就绪）` | Client 经现有 Host 路由显示本机 API 可达；不证明业务或 Provider ready |
| 3 | 测试 API 停止；端口无监听，直连失败 | `状态：本机 API 不可达` | 打开中的面板自动降级 |
| 4 | 同一本机 API 再次仅回环启动；`/healthz` 为 `ok` | `状态：本机 API 可达（不代表业务就绪）` | 打开中的面板自动恢复 |

读回为用户当场提供的文字，不是独立 Host/Client 分项 load report、日志导出、截图证明或宿主 artifact digest/source commit 读回。最后一次成功状态后已停止测试 API，但没有新的第五次面板人工确认，不能声称该时刻又取得一条降级读回。

## 门禁判定与后续

P0-07 的动态面板在隔离 Desktop 上有失联→可达→失联→恢复的人工读回；P0-09 的 Desktop Health→Client 状态呈现子项比前次纯 Console 实测多一层真实 UI 证据，但整个 P0-09 仍为 `partial`。缺独立 Host/Client load/错误报告、完整 artifact digest/source commit 的宿主读回、真实业务/Provider readiness、disable 后资源清理、卸载残留及可重复 rollback；P0-14～17 的真实身份/隔离/恢复、安全、Provider 和非生产云门禁均不受本次 API 存活验证影响。P0 overall 仍是 `no_go`。
