---
description: "随附的市场提供方：配置目录来源、浏览插件，并通过经 npm 校验的 pnpm 运行将插件安装进 profile。"
kind: "package-reference"
---

# @deepseek-ai/dsh-market-local

[English](README.md) | 中文

## 摘要

`dsh-market-local` 在本机实现市场约定:通过有界 HTTPS 读取你配置的目录来源,对每个候选包执行 npm 注册表校验,再用 pnpm 把解析出的确切版本安装进受管 profile。全新 home 以内置的 DSH 1024Store 来源预选启动,你也可以添加自己的标准 dsh 目录来源。`dsh market` CLI 与 Web 设置页都构建在该服务之上;安装行为等同 `dsh plugin add`,并在下次宿主启动时激活。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [Model Experience](#model-experience)
- [已知限制与未竟工作](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

挂载插件即可;它注册 `ctx.market`,无需其他接线。`profile` 字段默认取启动器的 profile 事实,因此 `dsh` 组合内的挂载管理的就是正在运行的 profile。

```yaml
- name: '@deepseek-ai/dsh-market-local'
```

### 最小配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `profile` | 启动器 profile 事实 | 市场管理的 profile |
| `npmRegistryUrl` | `https://registry.npmjs.org` | 作为安装版本权威的 npm 注册表基址 |
| `requestTimeoutMs` | `15000` | 目录与注册表请求的每次墙钟上限 (ms) |
| `maxCatalogBytes` | `8388608` | 接受的目录响应大小上限 (bytes) |
| `maxCatalogEntries` | `20000` | 单个来源的已观察缓存保留的归一化条目上限 |
| `cacheTtlMs` | `600000` | 来源缓存生存时间 (ms) |
| `pnpmTimeoutMs` | `300000` | pnpm 安装/卸载运行时长上限 (ms) |
| `maxOutputTailBytes` | `8000` | 保留用于失败诊断的进程输出尾随上限 (bytes) |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-market-local)是所有已接受字段的穷尽来源。

### 管理来源

`dsh market sources` 列出注册表,`dsh market source-add --kind catalog --url <manifest URL> --name <name>` 注册标准来源,`source-select` 切换浏览目标,`source-remove` 删除一个。Web 设置页只在既有来源之间切换;添加与删除经 CLI 执行。

### 什么会出错

manifest 端点离开其源、缺失 `/v1/plugins` 或超出响应上限的来源会点名违反的规则并大声失败。npm 校验失败的安装返回点名未满足要求的失败结果;pnpm 失败则携带捕获的输出尾随。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

提供方拥有四个活动部件。来源注册表按操作读写 `<dsh home>/market/sources.json`(目录 `0700`、文件 `0600`),因此所有入口共享一个状态。目录读取跟随来源 kind:`catalog` 来源的 manifest 将端点固定在 manifest 源内并以 `/v1/plugins` 结尾,声明其支持的查询参数与页上限,一次浏览就是一次有界的服务端分页调用;`store-v1` 来源按缓存生命周期拉取一次完整可安装列表,并在客户端过滤、分页与搜索。两种传输用同一组 zod schema 归一化提供方载荷,丢弃或修复缺名的条目,拒绝控制字符与双向覆盖字符,并把已观察缓存按 `maxCatalogEntries` 封顶、按 `cacheTtlMs` 生存。可安装性解析 npm 注册表 `latest` manifest,要求同名、确切稳定版本与 `dsh.bundle` 声明;安装随后以该确切版本运行 pnpm 并调和 `dsh.profile.bundles`;卸载先对照实时 manifest 重新校验回传的 bundle id。超时的 pnpm 子进程拥有失败裁定权,即使它随后报告零退出码。

| 文件 | 拥有 |
|---|---|
| `src/index.ts` | 服务本体:配置解析、来源注册表操作、安装链 |
| `src/sources.ts` | `sources.json` 的读取/变更/持久化循环 |
| `src/catalog.ts` | manifest 发现、分页拉取、客户端过滤、已观察条目缓存 |
| `src/http.ts` | 有界 HTTPS 传输:大小上限、超时、一次重定向 |
| `src/npm-registry.ts` | 注册表 `latest` 读取与确切稳定版本校验 |
| `src/profile-io.ts` | profile manifest 读取、pnpm 安装/卸载运行、bundle 调和、已安装视图 |
| `src/schemas.ts` | 提供方载荷校验、归一化与来源文件 schema |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [插件市场子系统](../../../docs/subsystems/market.zh.md) — 市场类型与 `ctx.market` API。
- [`dsh-market`](../market/README.zh.md) — 本包实现的约定。
- [`dsh-market-gateway`](../market-gateway/README.zh.md) — 面向 Web 客户端的 wire 投影。
- [Profile 与补丁层](../../../docs/architecture.zh.md) — profile pnpm 运行改写了什么。

-----

<a id="model-experience"></a>
## Model Experience

间接生效:CLI、网关与 Web 消费方拥有目录与安装状态的全部模型侧或用户侧投影。

#### KV Cache effect

无直接影响;本提供方不注册自己的 prompt、工具 schema 或事件载荷。

## 已知限制与未竟工作

<a id="known-limitations-and-deferred-work"></a>

这些是当前的提供方边界,不是任务清单。

- **DNS 先于 TLS 解析,且不固定任何东西** — 目录与注册表请求校验 URL 并限制大小、时间与重定向,但不固定解析出的地址;需要网络出口管控的部署必须在进程之下的层强制执行。
- **Web 来源管理仅切换** — 设置页只在已注册来源之间切换;添加、删除与命名经 CLI 执行。
- **安装等待下一次宿主启动** — 新的 bundle 层在重启后激活;`restartRequired` 恰好报告这一点,没有会话内重载。
- **store-v1 过滤发生在拉取之后** — 完整可安装列表必须装进 `maxCatalogBytes`;更大的上游列表会失败而不是截断。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>维护者的工作上下文 — 点击展开</summary>

无。

</details>
