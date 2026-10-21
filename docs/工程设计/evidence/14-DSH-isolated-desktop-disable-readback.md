# 隔离 DSH Desktop 包级禁用后的 UI 与健康路由读回（2026-10-20）

> 仅在临时独立 `DSH_HOME` 的 Desktop `0.2.0-rc.2` 中，按用户授权关闭 Workbench **包级开关**并做只读前后核查；没有重启、重新启用、卸载、rollback、清理 profile、接入真实 Provider 或操作原 `~/.dsh/profiles/desktop`。以下人工 UI/Console 文字读回不是自动导出的分项 load report。

## 禁用前基线

- [当前 Host Loader 人工读回](./13-DSH-isolated-desktop-host-inventory-readback.md)：`include:team-knowledge-workbench`，完整模块名 `@local/team-knowledge-workbench`，已启用、运行中；[新动态面板](./12-DSH-isolated-desktop-dynamic-health-ui.md)曾读回本机 API 不可达→可达→不可达→可达。旧产物的隔离 Desktop 应用 Console 曾对同一路径读回 HTTP 200，见 [11](./11-DSH-isolated-desktop-health-readback.md)；这些是先前不同时间/产物的基线，不冒称本次禁用前即时取得新产物的 HTTP 200。
- 操作前只读核对隔离 Desktop Host 进程仍以临时 `profiles/desktop` 启动，仅监听 `127.0.0.1:19387`；本地 profile `package.json` 的 `dsh.profile.bundles` 仍选中 Workbench，依赖及软链接存在，`cordis.patch.yml` 不包含 Workbench 覆盖。操作前 profile `package.json` SHA-256 为 `7c4e6897dfff8338d3472e0582198b21a18312648059bfde113d163bea174657`，`cordis.patch.yml` 为 `6677ab3a8deb7a45c7252a9be085b7da3dd6411805668d7c3a525b8244fc63b9`。终端无会话访问健康路径为 HTTP 401，不能作为禁用前路由有效性证明。

## 禁用和读回

用户在隔离 Desktop 的 Plugins 包详情页关闭 Workbench **包级**开关后，人工读回包详情 `@local/team-knowledge-workbench`、`v0.1.0`、“共 1 个 · 1 已停用”，并确认 Workbench 侧栏入口和面板消失。没有操作“包含的组件”内的单项开关。

只读本地核对：该 bundle 已从隔离 profile 的 `dsh.profile.bundles` 选中列表移除；包仍列在 `dependencies` 中，软链接仍存在（禁用不是卸载）；`cordis.patch.yml` 哈希保持不变。禁用后 `package.json` SHA-256 为 `d97e1f9d46fd7db1b444c70c2d5682c94e2e0b0ffe336569ed6d109dd47987ef`。Desktop Host 进程持续运行，仍仅监听回环地址；本轮没有通过重启来制造 UI 消失。

用户在**同一隔离 Desktop 应用**开发者工具 Console 只读调用 `fetch('/api/team-knowledge-workbench.health', { cache: 'no-store' })`，仅打印 HTTP 状态和 Content-Type，读回 `GET dsh-app://app/api/team-knowledge-workbench.health 404 (Not Found)`、`HTTP 404 类型 text/plain;charset=UTF-8`；未复制响应正文、Cookie 或 Token。这是会话内同源请求，与终端无会话 HTTP 401 不同。结合禁用前同一路径曾有应用内响应、包选择被移除和当前 404，该证据支持**禁用后健康路由不再可用**，而非“后端健康降级”或“业务 ready”。未另取禁用后 Settings → Plugins → Plugin list 的 root Fiber phase。

## P0 判定边界

P0-10 的**隔离 Desktop 包级 live disable → 可见侧栏/面板移除 → 应用内健康路由 404**子路径已有人工和只读 profile 证据，整体从 `missing` 改为 `partial`；仍未验证后台定时器/请求与其他资源全部释放、失败路径、重启保持性、单组件禁用、卸载残留或可重复 rollback。完整 artifact digest/source commit 的 Desktop 宿主读回、独立 Host/Client 加载及错误报告、真实业务/Provider readiness 仍缺。P0 overall 保持 `no_go`。
