# DSH Desktop 0.2.0-rc.2 通用 Client UI 扩展契约（2026-10-19）

> 只读取本机安装的 DSH Desktop 随包文档与内置插件；没有修改 Desktop、安装 Workbench 新产物或读取用户 profile。本记录证明目标版本存在通用 client 插件入口和本地代码的实现依据，**不证明** Workbench client 已在 Desktop 加载或 UI 已显示。

## 目标版本与证据来源

- `/Applications/DeepSeek Harness.app/Contents/Info.plist`、`app.asar` 内 `dsh/package.json` 和 `dsh/node_modules/@deepseek-ai/dsh/package.json`：版本 `0.2.0-rc.2`。
- 以下路径均相对于 `app.asar`，不是本仓库提供的第三方 API 类型声明；随包没有对应 `.d.ts`，本次仅按随包 README 和已编译内置插件实现核对，并通过本地行为测试约束生成内容。

| 出处 | 版本匹配的事实 | 本地实现 |
|---|---|---|
| `dsh/node_modules/@deepseek-ai/dsh-client-modules/README.md:28-50` | `dsh.client.platform: web`、`exports["./client"]` 指向已构建 browser bundle；外部非 baseline module 需声明 `dsh.client.external`；宿主不替插件编译源码 | manifest 增加 `./client`、`platform`，直接生成目标 loader 格式的 client JS；只使用宿主 baseline React |
| `dsh/node_modules/@deepseek-ai/dsh-client-ui-plugin-manager/package.json`、`lib/client.js:1-12,3652-3673,3712-3775` | 内置插件 bundle 使用 `window.__ModuleLoader__.load({ id, factory })`，导出 `inject`、`apply(ctx)`；通过 `ctx.slots.inject('main', …register({name:'main',key}, Component))` 和 `ctx.slots.inject('sidebar.panellist', …register({name:'sidebar.panellist',id,label}, Icon))` 注册；该内置插件声明对 layout/sidebar 的 client 注入 | 按相同 loader 形状、slot 名称和同一 panel id 生成最小面板及侧栏图标；不依赖内置插件的私有 UI 组件 |
| `dsh/node_modules/@deepseek-ai/dsh-client-ui-layout/README.md:30-32`、`dsh/node_modules/@deepseek-ai/dsh-client-ui-sidebar/README.md:36-38` | `main` 是全局 keyed slot；侧栏 `sidebar.panellist` 与同一 id 的 main panel 对应，点击侧栏可选择面板 | 身份 `team-knowledge-workbench` 是两处一致的 panel id |
| `dsh/node_modules/@deepseek-ai/dsh-client-ui-slots/README.md:26-46`、`dsh/node_modules/@deepseek-ai/dsh-client-ui-plugin-manager/README.md:96-100` | `ctx.slots.inject` 随 slot 声明、注销与 teardown 注册；未声明 slot 的直接 register 可能失败 | 不自行注入 DOM、不调用 `desktopWorkbenches.register`，依宿主 slot 生命周期注册 |

先前 `docs/验证/04-DSH Desktop Workbench落地与多团队部署验证.md:21-36` 引用另一个源码 commit `115a0b474cc2c4794316171c640a8898398591fe` 的 `desktopWorkbenches.register`；未在本机目标 `0.2.0-rc.2` 随包证实该专属接口，**不能**把它移植成本次实现契约。当前只使用通用 panel，并不宣称进入 Desktop 的 Workbench Market 或 Session ownership。

## 本地结果与待验证项

- `tests/contract/workbench-package-fixture.test.ts` 执行生成的 client bundle factory，核对 manifest、slot 名称、同一 panel id、组件输出、明确“未验证”状态；builder 的 artifact digest 自检覆盖实际 client payload。Host entry 与 runtime identity 不变。
- 本地生成的最小 UI 显示包身份、`v0.1.0` 与“状态：未验证”，不调用后台 `/healthz`，也不展示未经验证的 ready/healthy 状态。
- `npm run package:workbench` 本地自检通过：标注的 source commit 为 `1c030bee4a98723d2461ccd3254245a3d8338496`，新 artifact digest 为 `sha256:aa42cf1f9bb03e955b54efebaf9d3b22ba917d70fdc8fd2cfb398057d6148653`，evidence level 仍为 `pending_checks`。source commit 只是 Git HEAD，构建工作树含未提交改动，**不是**当前 UI 源码的可重现 Git provenance；宿主也未读回该 digest。
- 新 client artifact 的 digest 与此前 **Host-only** Desktop 实验的 digest 不同；历史证据 `05-DSH-desktop-host-smoke.md` 的 digest 仅指历史产物，不能复用为新 UI 宿主读回。
- 仍缺 Desktop 对新 client 的安装、重启加载、侧栏/面板实际显示及版本读回，缺 teardown/disable、卸载残留和 rollback 验证。下一次修改当前 profile 或重启 Desktop 需单独取得授权；在此之前 P0-07 仅为本地 contract partial，P0 overall 为 `no_go`。
