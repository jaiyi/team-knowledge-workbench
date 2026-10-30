# DSH Desktop 分项诊断与制品身份只读调查

> 范围：目标 DSH Desktop `0.2.0-rc.2` 已安装 `app.asar` 内的随包 README 和运行时代码，以及此前同一临时隔离 Desktop 的人工读回。本次只读检查随包文件；没有修改 App、隔离 profile 或运行中的实例，没有新建 Client 故障、重试、禁用、卸载或 rollback。源码行为分析不等于隔离 Desktop 当前会话的现场报告。

## 可用入口及其范围

- `dsh-host-plugin-inventory/README.md` 和 `lib/index.js`：`pluginInventory/list` 从 Host Loader 投影条目 ID、模块名、启用状态和当前 root Fiber phase；Settings → Plugins → Plugin list 显示这一点时快照。[已有隔离 Desktop 人工读回](./13-DSH-isolated-desktop-host-inventory-readback.md)确认 Workbench Host 条目“已启用 / 运行中”。该快照没有持久错误历史、Client 独立状态、制品来源或完整 artifact digest/source commit。
- `dsh-client-modules/lib/client.js`：页面的 `ClientEntries.state` 暴露 `{ syncing, failures }`，其中 `failures` 是按 Client 条目 ID 记录的**当前页面同步/重试**错误；`start()` 对初始条目的注释明确将启动激活审计交给 boot caller。`dsh-client-ui-settings-plugin-inventory/lib/client.js` 把该状态经 renderer 注入到 Settings 插件清单，并且只在 `syncing` 或 `failures` 非空时显示同步状态/失败内容；重试按钮会主动执行 `entries.retry()`，本次没有点击。因此这是一条存在的页面级 Client 同步失败展示路径，不是初始 boot 的完整成功/错误报告；没有出现失败提示也不能证明启动历史没有失败。
- `dsh-app-boot/README.md` 描述 Host 启动时的 inactive-entry 审计和失败日志，但上述 Host 清单仍不提供可追溯的完整启动审计。本次没有从当前隔离实例取得独立 Host 初始加载/错误日志或 Client `failures` 快照；此前[重新启用与重启后的人工读回](./15-DSH-isolated-desktop-reenable-restart-readback.md)仅证明 Host 当前运行中、侧栏和面板恢复，不可据此填写分项报告为已验证。
- `dsh-plugin-manager/README.md` 的 `listBundles` / 包详情显示安装包和组件状态及可用的展示 metadata；`dsh-plugin-package-inventory-deepseek/README.md` 的 `dsh_plugin_packages` 只包含包名/版本。已检查的宿主展示/清单路径均没有 Workbench **完整 artifact digest 与 source commit** 的成对读回。先前本地 manifest、自校验、profile 配置及 runtime identity digest 各有独立证据，不能替代 Desktop 宿主读回。此结论限于上述已检查入口，不宣称整个安装包绝不存在其他私有机制。

## 补充：初始启动审计与其他制品指纹入口

继续只读检查目标版已安装的 `harness-node-entry.mjs`、`app.asar` 内 `out/main/index.js`、`dsh-app-boot`、`dsh-client-modules`、`dsh-desktop-log-bridge` 与 `dsh-desktop-workbenches/install-evidence.mjs`，未读取运行日志、会话或 profile，也未操作 Desktop。Host 启动代码可解析并保留结构化启动**失败**，`dsh-app-boot` 对未激活条目发出警告；没有核实到可按 Workbench 条目导出全部初始成功/失败结果的只读入口。Client 初始启动会审计未激活条目，并可能展示启动失败；这不等于已取得当前隔离实例的逐项初始成功/错误报告。Desktop 的日志桥接与 `harness.log` 可能包含敏感会话内容，本次未读取，且无错误日志也不能证明逐项成功。

`dsh-desktop-workbenches/install-evidence.mjs` 的 `v2:` 安装内容指纹与 Workbench 本地 manifest 的完整 `artifact_digest` 不是同一算法或标识；Workbench 生成的配置携带 `source_commit` 与 `runtime_identity_digest`，后者只绑定包身份、版本和提交，不绑定完整 payload。已检查的其他入口仍没有取得由 Desktop 宿主对**已加载包**成对返回的完整 `artifact_digest` / `source_commit`。以上仅是已安装目标版代码的静态核查，不是运行中实例的诊断读回，也不宣称宿主绝无其他未检查机制。

## 结果和下一步门槛

本次**找到页面级 Client 同步失败 UI 的实现入口**，但没有取得当前隔离 Desktop 的 Workbench Client 逐项初始加载/错误报告，也没有取得 Host 逐项启动报告或完整 artifact digest/source commit 的宿主读回。若要补全 P0-05/P0-07，需要目标版本提供明确的 Host/Client 分项加载及错误导出（区分初始启动与后续同步），在隔离实例以只读方式按 Workbench 条目采集；若要补全 P0-02/P0-08，需要宿主针对已加载包返回完整 digest 和 source commit，并与固定制品独立比对。不能通过粘贴未经审查的 DevTools 脚本、读取原始日志中的敏感值或仅复制本地 manifest 来伪造这些结果。

P0-02/P0-05/P0-07/P0-08 仍为 `partial`；P0-14 仍为 `partial/blocking`；P0 overall 仍为 `no_go`。本次没有对真实 Provider、腾讯云或原 Desktop profile 操作。
