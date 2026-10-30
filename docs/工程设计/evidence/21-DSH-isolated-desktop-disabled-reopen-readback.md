# 隔离 DSH Desktop 停用状态跨重新打开读回

> 仅记录临时独立 `DSH_HOME` / `profiles/desktop` 中 Workbench 包级停用后的重新打开与只读读回。用户确认的界面状态不是自动导出的 Host/Client 加载或错误报告；未操作原 `~/.dsh/profiles/desktop`、卸载、清理、rollback、真实 Provider 或云资源。

## 前置与重新打开

- 此前同一隔离 profile 的[包级即时停用](./14-DSH-isolated-desktop-disable-readback.md)已验证侧栏/面板消失、同会话健康路由 HTTP 404；后来曾[重新启用并重启](./15-DSH-isolated-desktop-reenable-restart-readback.md)。这两项历史读回均不证明停用状态跨重新打开保持。
- 本次用户确认操作前是临时隔离 Desktop，Workbench 侧栏及面板可见；随后关闭包级开关，读回“共 1 个 · 1 已停用”。此即时停用结果不重复计作新覆盖项。
- 用户要求重新打开隔离 Desktop，之后又要求再启动一次。最后一次启动前的进程只读预检显示隔离实例已不在运行，因此没有执行退出操作；只读核对原隔离 profile 中 Workbench 未被选中，依赖和 bundle 软链接仍存在。使用原临时 `DSH_HOME` 和独立 Electron user-data-dir 重新打开；之后再次只读核对 Workbench 仍未被选中，profile `package.json` SHA-256 为 `d97e1f9d46fd7db1b444c70c2d5682c94e2e0b0ffe336569ed6d109dd47987ef`，与此前停用后的记录一致。这是本地 profile 配置读回，不是宿主对完整 artifact digest 的证明。

## 重新打开后的人工读回

用户确认隔离 Desktop 的包详情仍显示“共 1 个 · 1 已停用”，Workbench 侧栏仍未出现。由此可确认**同一隔离 profile 的包级停用状态在实例退出、按原隔离方式重新打开后保持**；不能从进程检查推断界面状态，界面结论以用户读回为准。此次没有单独采集退出方式、重新打开后的应用内健康路由、独立 Host/Client 初始加载及错误报告或后台资源释放证据。

## P0 判定边界

P0-10 的停用状态跨退出/重新打开保持子路径已有读回；既有的即时 UI 消失和同会话路由 404 仍由 [14](./14-DSH-isolated-desktop-disable-readback.md) 单独证明。后台资源全部释放、失败路径及更广泛的生命周期验收仍缺，P0-10 保持 `partial`。本次不改变完整 artifact digest/source commit 宿主读回、fresh-profile 卸载残留、rollback、Provider/云端 readiness 或 P0 overall `no_go` 的判定。
