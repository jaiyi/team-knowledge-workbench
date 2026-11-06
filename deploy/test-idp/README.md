# TEST IdP 模板（不执行部署）

`realm.json` 是 Keycloak 非生产 realm/client 的**无秘密、非可用地址**草案；没有容器、管理员、用户、私钥或数据库连接，也不是已部署 IdP。申请批准 Keycloak 版本/镜像及隔离环境后，在管理员控制台按模板手工配置或审查后导入，先将 `.invalid` origin 替换为唯一获批准的 HTTPS Workbench origin；只允许精确 `https://<origin>/auth/callback`，不要添加 wildcard redirect、HTTP 回调、implicit、password grant、自助注册或服务账户。Keycloak 自身的 HTTPS issuer 应固定为 `https://<批准的 IdP origin>/realms/workbench-test`，配置 `WORKBENCH_WEB_ISSUER` 为 discovery 文档中的精确 `issuer`，`WORKBENCH_WEB_CLIENT_ID=workbench-web`，并核对 JWKS 中的签名算法 RS256、public PKCE client、S256 challenge 和标准授权码流程。Workbench 的 `WORKBENCH_WEB_ORIGIN` 与该 client 的 callback origin 必须相同。

请环境负责人另行审核：TLS 终止与可信 Host/代理头设置，Keycloak 版本与备份、管理权限/密钥轮换、测试用户的私下建立与停用、暴力破解防护、签名密钥托管及恢复。不得把密码、私钥、真实主体 `sub` 或 DB 连接字符串导出到仓库、fixture、包、日志或验收材料。测试 IdP 不等于企业身份体系；浏览器登录也不等于 DSH Host 身份或 WeKnora/Git 授权。

当前配置只是静态契约；实际 IdP 部署、HTTPS discovery/JWKS 读回、回调、PG 预绑定、Secure Cookie 和 DSH 外链点击均 `blocked/not_run`，需各目标环境及操作授权。
