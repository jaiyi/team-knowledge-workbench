# 验证材料

验证材料只回答一个问题：外部平台和依赖在目标环境中实际证明了什么。

它们不能定义产品范围、替代方案主线，也不能把“架构上可行”写成“已经集成”。特别要区分：

- **Skill 管理是本项目的核心产品能力；**
- **SkillHub 自动注册、分发和晋升是其中一种待验证实现能力；TeamAI 是另一种可复用的分发/本地同步实现候选。**
- **TeamAI 不是本项目的首期硬依赖；它的价值在于多人 dsh 配置同步、版本一致性、新人接入、回滚和跨团队 Agent/Skill 复用。**
- **Plugin 管理是双资产稳定后的长期扩展能力；**
- **Plugin/tool 扩展、注册、安装和权限治理是待验证实现能力，不属于首期硬依赖。**

即使 SkillHub 或 TeamAI 自动化不可用，也必须通过 Git/CI、管理员发布和 DSH 非生产 profile 保证 Skill 管理闭环可运行。

## 使用规则

每个验证项记录：目标版本、部署环境、测试样本、运行命令、预期结果、实际结果、失败路径、证据位置、owner、日期和下一步。验证证据还必须绑定 `experiment_id`、不可变 commit 或制品 digest、fixture digest、实际 read-back、复核人和证据自身 digest；只有完整证据才能进入 `confirmed` 或 Go 判断。

验证结论分为：

- **已确认**：有源码、官方 API 或可重复运行证据，并明确目标版本、环境和适用范围；
- **待验证**：架构上可行，但目标版本或部署环境未证明；
- **人工 fallback**：自动化接口未确认，先由管理员操作；必须记录操作人、原因、source commit、package digest、target、profile 和审计；
- **契约已验证**：fake/provider contract、状态机、权限、幂等、read-back 和失败路径已通过，但不代表真实 Provider 已接通；
- **真实已验证**：目标版本、目标环境和真实 Provider 完成操作及最终状态 read-back；
- **阻塞**：存在未解决问题，当前不能进入对应阶段；
- **不建议依赖**：当前证据不足或风险不适合首期。

Provider 另记录：

```text
provider_mode: fake | admin | real
integration_status: pending | blocked | fallback_only | contract_verified | real_verified | deprecated
```

`fallback_only`、`contract_verified` 和 `real_verified` 不能混用。fake/admin 结果不得对外表述为真实 Provider release、distribution、installation 或 loaded。没有完整证据的项目只能保持 `pending`、`fallback_only`、`contract_verified` 或 `blocked`，不能标为生产就绪。

## 材料

- [平台与 Provider 能力验证](./01-平台与Provider能力验证.md)：Git、WeKnora、DSH、SkillHub/TeamAI 分发、Plugin/tool loader、MCP 和安全实验
- [DeepSeek Bot 能力评估](./02-DeepSeek-Bot能力评估.md)：Bot/Group/Memory 的源码事实和可选 PoC
- [DeepSeek Harness 能力验证](./03-DeepSeek%20Harness能力验证.md)：官方 Web UI、Workspace、Session、Plugin/Skill Provider 和发布交接的能力边界
- [DSH Desktop Workbench 落地与多团队部署验证](./04-DSH%20Desktop%20Workbench落地与多团队部署验证.md)：Workbench Plugin 市场、团队资产隔离、腾讯云非生产部署和 Git↔WeKnora 结构映射
- [DSH Plugin 开发与安装契约验证](./05-DSH%20Plugin开发与安装契约验证.md)：官方契约取证、Bundle 构建、fresh profile 安装、重启、读回、端到端功能和回滚门禁

## 与方案的关系

方案中的阶段和 Go/No-Go 是权威入口；验证材料只提供证据。验证结果改变方案时，必须回到[方案总览与关键决策](../方案/00-方案总览与关键决策.md)更新决策，而不是在验证文档中暗中改变架构。
