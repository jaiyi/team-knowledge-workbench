# Security Boundary

工作台在边界处校验用户输入、provider 响应、资产版本和权限。任何跨 workspace 访问、无 approval 的高风险动作、Secret 出现在日志/trace、路径穿越或状态未知都必须拒绝或进入人工对账。

外网机器和内网环境之间只允许脱敏/公开样本同步；不自动同步生产凭据、敏感正文或高风险工具。
