# Knowledge contract foundation status：readiness-only

## 1. 文档目的

本文记录当前最小 Knowledge contract/state-machine 切片的真实完成范围、验证结果和未完成边界。

当前切片可以作为后续 fake/admin contract 开发的基础，但不能被表述为生产安全边界、真实 Provider 集成或 P0 overall 通过。

## 2. 已实现范围

当前代码已包含：

- KnowledgeAsset、KnowledgeStatus、KnowledgeTransitionCommand 和 transition record contract；
- Zod boundary validation；
- strict Semantic Version validation；
- source/claim/reference 唯一性和关联校验；
- path traversal、explicit undefined 和状态前置条件校验；
- Knowledge 状态迁移和乐观并发保护；
- approval、Git merge、Provider failure、WeKnora read-back、retrieval smoke 和 ACL digest 的结构/一致性检查；
- 深层 clone 和 runtime freeze；
- application boundary 的 raw input parsing；
- verifier 输入隔离、command envelope 完整性检查和 evidence fingerprint attestation 接口；
- AuthenticatedPrincipal、KnowledgeTransitionAuthorizer 和 actor 一致性边界接口；
- unit、contract、integration 测试。

## 3. 当前状态

```yaml
slice: knowledge-contract-foundation
status: readiness_only
provider_modes: [fake, admin]
admin_fallback: permitted
integration_status: contract_verified
real_provider_status: pending
production_authorization: not_implemented
p0_overall_go: not_established
```

`contract_verified` 在本文中只表示本地 contract、schema、状态机和测试可重复通过，不表示 Git、WeKnora、DSH、SkillHub 或其他真实 Provider 已完成集成。

## 4. 已知未完成边界

### 4.1 Principal 尚未连接真实认证

当前 application service 要求调用方传入 `AuthenticatedPrincipal`，并要求 authorizer 返回的 actor 与 principal 及 command actor 一致。

这只是接口边界和测试约束，尚未实现：

- DSH/session credential 验证；
- 服务端 principal 构造；
- team membership 查询；
- role binding 查询；
- asset-space ACL 查询；
- principal 撤权和缓存失效；
- service identity 绑定。

因此，当前不能报告为真实 authentication 或 authorization 已完成。

### 4.2 Evidence attestation 尚未连接真实外部事实

当前 evidence verifier 使用与提交 evidence 绑定的 fingerprint attestation 接口。

该接口用于阻止 command/evidence 被 verifier 悄悄替换，但它本身不证明外部事实。尚未实现：

- Git merge event 接收和签名验证；
- protected ref 查询；
- canonical merge commit 内容读取；
- approval 系统中的 reviewer 身份和权限查询；
- WeKnora operation 查询和 read-back；
- ACL 服务端查询；
- Provider service identity 验证；
- webhook、operation_id 和 correlation_id 的服务端关联；
- 密码学签名、证书链或 Provider-specific proof 验证。

因此，当前不能报告为真实 Git merge verification、真实 approval verification、真实 WeKnora read-back 或真实 ACL verification。

## 5. 允许的后续使用方式

当前切片允许：

- 脱敏 fixture；
- fake Provider contract；
- admin fallback；
- domain/state-machine 演进；
- application boundary 测试；
- Provider adapter contract 设计；
- failure、timeout、unknown、read-back mismatch 和 reconciliation 设计。

当前切片不允许作为以下事项的通过依据：

- 真实团队资产写入；
- 真实 Git merge 或 WeKnora ingest；
- Knowledge production publishing；
- `real_verified`；
- Pilot Beta；
- P0 overall_go；
- 生产部署；
- 安全认证完成。

在 Principal adapter、canonical membership/ACL、Git adapter、WeKnora adapter 和真实 read-back 完成前，任何真实资产链路必须保持 `pending`、`blocked`、`fallback_only` 或 `contract_verified`，不能升级为 `real_verified`。

## 6. 验证证据

当前切片最后一次验证：

```text
npm run typecheck  # passed
npm test           # 5 files, 49 tests passed
npm run build      # passed
git diff --check   # passed
```

代码审查仍要求后续解决 claim/source provenance、canonical asset repository、真实 principal/ACL、Provider evidence authenticity、持久化 CAS/idempotency 和外部错误脱敏；这些不属于当前 readiness-only foundation 的已完成能力。

- command/evidence mutation isolation 已覆盖；
- verifier result runtime boundary 已覆盖；
- raw actor 与 principal/authorizer 的一致性接口已建立；
- 但真实 principal authentication 和真实 external evidence proof 仍未实现。

## 7. 下一阶段入口

下一阶段应先完成设计和 fake contract：

1. FakeAuthenticatedPrincipalProvider；
2. Fake team membership、role binding 和 asset-space ACL；
3. FakeGitProvider；
4. FakeWeKnoraProvider；
5. operation/read-back/reconciliation contract；
6. success、duplicate、failed、timeout、unknown、mismatch 和 rollback 测试；
7. 明确 fake/admin 结果只能是 `fallback_only` 或 `contract_verified`。

真实 Provider 接入仍保留到后续阶段，不因当前 contract foundation 通过而提前放行。
