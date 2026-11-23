# WeKnora 企业身份与访问路径决策记录

> 状态：已只读核对公开上游 [`Tencent/WeKnora` v0.8.3](https://github.com/Tencent/WeKnora/tree/v0.8.3)（tag commit `3e22822c1d2397be730c458c7539d0eb8c113a24`），**实际测试部署的配置和权限正反例仍 `not_run`**；不构成 T07/T23 放行。关联：[T07/T23 任务草案](./04-P1及后续纵向切片工程设计.md)、[Provider 就绪盘点](./evidence/20-P0-provider-cloud-readiness-inventory.md)。本记录不读取凭据、不登录目标或假定需要 fork WeKnora。

| 路径 | 本次决策 | 仍须核实的目标版契约 |
|---|---|---|
| **人员 UI SSO** | 企业成员直接进入 WeKnora UI 的登录/账号关联独立评估；上游 v0.8.3 **已有可配置 OIDC 登录**、浏览器回调和本地会话发行；Workbench T29 的 OIDC 会话不自动成为 WeKnora 会话。尤其上游当前用 email 查找已有本地用户，不能将其视为符合 Workbench `(issuer,sub)` 稳定绑定的自动合并安全证明。 | 核目标部署是否启用、issuer/JWKS／UserInfo 策略与企业身份字段；审查 email 匹配／开通、账号变更、登出／撤权传播，以及原 Wiki 深链在当前人员登录后的权限表现。不能因上游实现存在就宣称部署已接 SSO。 |
| **Backend 服务身份** | 上游 v0.8.3 已实现可撤销／过期的 tenant／platform API key 与按 KB 限制的能力；Workbench Backend 应优先评估**独立 tenant scoped key**，固定空间／知识库与操作，经受控 Secret Manager 引用，避免跨租户 platform key；不把服务凭据送往成员设备、renderer 或链接，也不以服务身份冒充当前人员。每次请求先按 T29/T07 当前主体、成员、空间、资源与对象授权。 | 在获准部署核实 key 的实际权限、KB allow-list、只读路由和日志／轮换。上游平台 key 可选工作空间而 tenant key 不可跨 workspace，不把 API key 的 tenant 身份误认为 Workbench 人员成员资格。连通 HTTP 200 不等于获权。 |
| **ACL／直连访问** | 上游 v0.8.3 对 KB 查询有逐 KB **检索前授权检查**、跨组织共享与 API key KB 限定，文档读取沿其 KB 检查；本轮未发现独立于 KB 的**逐文档授权规则**，不能用 KB ACL 冒充来源／文档级 ACL。Workbench 受控内容阅读逐请求核资源 ACL；跳转原 Wiki 页是另一个访问入口，须由目标自身对当前人员核权；若直链或服务身份范围超出已批准对象，不开放该路径。 | 在固定非生产目标分别验证 A→A、B→B、跨空间／伪造 ID／撤权后拒绝、精确页面 ID／版本／URL、深链失效与删除；单独确认逐文档来源权限若为产品需求是否需要隔离 KB 或补充实现。源码表明 KB 检查存在，不等于目标部署启用 RBAC 或 Provider 实际负向读回。 |

固定上游源码依据（均为 v0.8.3 tag，**仅源码事实**）：`internal/config/config.go:317-330` 有 OIDC 配置；`internal/application/service/user.go:481-563` 的 OIDC code 交换后按 email 查用户／新建并发行本地 token，`internal/handler/auth.go:417-495` 处理 state 与回调，`internal/application/service/user.go:1716-1759` 的 JWKS／UserInfo 分支须按目标配置分别核；`internal/types/tenant_api_key.go:14-35,71-112` 和 `internal/middleware/auth.go:371-439` 定义 key 范围及 workspace 选择；`internal/application/service/knowledgebase_search.go:158-197` 与 `internal/application/access/knowledgebase.go:89-155` 体现检索前 KB 鉴权，`internal/types/knowledge.go:164-250` 未显示独立文档 grant 字段；`internal/application/service/tenant_member.go:390-467` 的成员移除存在 best-effort 会话撤销，不能据此推断 IdP 远端撤权即时同步。未证实通用 auth provider 插件接口，也不应将是否需要 fork 提前定论。

下一动作：我们核定企业身份字段及是否允许 email 匹配；与实际 WeKnora 资源／部署权限责任方确认目标配置、非生产 A/B 归属、只读 key 和实验授权，再分别按三条路径取脱敏正反向读回并记录版本、责任方和撤权时限。若必要的逐文档 ACL／远端 IdP 撤权能力经实测仍缺失，先评估空间／KB 边界与受支持扩展，无法满足时才提出最小定向修改及升级／回滚成本；不预设 fork 或部署结论。真实团队写入仍受 T29/T07/T08 完整身份、ACL、隔离、撤权与恢复门约束。
