# 隔离 DSH CLI Web Host 健康路由实测（2026-10-20）

> 本次只验证 DSH `0.2.0-rc.2` 的独立临时 `DSH_HOME` / `workbench-health-web` **CLI Web Host**，不是现有 Desktop profile 的安装、重启、Host/Client 分项 load report 或 UI 读回。未触碰现有 `~/.dsh/profiles/desktop`；未执行插件 disable、uninstall、rollback 或 profile 清理。P0-09 仍是 `partial`，P0 overall 仍是 `no_go`。

## 构建与隔离边界

- 原源码工作树含上一轮未提交的文档记录；为遵守构建脚本的干净工作树门禁，使用临时独立 Git clone 检出已提交 `main` 的 `e568514b6e13d1b7937b8c38e4a4c0ebe14f11fa`，在该 clone 中验证 `git status --porcelain` 为空。未更改源码或把未提交文档伪装成产物来源。
- 在 clone 中用 `--backend-endpoint http://127.0.0.1:39871` 构建本次**不同于无 endpoint 产物**的候选 bundle；`source_commit` 为上述提交，完整本地 `artifact_digest` 为 `sha256:c36a98f0375ac48c952cab19722ae0882cfe2be2d20f93ccca0fd4f7eba79f3a`，artifact inspection `passed`，`contract_evidence_level: pending_checks`。此 digest 仅由本地构建/校验得到，非宿主读回。
- DSH CLI 版本为 `0.2.0-rc.2`。最初空白隔离 profile 的默认配置没有 Connection；在同一临时 `DSH_HOME` 中从随包 `web` 模板初始化 `workbench-health-web`，确认组成配置包含 `@deepseek-ai/dsh-client-connection`，再用 `dsh plugin --profile workbench-health-web add <local-bundle> --offline` 安装到该临时 profile。`dump-config` 读回 `team-knowledge-workbench`、source/runtime digest 和 `backendEndpoint`。普通 `desktop` profile 由 Electron 独占，本次没有尝试从 CLI 启动它。
- CLI Web Host 只绑定 `127.0.0.1:39872`，本机测试 API 只绑定 `127.0.0.1:39871`；API 未连接真实 Provider。验证代码与实验 profile/产物均保留在临时目录，未写入仓库；两个监听进程在验证后停止，端口无监听残留。未导出会话 cookie、启动 token、完整 Host 日志或请求正文到本证据。

## 真实 HTTP 读回

| 操作 | 结果 | 解释 |
|---|---|---|
| 无 cookie 请求 `/api/team-knowledge-workbench.health` | HTTP 401 | 没有会话不能读取这条路由 |
| 附加非可信 Origin 请求同路由 | HTTP 403 | Host/Origin 信任栅栏拒绝 |
| 本次进程的一次性本机入口换取临时 browser session | HTTP 303 | 凭据只在实验进程内使用，不记录其值 |
| 已认证 POST 同一路由 | HTTP 404 | 候选 route 仅支持 GET |
| 已认证 GET，API 未启动 | HTTP 200, `{"status":"degraded","reference":"api-unavailable"}` | 状态字段是内层 probe 结果；HTTP 200 仅表示路由已响应 |
| 启动本机 `/healthz` 后 GET | HTTP 200, `{"status":"ok","reference":"api-health-reachable"}` | 仅证明此本机 API 进程可达 |
| 停止 API 后 GET | HTTP 200, `{"status":"degraded","reference":"api-unavailable"}` | 没有把失联报告成成功 |
| 重启同一本机 API 后 GET | HTTP 200, `{"status":"ok","reference":"api-health-reachable"}` | 失联后可重新探测 |

已认证 GET 的响应头为 `content-type: application/json` 和 `cache-control: no-store`。实际 route 可达及返回状态说明此 CLI Web profile 的 Host bundle/Connection 组合生效；没有独立记录 `ctx.connection` 对象或 Desktop Host 的 load report，因此这不是所有 DSH carrier 上的注入保证。最初的临时验证脚本因同步回调被当成 Promise 调用而退出，在修正**实验脚本**后两次成功运行，其中一次额外核验了 POST 与响应头；该脚本错误不属于 Workbench bundle。

## 尚缺门禁

CLI Web Host 的会话认证和只读健康读回已经取得，不能外推到 Desktop 的 HTTP carrier、Desktop fresh-profile/Host+Client 分项加载、浏览器 Client 自身读回、动态面板状态或完整 artifact digest 宿主读回。下一步需另获 Desktop 安装/重启授权，核对实际 profile 与可观察加载面，再验证真实 Desktop 读回；disable、uninstall、rollback 需各自授权。真实 Provider/业务 readiness 及 P0-14 等独立硬门禁仍未完成。
