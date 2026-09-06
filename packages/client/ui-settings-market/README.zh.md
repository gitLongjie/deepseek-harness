---
description: "Web 设置中的市场标签页：在浏览器里浏览目录来源、查看可安装性，并安装或卸载插件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-market

[English](README.md) | 中文

## 摘要

本包为 Web 客户端的插件设置添加市场标签页:它列出已配置的目录来源,以搜索方式浏览选中来源的条目,展示每个条目经 npm 校验的可安装性,并在受管 profile 中安装或卸载插件。安装与卸载在宿主上执行并在下次宿主启动时生效;标签页报告 `restartRequired` 而不假装支持热重载。来源管理只在既有来源之间切换;添加与删除来源经 `dsh market` CLI 执行。

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

web-app bundle 默认挂载本包,标签页出现在设置的插件区。没有市场提供方的宿主会让每个视图报告其读取失败,而不是隐藏标签页。

### 最小配置

无配置。标签页读取 `market` Remote 命名空间与共享的设置及语言服务。

### 什么会出错

读取失败保持标签页可用:失败的视图显示其错误与重试控件。宿主侧 npm 校验失败的安装会呈现失败消息与捕获的输出尾随。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

宿主半边是空的 `apply`;浏览器半边注册 `settings.plugins.tab` 槽位组件。组件持有三个视图——发现(搜索加条目详情,含可安装性与安装)、已安装(profile 视图与卸载)、来源(列表与切换)——每个视图在激活时经注入的 Remote 面加载,并在列表上方报告成功或失败提示。全部文案经由类型化的 `settings.market` 语言字典路由。

| 文件 | 拥有 |
|---|---|
| `src/index.ts` | 宿主 loader 入口 |
| `src/client/index.ts` | `dsh.client` 注册与 Remote 面绑定 |
| `src/client/MarketSettingsTab.tsx` | 发现、已安装与来源三个视图 |
| `src/client/locales.ts` | `settings.market` 语言字典 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [插件市场子系统](../../../docs/subsystems/market.zh.md) — 标签页背后的市场类型。
- [`dsh-market-gateway`](../../market/market-gateway/README.zh.md) — 本标签页调用的 Remote 命名空间。
- [Slots 参考](../../../docs/subsystems/slots.zh.md) — 设置标签页组合的工作方式。

-----

<a id="model-experience"></a>
## Model Experience

间接生效:经由标签页调用的宿主侧市场服务,由它拥有全部模型侧效果。

#### KV Cache effect

无直接失效;标签页自身不发起任何模型请求。

## 已知限制与未竟工作

<a id="known-limitations-and-deferred-work"></a>

- **来源管理仅切换** — 来源视图只列出并切换选中项;添加、删除与命名经 CLI 执行。
- **没有实时安装进度** — 安装与卸载是单次请求/响应操作;较长的 pnpm 运行受宿主 `pnpmTimeoutMs` 约束,只以最终结果呈现。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>维护者的工作上下文 — 点击展开</summary>

无。

</details>
