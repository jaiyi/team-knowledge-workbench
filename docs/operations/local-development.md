# Local Development

## Prerequisites

- Node.js 22+；
- npm；
- Git；
- 脱敏的 `team-ai-assets` fixture；
- 不需要生产 provider 凭据。

## First run

```bash
npm install
npm run typecheck
npm test
```

本地开发默认使用 fake Git、fake WeKnora、fake DSH 和 fake distribution provider。真实 provider 连接必须通过环境变量注入，并且只允许隔离测试 workspace。
