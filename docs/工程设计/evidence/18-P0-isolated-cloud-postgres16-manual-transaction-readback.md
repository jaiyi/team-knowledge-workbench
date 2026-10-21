# P0-14 隔离腾讯云服务器 PostgreSQL 16 手工读回（非生产）

> 依据：用户在腾讯云轻量应用服务器 VNC 终端执行命令并在会话中回传结果；助手未取得 SSH、数据库连接或独立机器采样。只记录脱敏结构和合成数据，不保存口令、连接串或其他应用数据。此证据不是生产恢复、应用事务或 P0 Go。

## 环境与范围

- 用户确认服务器上原有两套**正在使用的其他测试应用** PostgreSQL。因此没有在其现有数据库中执行测试，也未停止或修改它们。
- 用户在该服务器新建隔离的 `workbench-p0-pg16` 容器和 `workbench-p0-pg16-data` 数据卷；`docker inspect` 人工读回 `status=running network=none published_ports={}`，在容器本地 `psql` 读回 PostgreSQL `16.15 (Debian 16.15-1.pgdg13+2)`。新建 `workbench_p0` 库后读回 `workbench_p0|postgres`，迁移前 public schema 表数为零。容器当前仍保留，尚未做生命周期清理；没有对外开放 PG 端口。
- VNC 方式可用，但当时客户端访问服务器的管理通道持续超时；同步测试窗口的服务器侧排查未观察到请求到达。由此**不能**认为客户端、API 或 Worker 已连接服务器 PostgreSQL；原因尚未定位。用户已提交云服务商人工工单，尚未收到人工排查结论。控制台自助诊断/AI 对网络规则的推测并非已经确认的根因。

## 已执行的数据库检查

1. 用户在上述空库手工粘贴了与 `apps/api/migrations/001_knowledge_transition_outbox.sql` 对应的五表建表 SQL，并附加库名和空 schema 检查，使用 `psql -v ON_ERROR_STOP=1 --single-transaction`。输出一次 `DO`、五次 `CREATE TABLE`。这不是由仓库文件上传或迁移工具执行，未验证迁移文件字节级同一性、重跑幂等或生产发布方式。
2. 用户从该库只读查得表名 `asset_spaces,knowledge_outbox,knowledge_role_bindings,knowledge_states,knowledge_transition_events`，共 **5** 张，外键 **4** 个；未完整比对每一条约束定义。
3. 在该库同一连接内，以合成标识插入 asset-space、角色、Knowledge 状态、transition event 和 outbox，状态从 `captured` 更新为 `candidate`；回读状态/event/outbox 各一条。显式 `ROLLBACK` 后再次回读三者各零条。输出分别为 `before_rollback|1|1|1` 和 `after_rollback|0|0|0`。随后用户独立只读核对五张表的行数，结果 `0|0|0|0|0`。**这是主动回滚，不是注入 outbox 故障、应用代码运行或跨进程恢复证明。**

4. 用户用两个独立 `psql` 连接并发尝试插入相同的合成 `asset_spaces` 主键：第一个事务插入后等待约 10 秒再显式回滚；第二个事务在此期间开始插入，约 9 秒后完成并回滚。用户读回 `first=0 second=0 second_elapsed=9s`，随后独立只读复查该主键的行数为 `0`。这与唯一键冲突等待第一个事务结束的行为一致，但仅验证了数据库主键锁等待及两次主动回滚；**没有执行应用层 transition、idempotency key 竞态、故障回滚或跨进程恢复**。

## 仍须验证

- 在独立 PostgreSQL 上真正执行 `recordKnowledgeTransition` 的 `pg` 客户端路径，连接池、多连接并发、同一 idempotency key 冲突、双团队/空间及撤权竞态；目前的服务器检查仅用 `psql` 手工 SQL，不含应用认证及可信资产来源。
- 失败注入后的原子回滚、进程/容器中断后的 event/outbox 恢复、Worker lease/retry/dead-letter/对账、真实 Provider 最终读回，以及**独立隔离数据**的备份与恢复。禁止用正在使用的两套其他应用 PG 执行恢复试验。
- 真正的迁移文件分发校验、最小权限数据库用户、容器数据卷/口令生命周期、监控、云端网络与密钥边界均未完成；不能将单台轻量云服务器上的隔离测试容器视为腾讯云 P0-17 完成。

判定：P0-14 仍 `partial/blocking`；P0-17 仍 `missing/blocking`（有有限 PG 可行性证据）；P0 overall 仍 `no_go`。
