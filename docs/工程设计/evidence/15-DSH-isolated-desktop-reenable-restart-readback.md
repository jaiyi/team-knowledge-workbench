# 隔离 DSH Desktop 重新启用与重启读回（2026-10-20）

> 本次仅在此前禁用的临时独立 `DSH_HOME` / `profiles/desktop` 上，按用户明确授权重新启用 Workbench 包并正常重启 Desktop。没有触碰原 `~/.dsh/profiles/desktop`、卸载、清理、rollback、真实 Provider 或云资源。界面结果为用户文字读回，不是自动导出的 Host/Client 分项加载报告。

## 操作前与重启过程

- [此前包级禁用证据](./14-DSH-isolated-desktop-disable-readback.md)的隔离 profile 中，Workbench 未被 `dsh.profile.bundles` 选中，依赖和软链接仍在；本轮重新启用前只读复核 `package.json` SHA-256 为 `d97e1f9d46fd7db1b444c70c2d5682c94e2e0b0ffe336569ed6d109dd47987ef`，`cordis.patch.yml` SHA-256 为 `6677ab3a8deb7a45c7252a9be085b7da3dd6411805668d7c3a525b8244fc63b9`。Desktop Host 当时仅监听 `127.0.0.1:19387`。
- 用户在隔离 Desktop 的 Plugins 包详情页打开 Workbench **包级开关**。本地只读复核 Workbench 已被重新选入 profile，依赖和软链接保留，`package.json` SHA-256 回到禁用前的 `7c4e6897dfff8338d3472e0582198b21a18312648059bfde113d163bea174657`；`cordis.patch.yml` 哈希不变。
- 终端尝试让应用正常退出时，权限控制拒绝了会影响所有实例的退出命令；未改用强制终止或手改 profile。用户随后确认已正常退出当前隔离 Desktop，进程/监听只读检查也确认旧实例停止。之后仅以原临时 `DSH_HOME` 和其独立 Electron user-data-dir 重新启动 Desktop；新 Host 进程在 `127.0.0.1:19387` 回环地址监听。重启后再次只读确认 Workbench 仍被选中，依赖/软链接仍在，两份 profile 文件的 SHA-256 与启用后的数值一致。

## 重启后人工读回

| 入口 | 用户文字读回 |
|---|---|
| Plugins 包详情 | `@local/team-knowledge-workbench`、`v0.1.0`、“共 1 个 · 1 运行中”，组件 `team-knowledge-workbench`“运行中” |
| Settings → Plugins → Plugin list | `include:team-knowledge-workbench`，完整名称 `@local/team-knowledge-workbench`，配置状态“已启用”、运行状态“运行中” |
| Workbench 侧栏与面板 | 侧栏重新出现；面板显示 `team-knowledge-workbench`、`v0.1.0`、“状态：本机 API 不可达” |

只读进程检查时原本机测试 API 端口 `127.0.0.1:39871` 无监听；面板没有把 API 断连显示为可达或业务就绪。本次没有在重启后从应用 Console 单独请求健康路由，也没有取得原始 Host/Client 加载及错误报告、完整 artifact digest 或 source commit 的宿主读回。

## P0 判定边界

此次证据支持**同一隔离 profile 包级重新启用 → 正常退出并重启 → profile 选择保留、Host 条目和可见 Client UI 恢复**。它不证明禁用状态跨重启保持、不证明所有后台资源释放、失败路径或可重复 rollback；面板“本机 API 不可达”仅是当前本机进程状态，不能外推到真实业务或 Provider readiness。P0-05、P0-07 和 P0-09 仍为 `partial`，P0-10 仍为 `partial`；P0 overall 仍为 `no_go`。
