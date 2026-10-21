# 隔离 DSH Desktop 插件清单 Host 状态人工读回（2026-10-20）

> 本次仅查看目标 Desktop `0.2.0-rc.2` 临时独立 `DSH_HOME` 的只读界面，未修改 profile、重启 Desktop、调用真实 Provider 或执行 disable、uninstall、rollback。以下为用户在界面提供的文字读回，不是自动导出的报告。

## 只读入口及结果

目标版随包 `@deepseek-ai/dsh-host-plugin-inventory/README.md` 说明 Settings → Plugins → Plugin list 通过 `pluginInventory/list` 读取当前 Host Loader 条目的 ID、模块名、启用状态和 root Fiber phase；快照不保存历史。其 `lib/index.js` 的 `readPluginInventory` 从 `ctx.loader.entries()` 投影 `entryId`、`moduleName`、`enabled` 和 `fiberPhase`，不投影 source commit 或 artifact digest。该入口与侧边栏 Plugins 的包详情页不同。

用户先在包详情页读回 `@local/team-knowledge-workbench`、`v0.1.0`、“共 1 个 · 1 运行中”；随后在 **Settings → Plugins → Plugin list** 搜索并展开对应条目，读回：

| 字段 | 用户读回 |
|---|---|
| 条目 ID | `include:team-knowledge-workbench` |
| 完整模块名 | `@local/team-knowledge-workbench` |
| 配置状态 | 已启用 |
| 运行状态 | 运行中 |

这是一条当前隔离 Desktop 的 **Host Loader 状态人工快照**：可证明目标条目在读回时显示启用、运行中。用户没有读回原始 Remote JSON、精确 fiber phase 或错误日志；不将中文“运行中”冒充为独立导出的 `active` 报告。包详情页的版本和组件数属于另一个 UI 读回，不是 Plugin list 的 identity/digest 字段。

## 证据边界

- Host 快照不等于独立的 Host/Client 分项加载及错误报告，也不验证失败路径或历史故障；Client 在[动态面板实测](./12-DSH-isolated-desktop-dynamic-health-ui.md)中的状态循环是另一个用户人工 UI 读回。
- 此只读入口未提供 Desktop 宿主对 `source_commit` 或**完整 `artifact_digest`** 的读回；本地构建 manifest/链接与 CLI config 的读回不能替代宿主完整 digest 证明。
- 没有禁用后的 UI/路由清理、卸载残留、可重复 rollback、业务 readiness 或真实 Provider 验证。P0-05 的 Host 状态子项增加一条人工快照，P0-05、P0-08、P0-09 仍为 `partial`，P0 overall 仍为 `no_go`。
