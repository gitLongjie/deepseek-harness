---
description: "面向模型的深度云海工具（站点、文章、栏目）及其读取的 geo-admin 设置命名空间与凭据引用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-geo-admin

[English](README.md) | 中文

## 概述

`@deepseek-ai/dsh-tool-geo-admin` 给模型一小组有类型的接口，用来操作深度云海（GEO 多站点）内容后台：站点、文章（读、建、改、删）、栏目、GEO 关键词任务（列表、重试）、品牌可见度报告（列表、读取、发起生成、跟进任务）。每次调用都用 `geo-admin` 设置命名空间里配置的账号登录；密码存放在凭据存储的 `GEO_ADMIN_PASSWORD` 名下、每次调用时解析。本包同时提供注册该命名空间的宿主行。

## 目录

- [使用本包](#use-this-package)
- [工具](#tools)
- [设置与凭据](#settings-and-credentials)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

## 使用本包

包有两个入口：

- `.`——面向模型的工具。预设把它和 persona 挂在一起；工具注册进该会话的 `tools` 注册表。
- `./settings`——注册 `geo-admin` 命名空间并发布实时视图的**宿主**行。`settings.register` 是每进程一次的所有权注册，预设绝不能挂它。

```yaml
- id: geo-admin-settings
  name: '@deepseek-ai/dsh-tool-geo-admin/settings'
  config:
    baseUrl: http://localhost:8001
    username: article-bot

- id: tool-geo-admin
  name: '@deepseek-ai/dsh-tool-geo-admin'
```

组合配置是基础层，设置页保存的值覆盖它。启动环境可以用 `GEO_ADMIN_BASE_URL` / `GEO_ADMIN_USERNAME` 提供这个基值，环境里的 `GEO_ADMIN_PASSWORD` 也满足凭据引用。

## 工具

| 工具 | 作用 |
|---|---|
| `geo_sites_list` | 账号可发布的站点（`id`、`name`、`domain`、`code`、`role`）。 |
| `geo_news_list` | 一页文章，可按站点、栏目、关键词或发布状态过滤。 |
| `geo_article_get` | 按 id 读一篇落库文章。 |
| `geo_categories_list` | 内容栏目，可按站点或关键词过滤。 |
| `geo_article_publish` | 新建文章，再读回落库记录。 |
| `geo_article_update` | 改部分字段（或发布状态），再读回落库记录。 |
| `geo_article_delete` | 删除一篇文章；存在投稿或投放记录时后台会拒绝。 |
| `geo_tasks_list` | 一页 GEO 关键词任务，可按站点、批次、平台、状态或关键词过滤。 |
| `geo_task_retry` | 重试一条失败的 GEO 任务。 |
| `geo_reports_list` | 一页跨站点的品牌可见度报告。 |
| `geo_report_get` | 一份报告：QA 与引用数、QA 窗口、目标品牌可见度分与品牌榜。 |
| `geo_report_generate` | 为某个站点发起报告生成；消耗模型调用。 |
| `geo_report_job` | 跟进一次报告生成任务。 |

新建不会重试：后台的 `POST /api/v1/news` 没有幂等键，盲重试会重复建文章。删除同样不重试：它的拒绝（存在投稿或投放记录）是需要用户处理的状态。

## 设置与凭据

| 字段 | 含义 |
|---|---|
| `baseUrl` | 后台 origin，例如 `http://localhost:8001`。 |
| `username` | 工具登录的账号；需要在每个目标站点上具备 `content.news` 权限，跨站点列报告还需 `geotool.reports.all`。 |
| `GEO_ADMIN_PASSWORD`（凭据） | 该账号的密码。经凭据域存储，绝不写进设置文档。 |

每个请求都拒绝重定向：登录请求带密码、已登录请求带 bearer token，端点被重定向时必须在这里失败，而不是把两者转发到另一个源。

不发布运行时不变式伴生入口：设置注册与会话级工具注册表已经拥有各自的状态，本包没有新增「独立观测会分歧」的关系。

## 模型体验

### 面向模型的契约

#### 模型看到什么

十三个工具只出现在挂载了本包的预设会话里。工具描述写明确认规则（默认草稿、写完读回、不盲重试、发起报告生成消耗模型调用），结果渲染成短文本：站点列表、一页行、单篇文章、带品牌榜的单份报告，或一次任务的状态。缺少部署行、字段未填或未存密码时，错误信息里带「设置 → 插件 → 深度云海」路径，模型可以直接指出该怎么修。

#### Token 影响

每个结果都被产生它的请求限定：一个站点列表、一页行、一条文章摘要、一份报告投影，或一次任务。`geo_news_list` 返回后台的列表投影而不是正文，因此长文章只在模型显式读取时才进入请求；`geo_report_get` 带品牌榜，不带完整诊断正文。

#### KV Cache 影响

无。工具 schema 与结果属于请求内容，适用常规的工具目录缓存规则；密码每次调用解析，绝不进入请求前缀。

## 已知限制与后续工作

- **删除可能被拒绝。** 存在投稿或投放记录时后台会拒绝，工具如实转述原因，由用户决定怎么处理。
- **没有批量操作。** 每次调用只针对一个站点、一篇文章、一条任务、一份报告或一页。
- **列表投影以后台为准。** `geo_news_list` 返回的是后台列表端点投影的列，不是完整正文；`geo_reports_list` 带的是报告行，不是它的诊断内容。
- **报告生成是异步的。** 发起调用只返回任务；`geo_report_job` 报 `succeeded` 之后报告才存在。
- **静态明文。** 密码存放在 harness 凭据存储里，同一 OS 用户（因而 agent 自己的工具进程）可以读到；工具绝不把它的值交给模型。

### 开发备注

工具是后台 `/api/v1` 接口之上的薄 REST 适配层：每次调用都用配置的用户名和每次解析的 `GEO_ADMIN_PASSWORD` 凭据登录，携带得到的 bearer token，并拒绝重定向。`./settings` 入口每进程注册一次 `geo-admin` 命名空间，并发布桌面设置卡片读取的实时视图。
