# TEST Web OIDC 人员绑定（管理员操作，默认 dry-run）

只针对**获得单独授权的非生产数据库/schema**。本票不执行目标环境迁移、写入或部署。本工具没有 HTTP 开通接口，也不会从登录回调或邮箱/DSH userId 自助造人。管理员先在隔离 IdP 核对签发方 `issuer` 与不可更改的测试 `sub`，私下审批唯一内部 `principalId`、已存在的 team/asset space 及逐空间角色，然后通过受控 stdin 提交 JSON 请求；不得将真实主体、密码、数据库 URL 写入命令行参数、仓库、shell history、普通日志、工单正文或输出。stdout 只打印动作与匿名结果；异常仅打印通用错误。

操作前由管理员检查现有 schema 版本；新 schema 经审定后按 `001_knowledge_transition_outbox.sql` → `003_asset_space_authorization_bindings.sql` → `004_workbench_identity_sessions.sql` → `006_identity_revocation_epoch.sql` → `008_web_oidc_login.sql` 手工迁移；已执行过的迁移不重复执行，Web 链路不含本机 TEST `005/007`。需由受控环境设置 `WORKBENCH_ADMIN_TEST_ONLY=1`、仅管理员可用的 `WORKBENCH_ADMIN_DATABASE_URL`（PostgreSQL `sslmode=verify-full`，主机名/CA 由部署端实际核实）；管理员 role 仅在获批维护窗口使用：对身份绑定／成员资格只授予所需读取、插入及 `UPDATE(status)`，对空间只授予所需读取、对角色绑定只授予所需读取及插入；不授予空间或角色绑定 UPDATE／DELETE、身份或成员关键列 UPDATE。Web 运行 role 需按实际登录／登出 SQL 最小化授予 session／attempt 的必要读写和身份／空间表的只读权限，不授予身份绑定、成员资格或空间角色表的写权限。管理员审批与审计留在环境侧的受限系统，结果不包含个人身份。

私下生成符合以下**结构**的输入；示例值只能用于离线合成测试，不能直接绑定真实人员：

- 开通：`{"action":"provision","issuer":"https://<approved-idp>/realms/workbench-test","subject":"<approved-stable-sub>","principalId":"<approved-internal-id>","grants":[{"teamId":"<approved-team>","assetSpaceId":"<existing-space>","role":"reviewer"}]}`
- 停用：`{"action":"disable","issuer":"https://<approved-idp>/realms/workbench-test","subject":"<approved-stable-sub>","principalId":"<approved-internal-id>"}`

执行器为 `./node_modules/.bin/tsx apps/api/scripts/admin-web-identity.ts`：无参数或 `--dry-run` 只核查并返回 `would_apply`／`unchanged`，任何写入均须显式 `--apply --confirm-test-only`。输入应从受限文件描述符或交互 stdin 送入，而非回显命令。请求拒绝未知字段、重复授权、现有冲突或不一致映射；对尚未绑定的内部主体，已存在且完全符合审批范围的 active 成员资格／空间角色保留原样，只补缺失授权，不重复插入；遇已停用身份不隐式重启用。停用会将绑定和其成员资格置 disabled；既有 Web 会话因绑定状态与撤权 epoch 失效。进一步恢复须重新走审批流程，不得把 IdP 账号停用等同于本地会话即时撤销。

本地 PGlite 的非 owner 角色测试覆盖单连接 SQL 权限、事务与拒绝契约，不证明目标 PG 的实际授权、TLS、外键并发锁或真实浏览器授权。空间和角色读取不加行锁：角色插入的外键可检查目标空间，但 dry-run／不变路径没有并发保护；并发修改已存在角色行可能在读取后发生，原先锁定已有行的实现也无法阻止并发插入新角色行。目标库实际绑定前须核对其他授权写入者并明确维护窗口；若需要并发提交时 grant 集始终精确，先另行设计统一串行化与真实 PG 双连接回归。目标 DB 登录和所有写入保持 `blocked/not_run`。
