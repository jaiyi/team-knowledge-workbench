# DSH Desktop 0.2.0-rc.2 Host 健康读回候选契约（2026-10-19）

> 只读核查本机随包实现，并在仓库中运行本地替身测试。本文撰写时**未**打包新产物；后续在干净 `main` 上完成的无 endpoint 本地构建见 [09 构建记录](./09-Workbench-health-candidate-local-build.md)，隔离 CLI Web Host 与 Desktop 的独立读回见 [10](./10-DSH-isolated-web-host-health-smoke.md)、[11](./11-DSH-isolated-desktop-health-readback.md)。本文原始契约核查不是 Workbench readiness 官方服务确认，也不是 P0-09 整项通过证据。

## 随包依据

以下路径均相对 `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar!/dsh/node_modules/@deepseek-ai/`，适用于本机 `0.2.0-rc.2`；它们是随包实现与 README，不是 Workbench 专属 API 保证。

| 来源 | 可确认事实与限制 |
|---|---|
| `cordis/src/reflect.ts:32-46,277-304`；`cordis/src/fiber.ts:402-421` | `ctx.provide` 是随 fiber 生命周期管理的 Host service，不自动送到 Client；卸载时不能新建 effect。当前生成 Host 清理回调原先再次 `ctx.provide`，已改为只置 `disposed`。 |
| `dsh-typert-protocol/README.md:28-45`；`dsh-api-gateway/README.md:25-29,52-62`；`dsh-api-remotes/README.md:73-77` | typed Remote 需要显式方法声明、生成贡献与 Client mount；不能把 `workbenchIdentity.readiness.probe` 当作自动 Remote。 |
| `dsh-client-connection/lib/index.js:580-583,608-639,758-761`；`dsh-session-log-export/lib/index.js:493-496,516-533` | 内置 Host 示例通过声明 `connection` 注入注册 `/api` 下 exact Fetch route；该路由随 fiber 卸载移除。此为通用机制，不保证第三方插件的 Desktop carrier 行为。 |
| `dsh-client-connection/README.md:28,32,39-56`；`dsh-session-log-export/lib/client.js:11-12,52,104-111` | 示例 Client 用 document-relative `api/...` 和浏览器 fetch；浏览器 HTTP 仍需 Host/Origin 与 session 检查；Connection `ready` 只是传输代际状态，不代表 Workbench 后端健康。 |
| `dsh-host-plugin-inventory/README.md:10-12,28-42` | 插件清单只反映 Loader/fiber 状态，不读回 Workbench `/healthz` 或 Provider 业务健康。 |

旧版源码中的 `desktopWorkbenches.register` 不在此目标版本的已核实契约内；参见 [Client slot 契约](./06-DSH-desktop-client-slot-contract.md)。

## 本地实现与未解决门禁

生成 Host 声明 `inject = ['connection']`，借用宿主 Connection 的 `fetch.register` 以唯一 `/api/team-knowledge-workbench.health` GET 路径调用现有受限 loopback `/healthz` probe，仅返回固定 `status/reference` 和 `Cache-Control: no-store`，不暴露身份 digest、API 正文或凭据。没有自行监听端口。缺少 Connection service 时拒绝初始化，不将缺失误报为 healthy；已注册路由依赖宿主 fiber 清理，不在卸载时重注册。默认不配置 endpoint 的结果仍为 `unknown`，可达/断连/恢复只表示 API 进程状态。

`tests/contract/workbench-package-fixture.test.ts` 使用**替身 registry**检查 route 形状、仅 GET、默认状态、可达→断连→恢复、卸载后的 route 移除、进行中请求不能报迟到成功和卸载时不重复注册 Host service。替身本身不能证明 DSH 真实 session 认证、Host 的 `connection` 注入、route 实际可达或 UI 状态变化；后续[隔离 CLI Web Host](./10-DSH-isolated-web-host-health-smoke.md)和[隔离 Desktop](./11-DSH-isolated-desktop-health-readback.md)分别取得真实的健康 route 状态读回，但不证明卸载生命周期、完整 digest 宿主读回或动态 UI。Client 仍显示静态“状态：未验证”；安全状态桥留待分片开发与验证。P0-09 保持 `partial`，P0 总体仍为 `no_go`。
