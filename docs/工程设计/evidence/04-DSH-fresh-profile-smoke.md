# DSH fresh-profile smoke 证据（Host-only）

> 本文件记录一次隔离的 DSH CLI Host-only smoke，不是 DSH Desktop 安装成功声明，也不是 Knowledge、SkillHub、Harness、Provider 或业务成功声明。
>
> 所有路径均为实验临时路径；现有 `~/.dsh/profiles/web` 未作为目标且未被修改。

## 固定身份

```yaml
dsh_cli_version: 0.2.0-rc.2
dsh_desktop_version: 0.2.0-rc.2
node_version: v24.13.0
os: macOS
profile_type: fresh
provider_mode: fake
backend_mode: local
client_ui: not_verified
```

## 实验步骤与结果

| 步骤 | 结果 | 说明 |
|---|---|---|
| local artifact build | passed | `npm run package:workbench` 生成并自校验 manifest/payload/artifact digest |
| fresh isolated DSH_HOME | passed | 使用 `/tmp` 下独立 `DSH_HOME` 和 `workbench-smoke` profile；不接触 `~/.dsh/profiles/web` |
| local bundle install | passed | 通过 `dsh plugin --profile workbench-smoke add <local-artifact>` 安装；使用官方 `dsh.bundle.patch` bundle 结构 |
| composed config read-back | passed | `dump-config` 读回 `team-knowledge-workbench` entry 和 `@local/team-knowledge-workbench` bundle |
| CLI profile start | passed | DSH CLI 进程以退出码 0 结束，无 stderr 错误 |
| `apply(ctx)` execution marker | passed (CLI host lifecycle) | 最终 bundle 的 `index.js` 调用 `workbench-host.js`；其 lifecycle 适配使用 DSH `ctx.provide`/`ctx.effect` 契约。以独立 `DSH_HOME` 启动 CLI profile 12 秒，stderr 为空；这证明 entry 未触发启动错误，但不是 Desktop load report |
| identity/version/digest host read-back | partial (CLI config read-back) | `dump-config` 读回 `package_identity`、`package_version`、`source_commit`、`runtime_identity_digest`；完整 artifact digest 仍只在本地 manifest，未获得宿主 read-back |
| backend health | not_verified | 本次未把 `/healthz` 接入宿主；服务可访问不等于 package integration |
| client/UI | not_verified | 未实现或猜测 DSH client slot |
| disable | not_verified | 未进行当前 profile 的 live disable read-back |
| uninstall | not_verified | 未进行 bundle removal 后的完整残留扫描 |
| rollback | not_verified | 未执行旧 digest/空 profile 回滚 |

## 失败/修正记录

第一次直接把 manifest/payload 目录作为 DSH dependency 安装，DSH 报告无法解析 bundle；该失败确认 DSH 目标安装物必须是带有 `package.json`、`exports` 和 `dsh.bundle.patch` 的 Host bundle，而不是 Workbench artifact 目录本身。

随后使用相同 artifact 生成的内容补齐官方 bundle manifest：

- `type: module`；
- `exports: { ".": "./index.js" }`；
- `dsh.bundle.patch: ./cordis.patch.yml`；
- patch 使用 `- insert`、唯一 `id`、package `name` 和 Workbench runtime identity config；
- `index.js` 导出 `apply(ctx, config)` 并调用 bundle 内的 Workbench host adapter；
- `source_commit` 当前来自本地 Git HEAD，未经过签名或远端 provenance attestation；
- host adapter 使用实际观察到的 DSH `ctx.provide`/`ctx.effect` 生命周期形状，避免把不存在的 `ctx.register` 假设为官方 API。

该修正后的本地 bundle 可被固定版本 DSH CLI 安装，`dump-config` 可读回 bundle row 和 Workbench runtime identity；独立 profile 启动期间 stderr 为空。由于没有 Desktop 宿主级 Workbench identity/readiness/digest/lifecycle read-back，本次只提升 DSH CLI 基础 bundle loader 与 entry 启动证据，不提升为 `real_verified`。

## 当前决策

```yaml
workbench_product_package_decision: no_go
reason: >-
  CLI Host-only bundle install/config/start smoke passed, but apply execution,
  host identity/version/digest read-back, Desktop restart/load, UI, disable,
  uninstall and rollback are not verified.
p0_overall: no_go
p0_transition: allowed_with_no_go
p1: not_started
```

## 下一步

1. 将本次 bundle loader 事实和失败/修正记录同步到 P0 详细设计与当前状态文档；
2. 增加对官方 bundle manifest、`dsh.bundle.patch` 和 `- insert` registration 的 contract regression；
3. 在具备可观察的 Host registration/readiness read-back 后，再执行真实 Desktop fresh profile 安装、重启、load、disable、uninstall、rollback；
4. 在 P0 状态最终明确前，不启动 P1。
