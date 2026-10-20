# Workbench Host 健康候选产物本地构建记录（2026-10-19）

在干净的 `main`（`HEAD = origin/main = e568514b6e13d1b7937b8c38e4a4c0ebe14f11fa`）运行 `npm run package:workbench`；构建结束后源码工作树仍干净。仓库 API 入口 `apps/api/src/server.ts` 的默认端口是 3000，但可由 `PORT` 覆盖，且没有本次隔离 DSH 环境的固定 API 地址证据，因此**未**传 `--backend-endpoint`，未启动 API/DSH，也未安装或重启 Desktop。此产物的 Host probe 默认返回 `unknown/api-not-configured`；它不能用于证明可达→断连→恢复。后续健康实验须显式指定实际可用的规范 `http://127.0.0.1:<port>` 并重新构建、核对新 digest。

| 本地读回 | 值 |
|---|---|
| 临时产物目录 | `/var/folders/qk/l3898dhj6jb5w0ffg5qjpsgh0000gp/T/team-knowledge-workbench-kNZeVM`（临时路径，后续可能被系统清理） |
| package identity / version | `team-knowledge-workbench` / `0.1.0` |
| manifest `source_commit` | `e568514b6e13d1b7937b8c38e4a4c0ebe14f11fa` |
| manifest `runtime_identity_digest` | `sha256:0fff355f0f913daf272fe0f1e7d84b50c24faa011efb5deaa927c16e911439a6` |
| manifest `artifact_digest` | `sha256:4744f61dc2c757dbfefcfd905f029a567c15892eadea4584d429612fdddd6dc0` |
| 本地 artifact inspection | `passed`；manifest 所列 payload 与实际文件集合一致，各 payload digest 和完整 artifact digest 本地重算通过 |
| manifest `contract_evidence_level` | `pending_checks` |

本地产物含 `client/index.js`、`cordis.patch.yml`、`index.js`、`package.json`、`workbench-host.js` 五个 payload；manifest 分别记录这些文件的 digest。patch 读回包含 identity/version/source/runtime digest，**不含** `backendEndpoint`；完整 artifact digest 仅在本地 manifest，不能声称 DSH Host/Client、Desktop 或用户界面读回了它。以上 `source_commit` 标识构建时的已提交源码；本记录若随后修改但未提交，不属于该产物源码。P0-09 仍为 `partial`，P0 overall 仍为 `no_go`。

后续待办：单独获授权后在隔离 DSH profile 验证真实 Host/Connection 注入、authenticated route 和失联恢复；再单独获 Desktop 安装/重启授权验证 Host/Client 与实际读回。此记录不授予 profile 清理、disable、uninstall 或 rollback 权限。
