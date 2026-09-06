# Agent Note: 插件市场能力

Status: implemented

[English](2026-09-04-plugin-market-capability.md) | 中文

## 问题

安装插件需要用户知道 npm 包名并手动运行 CLI。浏览 Web GUI 的用户没有任何发现入口:无法看到存在哪些插件、每个插件安装什么、候选包是否可安装。桌面发行版放大了这一点——成品产品需要策划过的、可搜索的目录,而不是包名口口相传。

安装路径本身已经存在且可信:`dsh plugin --profile <name> add` 经 profile 包管理器变更 profile 的 `dsh.profile.bundles`,以 profile manifest 为唯一事实。天真地复用不受信任的目录会把提供方控制的包名与版本送进该命令。

## 决策

市场是一个三角色的能力 seam。`dsh-market` 在 `ctx.market` 上定义抽象 `Market` 服务;`dsh-market-local` 实现它;`dsh market` CLI、`dsh-market-gateway` Typert remote 与 `ui-settings-market` Web 标签页消费它。消费方不持有任何 npm 知识:它们提交不透明的品牌化 id,包名、版本与命令全部由服务自行解析。

三条边界承载信任模型:

- **npm 注册表是唯一版本权威。** 可安装性要求恰好一个声明的 npm 包,其注册表 `latest` manifest 携带相同名称、确切稳定版本,并声明 `dsh.bundle.patch`。目录条目的 `npmPackage` 与 `latestVersion` 只是展示性声明,绝不是命令输入。
- **提供方载荷被校验、归一化并封顶。** zod schema 限制响应大小、条目数与请求时间,从投影条目中剥离提供方载荷字段,并在展示文本抵达客户端之前拒绝控制字符与双向覆盖字符。已观察条目缓存是通往安装的唯一路径:来源未归一化的条目无法安装。
- **安装运行既有的 profile 机制。** 服务解析确切版本,在 profile 目录以该版本运行 pnpm,并调和 `dsh.profile.bundles`,因此市场安装与 `dsh plugin add` 无法区分,并在下次宿主启动时激活。已安装视图只读取 profile manifest,因此每条安装路线都会出现在其中。

目录来源是用户配置的记录,存于 `<dsh home>/market/sources.json`——这是开放契约,不是硬编码的商店。随附两种传输 kind:`catalog`(标准 dsh 目录端点,服务端分页,manifest 固定在其源内)与 `store-v1`(DSH 1024Store 有界投影,按缓存生命周期拉取一次并在客户端过滤)。全新 home 播种内置的 DSH 1024Store 来源并预选。

## 已考虑的替代方案

**信任目录声明的版本并直接安装。** 否决:那会把命令输入交给不受信任的提供方内容。注册表重新解析只花一次有界请求,就关闭了这个缺口。

**在本仓库内建一个专属插件商店服务端组件。** 当前否决:来源注册表契约使客户端与来源无关,任何目录端点都能服务而无需 DSH 运营的商店;`catalog` kind 就是该契约的第一个方言。

**GUI 管理来源编辑。** 延后:来源记录少且很少变更,因此 CLI 拥有添加/删除/命名,Web 标签页只在它们之间切换。网关与标签页因此无需承担写侧校验工作。

## 后果

`dsh-market-local` 拥有有界 HTTPS 传输(大小上限、超时、一次重定向)、带 TTL 的单来源已观察条目缓存、npm 注册表读取与 profile pnpm 运行。其 Config 暴露这些界限(`requestTimeoutMs`、`maxCatalogBytes`、`maxCatalogEntries`、`cacheTtlMs`、`pnpmTimeoutMs`、`maxOutputTailBytes`);DNS 在进程之下解析,任何东西都不固定解析地址,因此网络出口管控仍是部署关注点。`restartRequired` 语义精确:bundle 层在下次宿主启动时激活,不存在会话内重载。

Remote 网关以自己的服务 key `marketGateway` 与 wire 命名空间 `market` 注册,镜像 `settingsController`——具体提供方注册 `ctx.market`,两个 key 不得冲突。

## 验证

`packages/market/market-local/tests/` 以 100% 分支覆盖覆盖传输、schema、注册表校验、来源注册表、pnpm 运行(含超时子进程裁定)与已安装视图;`packages/market/market/tests/` 与 `packages/market/market-gateway/tests/` 覆盖服务注册与 wire 投影;`packages/client/ui-settings-market/tests/` 覆盖标签页视图。CLI 表面位于 `apps/cli/src/market.ts`,带自己的测试。
