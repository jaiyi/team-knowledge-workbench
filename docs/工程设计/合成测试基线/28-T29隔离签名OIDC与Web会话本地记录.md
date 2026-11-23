# T29 隔离签名 OIDC 与 Web 会话本地记录（2026-11-05）

本记录只覆盖独立 Web/Backend 登录的本地代码切片，不覆盖此前已由用户完成人工验收的本机 TEST 身份流程，也不是目标 IdP、企业身份、Desktop Host 回程、DSH→MCP 或 Git／WeKnora 授权验收。

- 默认 API 仍只开放 `/healthz`；Web OIDC handler 必须显式注入。新增 `008_web_oidc_login.sql` 分离既有 Host/TEST 与 Web session，并保存短时、一次性消费的 state/browser 关联摘要、nonce 与 PKCE verifier；IdP code/token 不入库。仅从已批准且 active 的 `(issuer,sub)` 绑定发行短期 Web cookie session，身份 epoch 在停用后恢复仍使旧会话失效。空间只复用当前成员与逐空间角色的事务读，不提供 Provider 访问或写路由。
- 本机测试采用 Vitest 内的临时 RSA 签名假 IdP、JWKS、授权码及 token endpoint 和隔离 PGlite。测试覆盖 A/B 预绑定、切号与旧会话失效、登出及 CSRF、当前成员失效、Host/Web 通道和环境隔离、并发/重复/过期 state、缺浏览器 cookie、错误签名、kid、nonce、issuer、audience、过期 ID token、PKCE、未预绑定人员、IdP 不可用，以及默认关闭。仅测试模式、隔离环境及双方 loopback 地址可使用 HTTP；普通配置要求 HTTPS，且采用固定 issuer、origin、redirect、RS256 与同源 IdP endpoint。响应保持 no-store，回调后重定向到不带 code/state 的页面，session cookie 保持 HttpOnly，页面使用可读的独立 CSRF cookie 登出。
- 本轮本地验证：`npm run typecheck` 退出 0；新增 `web-oidc-login.test.ts` 5/5；`npm test` 30 文件 289/289；`npm run build` 退出 0，`git diff --check` 退出 0。新增迁移、handler、测试只在隔离 PGlite/HTTP fixture 执行；不能由此声称 PostgreSQL 双连接并发、真实浏览器 cookie 行为或真实 HTTPS/TLS 已验证。
- 目标测试 IdP issuer/client/redirect、可信 HTTPS Backend、真实浏览器正反例、远端数据库与 Provider 操作均为 `blocked/not_run`；需分别取得对应目标和身份授权。T07 Git／WeKnora 当前资源及对象 ACL、T30 MCP 服务端逐人证明、WeKnora 原 UI／直链权限独立验收。没有接触真实资源、部署、安装或提交。

no real team-asset writes before trusted identity, ACL, isolation, revocation, and recovery gates; no production credentials, sensitive originals, full Prompts, or sensitive Tool parameters in code, logs, fixtures, bundles, or evidence; no execution of unapproved Skill Drafts outside an approved isolated nonproduction Runner; no promotion of fake/admin or incomplete external read-back to real_verified. `p0_overall: no_go`、`p0_transition: allowed_with_no_go`、`p1: not_started` 不变。
