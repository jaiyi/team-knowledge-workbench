# T29 本机 TEST 身份登录与空间隔离（2026-11-05）

本批仅为独立本机测试身份后端及客户端，不是 OIDC、企业账号、Desktop 插件登录，也不是实际 Git／WeKnora 授权。「我的」「知识」页面已完成的验证不重复安排。旧记录 `25-T29至T07后端身份授权预备记录.md` 描述的是此前**尚未开放 HTTP 登录**的阶段，不代表本批状态；本批仍不依赖不存在的 Desktop 平台／安全 Owner。

## 实现边界

- 显式 `WORKBENCH_LOCAL_TEST_IDENTITY=1`，固定 `127.0.0.1` 的 TEST API；`memberA` 与 `memberB` 使用不同的随机测试口令、不同内部 principal，分别有 `team-a/space-a`、`team-b/space-b` 当前角色。PGlite 仅在被忽略的 `.tmp/workbench-local-identity/` 建库，初始化需要 `WORKBENCH_LOCAL_TEST_CONFIRM=NEW_ONLY`，配置仅存随机加盐 scrypt 摘要且使用私有目录／文件权限；不覆盖已有初始化。不在代码、文档、fixture 或本记录写入口令。
- 本机客户端生成内存中随机领取秘密与 Host 标签；用户手动在系统浏览器打开一次性尝试页面。浏览器只提交 TEST 账号／口令与 CSRF，成功页面不返回 session。客户端凭秘密在三分钟内一次性领取短期 session；库只存 SHA-256 摘要。失败计数锁定单次尝试，单次最多五次；同一自报 Host 标签切号时在同事务撤销旧会话。每次空间读取重查身份、当前成员及逐空间角色，资源映射只能保持 `pending|disabled|not_configured`；无成员／角色时空间为空，未认证或指定无权空间拒绝。写路由依旧关闭。
- Host 标签**不是可信设备身份**；同 OS 用户 agent、终端进程及浏览器的本地威胁边界未获 Desktop 验证。此后端无全局尝试创建速率限制、无企业 IdP 验签／开通；TEST 服务器启动时撤销上次服务的未撤销会话与未完成登录尝试，隔离临时库中已验证旧会话重启后返回 401。身份停用后再启用的旧会话恢复缺口由新迁移补身份级撤权 epoch：数据库在 active→disabled 时递增，session 和已完成的登录尝试固定当时 epoch，重新启用后旧 epoch 不得领取或读取；旧库首次启动升级时使原会话及尝试失效。空间成员／角色仍逐请求重查，不为每个空间另设 epoch。该修复只针对本地状态，远端 IdP 撤权传播未验证。不得暴露到 LAN、反向代理或服务器，不得将其称为目标 Desktop 安全回程或生产认证。

## 本机人工验收（用户已回报结果）

在项目根目录和 Node ≥22 环境操作；先在**每个**要运行下列命令的终端确认 `node --version` 可用（本机若未配置 PATH，可先执行 `export PATH="$HOME/.local/share/nodejs/node-v24.22.0-darwin-arm64/bin:$PATH"`）。**仅在本机终端**保存初始化时一次性显示的两个随机口令，不贴进对话、日志、截图或仓库。命令示例：

```sh
WORKBENCH_LOCAL_TEST_IDENTITY=1 WORKBENCH_LOCAL_TEST_CONFIRM=NEW_ONLY ./node_modules/.bin/tsx apps/api/scripts/local-test-identity.ts init
WORKBENCH_LOCAL_TEST_IDENTITY=1 ./node_modules/.bin/tsx apps/api/scripts/local-test-identity.ts serve
```

另开终端，依次运行（不要同时切号；每次按提示退出）：

```sh
./node_modules/.bin/tsx apps/api/scripts/local-test-client.ts memberA
./node_modules/.bin/tsx apps/api/scripts/local-test-client.ts memberB
```

按客户端提示在三分钟内用本机**系统浏览器**打开其随机 URL，在对应页面输入该账号的测试口令；浏览器应仅提示完成，客户端自动短轮询领取后读取应分别仅为 `team-a/space-a` 与 `team-b/space-b`。客户端随后按 Enter 会发起登出并检查 HTTP 204；若请求失败会明确报错，不得假设会话已撤销。重复 `init` 应拒绝；不要删除已有 `.tmp` 数据以“重试”并遗失自己的测试口令。此步骤只验证 Backend／独立客户端，并未在目标 Desktop 内点击、安装或构包。

用户回报的本机客户端输出显示：`memberA` 自动领取后仅列出 `team-a/space-a`，`memberB` 自动领取后仅列出 `team-b/space-b`，两次均返回 shell 且未显示登出错误。记录仅保留脱敏结论，不保存随机登录 URL 或口令。这确认了本机 TEST 账号登录→会话领取→当前空间读回的 A/B 正向人工验收；该输出未单独展示跨空间请求、登出后旧句柄读回或目标 Desktop 行为。

**新增人工隔离检查（用户已回报结果）**：用户在本机 TEST 服务上执行 `./node_modules/.bin/tsx apps/api/scripts/local-test-client.ts isolation-check`，依提示先以 A、后以 B 登录。回传输出显示 A 只读 `team-a/space-a`、指定 B 空间返回 403；切号后 A 旧会话返回 401；B 只读 `team-b/space-b`、指定 A 空间返回 403；B 登出后旧会话返回 401，随后返回 shell，未显示错误。这里只保留脱敏状态及空间结论，不保存回传中的随机登录 URL、口令、会话句柄或领取秘密。身份 active→disabled→active 后旧会话／已完成尝试不得复活仅由隔离自动化测试验证，并非本次人工观察；成员／空间角色仍逐请求检查，不把身份 epoch 当资源 ACL。这完成的是本机 TEST Backend／独立客户端的新增跨空间、切号和登出负向人工读回，不重复或推翻上段 A/B 正向结果，也不证明目标 Desktop、企业 OIDC、WeKnora／Git ACL 或真实资源隔离。

## 自动化验证和未验证范围

- 本轮新增定向 PGlite：`test-identity-login.test.ts` 11/11；覆盖 A→B 同 Host 标签切号、跨空间选择、登出后旧句柄、身份停用→启用后旧 session／已完成尝试拒绝，以及迁移前存量状态失效。`session-asset-spaces.test.ts` 7/7，直接数据库停用／重新启用后旧会话不能恢复。`npm run typecheck` 退出 0，`npm test` 29 文件 284/284，`npm run build` 退出 0；跟踪和相关新增文件的空白检查通过。另在自动清理的独立临时库实际运行新 `isolation-check` 客户端进程，以模拟系统浏览器仅提交本机合成账号表单，自动观察 A/B 跨空间 403、切号／登出旧句柄 401，退出 0；又用隔离旧版 TEST schema 启动 `serve`，自动迁移后 healthz 200，原会话由迁移失效。演练均未展示或保存口令、句柄和随机 URL。这些是开发者本机 smoke，不是用户手工验收。
- 上一轮 PGlite 定向 `test-identity-login.test.ts`：8/8 通过；覆盖 A/B 正反向空间、一次性领取、错误口令／单尝试次数上限、Origin/CSRF、跨尝试／环境／Host 标签、过期、身份停用、撤销切号、成员／角色更新、并发重复登录提交、关闭写入口。
- **上一轮**本地全量 `npm test`：29 文件 281/281 通过；当时 `npm run typecheck`、`npm run build` 退出 0；`git diff --check` 与当时七个新增文件空白扫描通过。隔离临时目录中 `init`、重复初始化拒绝、`serve` 的 healthz 已通过；缺显式开关、production 模式、非 loopback `HOST`、缺初始化确认均拒绝且不创建库。另在隔离临时库中通过脚本模拟浏览器表单 `memberA` 登录→领取→读出 `space-a`→重启后旧句柄 401。自动轮询调整后再次执行独立客户端实际进程的两账号测试：`memberA`、`memberB` 各自由模拟系统浏览器提交表单，客户端**无需按 Enter 领取**便自动读回各自空间并正常登出，均通过。演练均抑制口令输出，临时数据随后自动清理；不是用户实际手工验收。
- `test-identity-claim.pg.ts` 是**仅编写未执行**的 PostgreSQL 16、独立 role/schema 双连接同尝试／同 Host 并发脚本；未连接或迁移服务器 PG。PGlite 成功不证明 PG 跨连接顺序。目标 Desktop、企业 OIDC、Provider 正反读回、真实资源写入和实际包安装均 `not_run`；人工验收仅覆盖上文所列本机 TEST 正向链路。本地文件中的 `memberA`／`memberB` 测试账号并不等于企业用户；未来 OIDC 需要单独实现和验签。

no real team-asset writes before trusted identity, ACL, isolation, revocation, and recovery gates; no production credentials, sensitive originals, full Prompts, or sensitive Tool parameters in code, logs, fixtures, bundles, or evidence; no execution of unapproved Skill Drafts outside an approved isolated nonproduction Runner; no promotion of fake/admin or incomplete external read-back to real_verified. `p0_overall: no_go`、`p0_transition: allowed_with_no_go`、`p1: not_started` 不变。
