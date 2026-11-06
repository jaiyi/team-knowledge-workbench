# TEST HTTPS 网关模板（非部署）

`workbench-https.nginx.conf` 是不能直接启用的非秘密模板：`.invalid` 域名和 `<approved-...>` TLS 文件路径故意不可用。由实际环境负责人审批公开 Workbench origin、证书链／私钥与代理版本，替换所有域名／路径／loopback 端口后先在隔离目标机执行 `nginx -t`；本地没有 nginx，本票未执行配置语法或 TLS 握手测试。使用默认拒绝的其他虚拟主机，避免未知 SNI/Host 命中这个服务；监听 80 的示例只拒绝，不把明文请求透明转登录页。

网关只代理 `/auth` 和 `/auth/*` 至同机 `127.0.0.1` 的显式 Web 入口；不暴露 `/v1/*`、测试口令登录或内部 PG。Host 强制等于审定公开 origin；以请求头 allowlist 转发必要 Cookie、Origin、Sec-Fetch-*、CSRF，不转发任何 `Forwarded`／`X-Forwarded-*`，包含客户端和前级代理的版本。若有前级代理，须保证它的 Host 和头部边界同样受控；应用端仍会拒绝任何转发头，不能为适配代理放松此约束。HTTPS 证书及终端 TLS 参数、HSTS／HTTP 路由与信任链由实际环境审查后确定。

部署端还须分别确认 PostgreSQL 的 `sslmode=verify-full` 对目标 DNS 与 CA 的真实校验、Keycloak discovery/JWKS 与 PKCE client、实际 Secure `__Host-*` cookie 浏览器行为、失败与撤权路径。此模板的静态断言和 Node 本机 HTTP 测试不证明真实 HTTPS、DSH 系统浏览器或 Web 登录可用；目标结果保持 `blocked/not_run`。
