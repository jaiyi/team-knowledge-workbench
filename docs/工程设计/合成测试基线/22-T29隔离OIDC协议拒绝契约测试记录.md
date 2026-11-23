# T29：隔离 OIDC 协议与回程拒绝契约

> 2026-11-05。仅本机虚构 issuer、主体、Host 与内存状态机；不是 OIDC/JWT 验证器、可部署 Backend、DSH Desktop Host 登录或真实 IdP 集成。工作树既有未提交改动保持原样。

- `tests/support/synthetic-oidc-login.ts` 限于测试目录：模拟固定 HTTPS Backend/环境、发起 Host 绑定、state/nonce 与内部 PKCE verifier/challenge 对应、内部签发的一次性短期授权码、预置 `(issuer, sub)` 身份映射、无 token 短期回程引用、原 Host 秘密绑定的一次性领取、Host-only 短期会话。会话查询只返回 `principalId`，不返回团队、空间、角色或 Git/WeKnora 权限；登录本身不授予资产权限。
- 正反例覆盖错误 issuer/client/audience/Backend/环境、nonce/PKCE challenge/verifier、state 篡改、无映射身份、同邮箱不同 sub、同 sub 不同 issuer、code/引用/会话过期与重放、猜测引用、错误/缺失 Host 秘密、跨 Host 领取与会话查询、账号切换、登出、模拟撤权，以及模拟 issuer/Backend/撤权检查不可用时拒绝。断言回程和领取结果不携带 code、Host 秘密或身份权限；PKCE verifier 和会话句柄不作为 renderer 可见结果。随机令牌及 SHA-256 仅辅助本地状态机，不证明真实签名、TLS、Host 保管或回调分发安全。
- 测试先行的首次 `npm test -- tests/contract/synthetic-oidc-login.test.ts` 在加载测试前退出 **127：`npm: command not found`**；因此**没有**取得实现前的红灯断言或缺模块运行证据。定位到本机 Node 24 后，使用临时 `PATH` 前缀执行以下命令，不安装依赖、不修改登录环境：
  - `npm test -- tests/contract/synthetic-oidc-login.test.ts tests/integration/api/health.test.ts`：退出码 **0**，2 文件、18/18 通过；`/healthz` 正常，自报身份 header 不能开启 `/v1/context` 或团队写入路由（404）。
  - `npm run typecheck`：退出码 **0**。
  - `npm test`：退出码 **0**，26 文件、260/260 通过。
  - `git diff --check`：退出码 **0**；新文件尚未被 Git 跟踪，另以 `git diff --no-index --check /dev/null <新文件>` 逐个检查 3 个新增文件，均无空白错误（该比较命令也可能因存在新增内容返回差异退出码，不能把它当成普通 `git diff --check` 的退出码）。
- **未运行／阻断**：真实 OIDC 授权码交换、JWT 签名/JWKS 与密钥轮换、真实 IdP 回调和撤权传播、TLS/可信 Backend 地址分发、目标 Desktop 系统浏览器→Host 一次性安全回程和会话保管、重启恢复、多进程并发领取、真实成员/空间/资源 ACL 及 Git/WeKnora 读回。fake 的顺序调用不证明并发原子性、网络安全或实时撤权。待平台/安全 Owner 批准固定测试 IdP、Backend/环境、会话策略和目标 Host 能力后另行实测；不得将本记录标为 `real_verified`。

维持 `p0_overall: no_go`、`p0_transition: allowed_with_no_go`、`p1: not_started`。没有新增公开登录或 `/v1/context` 路由；可信身份、ACL、双空间隔离、撤权和恢复门全部通过前不进行真实团队资产写入，也不将 fake/admin 或不完整外部读回冒称真实验证。未批准的 Skill Draft 不得在获准隔离非生产 Runner 外执行；生产凭据、敏感原件、完整 Prompt 或敏感 Tool 参数不得进入代码、日志、fixture、包或证据。
