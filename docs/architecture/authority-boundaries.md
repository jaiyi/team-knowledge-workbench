# Authority Boundaries

| 对象 | 权威位置 | 本仓库职责 |
|---|---|---|
| Knowledge/Skill/Agent Manifest 正式资产 | `team-ai-assets` Git 仓库 | 创建变更、校验、审核、发布编排和归因 |
| Knowledge 索引 | WeKnora | 提交批准版本、读取索引状态和来源 |
| 实际装载 profile | DSH/profile provider | 读取装载版本、权限和运行状态 |
| 分发 | SkillHub/TeamAI/管理员流程 | 记录 package、target、installed revision 和回滚 |
| Plugin runtime | 后续独立能力 | 当前只保留 contract 边界 |

治理闭环决定“什么可以发布”，分发闭环决定“批准版本如何到达目标环境”。二者不能互相绕过。
