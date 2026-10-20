# 隔离 DSH Desktop 健康路由读回（2026-10-20）

> 本次在**新的临时 `DSH_HOME`** 中验证 Desktop `0.2.0-rc.2`，不是现有 `~/.dsh/profiles/desktop` 的升级或覆盖。用户先正常退出原 Desktop；实验只初始化并安装到临时 home 下的 `profiles/desktop`。未执行 disable、uninstall、rollback 或 profile 清理。以下是人工 Console 读回和本机进程观察，不是自动导出的 Host/Client 分项 load report；P0 总体仍为 `no_go`。

## 产物和实验环境

- 复用[隔离 CLI Web Host 实测](./10-DSH-isolated-web-host-health-smoke.md)中从干净提交 `e568514b6e13d1b7937b8c38e4a4c0ebe14f11fa` 构建的 endpoint-bound bundle；本地 manifest `artifact_digest` 为 `sha256:c36a98f0375ac48c952cab19722ae0882cfe2be2d20f93ccca0fd4f7eba79f3a`、`contract_evidence_level: pending_checks`，endpoint 为 `http://127.0.0.1:39871`。它与[09 无 endpoint 产物](./09-Workbench-health-candidate-local-build.md)不是同一 digest；完整 digest **没有从 Desktop 宿主读回**。
- 只读检查目标版 Desktop：`resolveDesktopPaths(resolveDshHome())` 选择 `$DSH_HOME/profiles/desktop`，但 Electron 的 `requestSingleInstanceLock()` 在访问 profile 前生效。用户确认原实例已退出，且进程检查无 Desktop 后，才用临时 `DSH_HOME` 首次启动以初始化独立 Desktop profile；正常退出该临时实例后，执行 `dsh plugin --profile desktop add <local-bundle> --offline`，隔离 profile `plugin list --depth 0` 显示 `@local/team-knowledge-workbench`。再次用相同 `DSH_HOME` 启动 Desktop，Host 在本机 loopback 监听；无会话请求该健康路由为 HTTP 401，非可信 Origin 为 HTTP 403。这两个拒绝不代替已认证读回。
- 用户在此次隔离 Desktop 看到了 `team-knowledge-workbench`、`v0.1.0`、“状态：未验证”。用户**未**另行确认插件列表显示“运行中”；面板可见和健康路由可达也不能当成正式的分项 load report。
- API 实验进程使用已提交源码中的 `createApiServer()`，无真实 Provider。初次启动误用入口的默认 `listen(port)`，观察到它监听所有网卡，**立即停止，未用于 Desktop 成功状态读回**；随后显式以 `listen(39871, '127.0.0.1')` 启动，并用 `lsof` 确认仅监听 `127.0.0.1:39871`，`GET /healthz` 返回 `{"status":"ok"}`。先前 CLI Web Host 的单独实验边界见 10，不混记为这次 Desktop 的网络绑定事实。

## Desktop Console 人工读回

用户在显示 Workbench 面板的隔离 Desktop 开发者工具 Console 手动运行只读 `fetch('/api/team-knowledge-workbench.health')`，只提供 HTTP 状态和脱敏响应的 `status/reference`；未复制会话 token、cookie 或完整日志。

| 顺序 | 本机 API | 用户在 Desktop Console 的读回 | 结论 |
|---|---|---|---|
| 1 | 未运行 | HTTP 200, `{"status":"degraded","reference":"api-unavailable"}` | Desktop 的已认证应用请求到达 Host；未把失联当作成功 |
| 2 | 仅回环地址启动，`/healthz` 返回 `ok` | HTTP 200, `{"status":"ok","reference":"api-health-reachable"}` | 此刻**仅证明本机 API 进程可达** |
| 3 | 停止；端口无监听，直接请求连接失败 | HTTP 200, `{"status":"degraded","reference":"api-unavailable"}` | 已认证路由继续存在，探针降级 |
| 4 | 同样仅回环地址重启，`/healthz` 返回 `ok` | HTTP 200, `{"status":"ok","reference":"api-health-reachable"}` | 从失联恢复；不证明 Provider 或业务 ready |

上述 HTTP 200 是 `/api` 路由成功响应的 HTTP 状态，不等于内层健康 `ok`；用户 Console 的初次 `net::ERR_FAILED` 未标识对应请求，不能作为 Workbench 失败证据。之后的四次具体请求均有明确状态读回。最后一次读回后已停止测试 API，确认 `39871` 不再监听；**没有**要求用户在最后停止后再读一次，不能声称那时另有新一次 Desktop Console 读回。隔离 Desktop 仍在运行，临时 profile 和产物未卸载、未清理；如需恢复原 Desktop 会话，应先正常退出当前隔离实例，再从原环境正常打开应用，不能在本记录中假装已经切回。

## 门禁判定

已验证：**隔离 Desktop fresh home/profile 的本地安装与静态面板可见、Desktop 应用 Console 对 Host `/api` 健康路由的已认证读回、回环 API 可达→失联→恢复。** 不提升为 Workbench 产品或 P0 Go：界面文字仍固定“状态：未验证”，Host→Client 动态 UI 未实现；缺独立 Host/Client load report、完整 artifact digest/source commit 的 Desktop 宿主读回、真实身份/Provider readiness，以及 disable、卸载、可重复 rollback、P0-14 等硬门禁。P0-09 的 Desktop 健康路由子项已验证，但整项仍为 `partial`，不能把 API 进程可达误称为业务健康或 `real_verified`。
