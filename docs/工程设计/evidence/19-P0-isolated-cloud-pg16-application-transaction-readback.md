# P0-14 隔离云端 PG16 应用事务读回（合成数据）

> 依据：用户在腾讯云轻量应用服务器的 SSH 终端执行预检和一次性测试命令，并在会话中回传 TAP 与读回。助手未独立连接该服务器或数据库。该证据仅证明指定隔离环境中的应用事务路径，不代表密码认证、Provider/Worker 完整链路、备份恢复或 P0 Go。

## 环境与制品

- 目标仅为独立的 Workbench P0 测试 PostgreSQL 16 容器和数据库；用户读回 PostgreSQL 16.15、无外部端口映射、`public` 现有五表。没有对该 schema 重跑迁移，也没有操作其他测试应用的 PG。
- 服务器 x86_64，无宿主 Node；测试使用单次拉取的 `node:22-bookworm-slim` Linux/amd64 镜像，用户读回 image ID `sha256:ecf6aca355bb97426fb9e9b3616c9d92dbae14b96f4851d1b47d2d6fe51c1a0d`、repo digest `sha256:3ed98443660ff48413b5af19ecefce3b9d50845a901a43420d47cc63a9fddbe9`。一次性容器共享隔离 PG 的网络命名空间，`--rm --pull=never --read-only --cap-drop ALL --security-opt no-new-privileges`，非 root 用户、只读挂载测试制品；未发布 PG 端口。
- 测试入口 `tests/integration/api/postgres-transition.pg.ts` 使用真实 `pg.Pool` 调用内部 `recordKnowledgeTransition`。普通 `npm test` 不包含 `.pg.ts`，运行需显式设置 `WORKBENCH_PG_TEST=1`、固定的 `workbench_p0_runner` 角色和预期数据库版本。迁移来自仓库 `apps/api/migrations/001_knowledge_transition_outbox.sql`，只在每项测试新建的随机 `p0_test_*` schema 内执行。
- Mac 本地打包的制品 SHA-256 为 `612d5416bcd47010a02788225827bd48c0310eeef87ba148ab20ab53f7a8d948`；测试脚本及原迁移在包内分别为 `407a2776e65c8178fc010de5d1557d88611d66b117bd8f0504c7954802e8a313` 和 `7ea92639bf56009c3f50c182f4f27c3ae8f47824b7772bea588d4872f4710d5f`。服务器执行块先核对制品、容器、镜像、目标库、公有 schema 表数和测试角色不存在，再创建受限 `workbench_p0_runner`（`NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT CONNECTION LIMIT 6`，仅向 `workbench_p0` 授予 `CONNECT, CREATE`），对包内两份文件再次核对哈希后运行。用户回传“制品、容器与数据库预检通过”、`CREATE ROLE`、`GRANT`；没有提供服务器端 archive 哈希的单独输出，但执行块的哈希断言已通过。tar 的 macOS 扩展头警告不影响执行。

## 用户回传的测试结果

`node --test` 输出 **4 tests / 4 pass / 0 fail**：

1. 从仓库迁移创建表，`pg.Pool` 提交 transition；关闭父连接池后由独立 Node 子进程重新连接，读回状态 `candidate`、state_version 1，以及 event/outbox 各一条。没有重启 PostgreSQL 容器。
2. 跨团队的 principal 和数据库中已撤销的角色绑定均被拒；没有写入 event。
3. 独立连接在行锁上等待、同一命令的并发重试串行化为一次写入及一次 replay；变更 transition ID 的同幂等键请求返回 conflict，outbox 仅一条。
4. 在临时 schema 中为 outbox 注入触发器故障，内部事务返回 database 错误，状态保持 `captured` / state_version 0，event/outbox 均为零。

测试结束时读回 `remaining_test_schemas|0`。随后用户只读核对测试角色：`LOGIN`、非超级用户、不可建库/角色、不可复制、`NOINHERIT`、连接上限 6，`CREATE` 授权存在；活动连接 0、测试 schema 0、`public` 表 5，只有一项数据库级授权依赖。用户在校验目标库、角色属性/口令为空、会话/schema/角色成员关系及该唯一依赖后，于同一事务中撤销该临时角色对测试库的权限并删除该角色；回传事务提交成功，最终 `runner_remaining|0`、`test_schemas_remaining|0`、`public_tables|5`。这证明测试角色及其授权已定向清理，且临时 schema 不再存在。随后用户在服务器终端对测试归档执行普通文件、非软链接及 SHA-256 匹配检查，条件成立后删除该归档，回传“测试归档已清理”；未另行做删除后的独立目录读回。拉取的 Node 镜像及本机 `.tmp` 制品未纳入这次清理。

## 信任与验收边界

- 隔离测试库的本地连接采用无需密码的认证方式；没有验证口令。角色名称及数据库权限隔离的正向测试不等于安全认证测试。测试角色及其数据库级 CREATE 权限已按上述读回定向撤销；该隔离库的认证边界和制品/镜像生命周期仍需单独处理。
- principal、资产快照和 evidence verifier 均为合成测试输入，未接入可信 DSH 身份、真实资产来源或 Provider；撤权仅覆盖事先删除绑定后的拒绝，没有证明并发撤权竞态。独立 Node 子进程读回不是 PostgreSQL 重启、数据库备份/恢复或 Worker 恢复。
- 本地 Node v24.22.0 验证：`npm test` 18 files / 159 tests、`npm run typecheck`、`npm run build`、`git diff --check` 通过。这些测试和云端 TAP 是不同证据；仓库当时有既有未提交改动，测试脚本和相关 PG 基础文件也未提交，不构成已发布制品的来源认证。

判定：真实 PG 应用事务这一子路径已取得隔离合成数据验证；P0-14 保持 `partial/blocking`，P0-17 保持 `missing/blocking`，P0 overall 保持 `no_go`，真实资产写入仍禁止。
