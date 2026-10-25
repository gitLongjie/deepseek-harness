---
description: "geo 能力族的包映射：面向模型的深度云海 GEO 多站点内容后台工具，以及它们读取的设置命名空间与凭据引用。"
kind: "package-group"
---

# geo/ — GEO 内容后台能力族

[English](README.md) | 中文

## 概述

`geo/` 的包把 agent 接到深度云海 GEO 多站点内容后台。这一族拥有面向模型的 `geo_*` 工具（站点、文章、栏目）、给后台与发文账号命名的 `geo-admin` 设置命名空间，以及这些工具每次调用都会解析的 `GEO_ADMIN_PASSWORD` 凭据引用。权威仍在后台一侧：登录账号的权限决定工具能读什么、能改什么。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 角色 | ctx 键 |
|---|---|---|
| [`tool-geo-admin/`](tool-geo-admin/README.zh.md) | 暴露站点、文章与栏目工具；其 `./settings` 宿主入口注册 `geo-admin` 设置命名空间 | 注册到 `ctx.tools`；发布 `ctx.geoAdminSettings` |

-----

<a id="related-documentation"></a>
## 相关文档

- [工具目录](../../docs/tool-catalog.zh.md) — 每个面向模型的工具及其 schema。
- [`tool-geo-admin/`](tool-geo-admin/README.zh.md) — `geo-admin` 设置字段与凭据引用。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
