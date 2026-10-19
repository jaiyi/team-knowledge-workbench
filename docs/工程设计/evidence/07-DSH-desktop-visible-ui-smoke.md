# DSH Desktop 最小 Workbench UI 实测（2026-10-19）

> 本次是现有 `desktop` profile 的安装、正常重启和用户人工界面读回；不是 Desktop fresh-profile、独立机器采集的 client load report、后端健康或 P0 Go。与[先前 Host-only 实验](./05-DSH-desktop-host-smoke.md)和[UI 契约取证](./06-DSH-desktop-client-slot-contract.md)分开记录；先前实验的 artifact digest 不适用于本次。

## 固定身份及安装前状态

```yaml
experiment_date: 2026-10-19
dsh_desktop_version: 0.2.0-rc.2
dsh_bundled_cli_version: 0.2.0-rc.2
build_node_version: v22.23.3
os: macOS arm64
profile: desktop (existing; not fresh)
install_mode: local linked bundle
package_identity: team-knowledge-workbench
package_version: 0.1.0
source_commit: fc3a397f3a64b3f527e29557b800bf32d7377490
artifact_digest: sha256:2e604deab381de1637a029210aa75dfc542848953cf8f7bc6ff99b4a1a979799
contract_evidence_level: pending_checks
```

`feat/p0-desktop-ui-smoke` 上的 UI 实现和此前证据已提交并推送；本次 `npm run package:workbench` 在该提交的干净工作树上构建并通过本地 artifact 自检。`source_commit` 与这次构建的仓库 HEAD 一致，但没有签名 provenance 或宿主对**完整 artifact digest** 的读回。安装前 `desktop` profile 的依赖列表没有 Workbench，原有 `package.json`、`cordis.patch.yml`、`cordis.yml`、`pnpm-workspace.yaml` 的 SHA-256 分别为 `eafc5b4ebc3e702e8aaee00f6012ae1d76ef8ea24b8bbe03a003f369c5d2934f`、`6677ab3a8deb7a45c7252a9be085b7da3dd6411805668d7c3a525b8244fc63b9`、`c300dcf2ebc5f02062d6591268d29d3db6fe45e0cb138f5467276fe2ba06076e`、`ae7c5b68e2f157528e62885804e69e88583897b775e03c86fcbe52feaf498aba`。没有复制完整 profile 配置。

## 安装与读回

| 步骤 | 结果 | 证据边界 |
|---|---|---|
| 本地产物构建和校验 | `npm run package:workbench` 通过；manifest 含 `client/index.js`，本地完整 digest 如上 | 仅本地自检；不是宿主 digest read-back |
| 使用 Desktop 随附 CLI 安装 | `dsh plugin --profile desktop add <local-bundle>` 退出成功；profile 依赖出现 `@local/team-knowledge-workbench`，`node_modules` 链接指向本轮产物，client 文件存在 | 现有 profile 本地链接安装，不是 fresh-profile/市场分发 |
| 正常退出并重新打开 Desktop | Desktop 主进程重新启动；安装链接保持存在 | 不是自动化的 Host/Client 分项 load report |
| 用户实际打开面板 | 用户当场读回 `team-knowledge-workbench`、`v0.1.0`、`状态：未验证` | **本轮最小 client/UI 可见并读回通过**；是用户人工读回，不是截图/自动导出日志，也不代表业务 ready |

当前包仍安装在 `desktop` profile 中，本次没有执行 disable、uninstall、rollback 或额外重启。安装方式是指向本机临时构建目录的软链接；该目录若被系统清理，安装会失效，因此这不是正式持久化分发产物。没有把完整宿主配置、token、用户会话或临时绝对路径保存到证据。

## P0 结论

P0-07 的**最小可见 UI/read-back** 有现有 Desktop profile 的人工证据；状态文案“未验证”是客户端静态标签，不是 backend `/healthz`、身份授权、Provider readiness 或 Workbench 产品健康状态。独立 client load report、fresh-profile 安装、source/digest 宿主读回、失联 degraded、disable、完整卸载及可重复 rollback 尚缺，P0 Workbench product package 和 P0 overall 仍为 `no_go`。后续补项须另行核对用户环境及授权范围，不能从本次可见面板推断通过。
