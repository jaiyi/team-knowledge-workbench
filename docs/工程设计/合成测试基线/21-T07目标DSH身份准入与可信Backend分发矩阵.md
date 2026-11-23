# T07：目标 DSH 人员身份与可信 Backend 分发准入矩阵

> 2026-11-04。仅核对 `/Applications/DeepSeek Harness.app/Contents/Info.plist` 标记的目标 Desktop `0.2.0-rc.2` 随包文档/实现、当前 Workbench 源码与既有设计；另一个 `/Applications/DSH Desktop.app` 是 `0.12.0`，不作为本轮目标。只在内存中检查随包 ASAR，不提取内容、不读取运行会话、token、cookie、凭据或日志，不登录服务器，不安装、迁移或访问真实 A/B 资源。本文是文档能力调查及**待执行验收矩阵**，不是目标身份实测、平台能力不存在的证明或 T07 放行。

目标随包引用位置：`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar!/dsh/node_modules/@deepseek-ai/`，以下 README/source 路径均相对该目录。`dsh-deepseek-account/README.md:10-12,39-40,68,75` 描述 Host-only 的 session 快照及可能为 null/滞后的 `userId`；`dsh-deepseek-account-platform/README.md:12-16,35-45,64-66,93,100-104` 描述仅面向配置 Platform origin 的 grant、profile 快照与本地登出/远端撤销的局限；`dsh-client-connection/README.md:28-29,38-48,75-77` 明言 Host/Origin 信任围栏不建立人员身份。本轮只读的实现定位与文档相符：`dsh-deepseek-account-platform/lib/index.js:587-595,763-785,878-893,924-932` 展示 grant origin 检查、快照及先本地移除再异步远端撤销；`dsh-client-connection/lib/index.js:388-409,585-601` 展示本地根路径 token 换 cookie 与 401/403 拒绝。上述路径和行号仅供目标版复核，均未读取实际会话或密钥。

## 当前可证明的边界

| 线索及版本范围 | 可证明 | 不能据此证明 |
|---|---|---|
| 目标 Desktop `0.2.0-rc.2` 随包 `dsh-deepseek-account/README.md` 所述 Host-only `getPlatformSession()`、可能为 `null`/滞后的 `userId`；`dsh-deepseek-account-platform/README.md` 所述 Platform origin grant/profile 快照（见 [19 身份缺口调查](./19-T07身份缺口与成员资源绑定契约记录.md#身份信任起点目标版调查)） | 随包描述了 Platform 账户与限定受众的会话线索，Platform token 仅用于指定 origin 的 profile/balance 等请求。 | 不构成独立 Workbench Backend 可验证的人员断言或稳定主体映射；不得转发 Platform token、以 userId 字符串代替认证，亦不能推断登出与远端撤权已由 Backend 感知。 |
| 同版随包 `dsh-client-connection/README.md` 所述本地 operator cookie/launch token（见 [19](./19-T07身份缺口与成员资源绑定契约记录.md#身份信任起点目标版调查)） | 本地 Peer/浏览器连接有其自身会话边界。 | Host/Origin 检查或 CLI Web 的 401/403 不等于 DSH 人员身份，更不是跨到 Workbench Backend 的凭据。 |
| Workbench 当前包 `packages/distribution-adapter/src/workbench-package-fixture.ts:9-20,24-48,84-101,124-139`、`packages/dsh-adapter/src/host-plugin.ts:8-15,44-63`、`scripts/build-workbench-package.ts:25-39` | Client inject 为 session controller/UI layout/sidebar；Host `identity` 是包名、版本、源码 commit 与 runtime digest；`backendEndpoint` 是可选的构建/包配置，当前限定本机 `127.0.0.1` HTTP `/healthz` 探针，并返回本机健康状态。 | 包注册不是人员证明；`api-health-reachable`、可选本机地址或 Platform 私有 origin 配置都不是目标环境可信外部 Backend 地址分发、TLS/受众绑定或人员交换。健康探针不能承载个人凭据。 |
| `apps/api/src/server.ts`、`packages/contracts/src/index.ts`、`apps/api/src/application/read-authorized-asset-spaces.ts`（参见 [20 空间枚举记录](./20-T07有权空间枚举与切换隔离契约记录.md)） | 公开 API 仅有 `/healthz`；内部传入 `AuthenticatedPrincipal` 后可对虚构数据库成员和逐空间角色做当前授权交集。 | 内部对象可由调用方构造，无法识别冒充已获权 actor ID；不存在已验证的 `/v1/context` 人员入口或真实成员安装后进入空间的实测。 |
| [方案 11 §3.1、§4、§5](../../方案/11-开发工程设计与集成基线.md) 与 [T07 草案](../04-P1及后续纵向切片工程设计.md) | 规定了预期信任起点、可信地址分发、逐动作重鉴权及待验证字段。 | 拟议机制和验收条款不代表目标宿主提供相应接口或已授权运行。 |

已检查的随包资料**尚未提供**受支持的 Host/Plugin→独立 Workbench Backend 人员证明及可信 Backend 地址/环境分发契约；调查范围不涵盖平台所有私有能力。不得据名称猜测 JWT、签名键、Cookie 转发或自报身份 header；没有平台/安全 Owner 提供的可验证契约时，身份项保持 `blocked/not_run`，不开放 `/v1/context` 或任何真实业务路由。

## 准入与实测矩阵（全部尚未运行）

| 门 | 平台/安全 Owner 需给的固定契约或资源 Owner 输入 | 获批准后的正向及反向读回判据 | 当前结果 |
|---|---|---|---|
| 目标版本与签发机制 | 固定 Desktop/Host/插件版本与 profile；受支持的人员断言签发方、传递路径、签名或其他证明的信任锚，以及 Backend 如何独立验证；声明该机制是否真正对第三方独立服务开放。 | 固定目标上真实人员证明成功验证并只映射一个稳定 `dsh_subject`；无证明、伪造、自报 actor/team/space 和错误签发方均不得获取业务上下文；不将账户 ID 当凭据。 | `blocked/not_run`；缺正式契约。 |
| Backend 地址、环境与受众 | 由受信任安装/部署通道固定 Backend 环境标识、TLS 信任与 audience；说明变更/轮换、目标绑定和客户端所能信任的配置来源。 | 授权目标地址才开始交换；错误服务、环境/audience 不匹配、被篡改或普通成员可改的地址在**发送证明之前**被拒，且没有向错误端泄露人员材料。 | `blocked/not_run`；本机 `/healthz` 不适用。 |
| 生命周期与重放 | 有效期、nonce/挑战或等价一次性重放限制、时钟容差；注销、账户切换、远端撤权通知/查询及最大传播时限。 | 有效首次请求成功；过期、重复、旧设备/旧账户、注销与撤权后的新请求及旧会话后续读取均拒绝；超时/不能核实状态不冒充有效。 | `blocked/not_run`；不能用本地伪串代替真实签发/撤权。 |
| 稳定主体、授权与两空间隔离 | `dsh_subject`→服务端 principal 的唯一、可审计映射及重绑/删除规则；A/B 归属、团队成员/角色与资源 ACL 的 Owner 批准。 | 本人零空间显示未开通与申请途径，身份失败/服务故障分别显示；一个空间可默认，多个须显式切换；每次选取、对象访问及撤权后操作按当前成员、逐空间角色和资源重核；两台独立 Desktop 的 A/B 正反向读回、伪造目标与旧任务拒绝。 | 只有本地虚构授权交集测试；真实身份、双设备及 Provider ACL 均 `blocked/not_run`。 |
| 连接与配置版本 | Git 稳定仓库 ID/受保护 ref、WeKnora 目标版空间/ACL 只读 API 与各资源 Owner 授权；T08 旧版本在途操作及服务身份范围。 | 只读检查 A→A/B→B 与交叉拒绝、停用/轮换/撤权后拒绝；旧 operation 按固定原目标和版本对账，结果不明仍为 unknown，不用新目标盲试。 | `blocked/not_run`；HTTP 200/用户提供 URL、UUID 均非准入证据。 |

**执行顺序与停止条件**：先由平台/安全 Owner 给出目标身份及地址分发契约、验证者与非生产测试许可；只读固定版本文档核对后，再在获准隔离目标逐项运行身份成功/失败/撤权并保存脱敏回执；最后由资源 Owner 独立授权 A/B 正反向资源读回，T08 的在途与恢复另验。任一身份来源、目标地址、撤权机制或授权范围不能可靠核实时，停止真实身份交换和团队资产操作，只保留本地合成契约；不保存原始断言、cookie、完整 session 或 token 作为证据。

状态仍为 `p0_overall: no_go`、`p0_transition: allowed_with_no_go`、`p1: not_started`。no real team-asset writes before trusted identity, ACL, isolation, revocation, and recovery gates; no production credentials, sensitive originals, full Prompts, or sensitive Tool parameters in code, logs, fixtures, bundles, or evidence; no execution of unapproved Skill Drafts outside an approved isolated nonproduction Runner; no promotion of fake/admin or incomplete external read-back to real_verified.
