# DSH Desktop 当前 profile Host-only 安装/卸载验证（2026-10-19）

> 本记录是已完成实验的脱敏事实摘要；与[先前隔离 CLI 实验](./04-DSH-fresh-profile-smoke.md)分开。本次使用已有 `desktop` profile，**不是** Desktop fresh-profile、Workbench 面板/Client UI、后端健康、真实 Provider、知识发布或云端 Harness 能力验收。插件已卸载；下方的宿主 UI 状态来自用户当场人工读回，不是自动导出的 load report。

## 固定身份与本地产物

```yaml
experiment_date: 2026-10-19
os: macOS arm64
dsh_cli_version: 0.2.0-rc.2
dsh_desktop_version: 0.2.0-rc.2
build_node_version: v22.23.3
profile: desktop (existing; not fresh)
install_mode: local linked bundle
package_identity: team-knowledge-workbench
package_version: 0.1.0
source_commit: 1c030bee4a98723d2461ccd3254245a3d8338496
artifact_digest: sha256:83f4f6f9a98c7f84d64e168849dda74dde92d4263f44f422bb84f66a38bab706
contract_evidence_level: pending_checks
```

本地 `npm run package:workbench` 构建产物自检通过。产物标注的 `source_commit` 来自当时 Git HEAD；没有签名来源证明，也没有验证构建工作树必须干净。完整 artifact digest 来自本地 manifest，**没有从 Desktop 宿主读回**。

## 安装、重启与卸载读回

| 操作 | 实际读回 | 能证明／不能证明 |
|---|---|---|
| `dsh plugin --profile desktop add <local-bundle>` | 安装命令成功；profile 的依赖与 bundle 列表出现 `@local/team-knowledge-workbench`，链接指向实验产物 | 证明现有 profile 的本地安装路径；未证明 fresh-profile 安装 |
| 正常退出并重开 DSH Desktop | 宿主进程重新启动；用户在 Settings → Plugins → Plugin list 看见 `@local/team-knowledge-workbench` v0.1.0，“包含的组件：共 1 个 · 1 运行中”，组件 `team-knowledge-workbench` 显示“运行中” | 用户人工读回证实 Host 插件在 Desktop 重启后运行；不等于独立 Workbench UI、server/client 分项 load report、health 或 artifact digest 宿主读回 |
| `dsh plugin --profile desktop remove @local/team-knowledge-workbench` | 命令成功；依赖、bundle 列表和 lockfile 不再包含该包 | 安装记录已移除，但重启前不宣称运行态已清除 |
| 正常退出并再次打开 Desktop | 用户在同一插件清单搜索，确认“找不到了” | 已验证重启后的插件清单不再显示该组件；未执行独立 disable 或旧版本 rollback |
| 安装前后文件比对 | 原有 `package.json`、`cordis.patch.yml`、`cordis.yml`、`pnpm-workspace.yaml` 最终 SHA-256 各与安装前一致；卸载器留下指向本次临时产物的软链接，核对目标后手工移除；`package.json` 被卸载器删去原有空 `dependencies: {}` 字段，经用户额外明确授权才恢复 | 四份原文件已恢复；不能声称包管理器自动彻底清理。生成的 pnpm 文件/日志未擅自删除 |

本轮没有使用生产凭据，没有在 evidence 中保存 token、完整宿主配置、用户个人会话或本地临时绝对路径。插件清单仅显示 package name/version 和运行组件，并未展示 package artifact digest 或可见 Workbench 页面。验收结论必须区分 `Host-only Desktop load: passed` 和 `P0 Workbench product package: no_go`。

## 未验证与下一步

- 目标 DSH 版本的官方 Workbench client/UI extension point、真实可见面板注册及 UI 读回；当前 client entry 是占位符。
- 独立 Desktop **fresh profile** 安装/重启、server/client 分别的 load report，宿主对 package identity/source commit/**完整 artifact digest** 的读取和核对。
- 宿主连接 backend `/healthz`、degraded/unknown 失败表现；真实 disable/read-back/取消语义；从旧 digest 或空 profile 的**可重复** rollback。
- Git/WeKnora/SkillHub/DSH/Harness readiness、隔离恢复与安全硬门禁、腾讯云非生产环境证据；与 Desktop Host 验证分别决策。

本次不能把 `1 运行中` 外推为 UI 已存在、知识/Skill 已发布或 P0 总体 Go。后续实验应在固定版本与目标 profile 上补齐逐项脱敏证据和指定责任人的 Go/No-Go 决策。
