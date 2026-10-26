---
name: geo-admin-data
description: 查询、核对并修改 GEO 多站点内容后台（web-admin-go）的文章与栏目数据。Use when 用户提到查文章、看草稿、改标题/正文、上线、下线、退回草稿、改栏目、核对发布状态、批量整理内容、操作后台数据 — even if they only say "看看最近发了什么" or "把这篇改成上线".
---

# 深度云海 GEO 专家：后台数据操作

所有读写都走 `geo_*` 工具。工具用「设置 → 插件 → 深度云海」里配置的账号登录，密码保存在 DSH 凭据存储的 `GEO_ADMIN_PASSWORD` 名下。不要在对话里向用户索要密码，也不要拼 HTTP 请求或读后台项目的 `.env`。

## 账号与配置

- 后台地址与账号：设置 → 插件 → 深度云海。
- 密码：同一张卡片写入 DSH 凭据存储。
- 缺配置时工具会返回明确错误（「深度云海 is not configured…」或缺少 `GEO_ADMIN_PASSWORD`）；把设置路径告诉用户，由用户自己填。

## 读操作

### 站点

`geo_sites_list`：返回账号可操作的站点（`id` / `name` / `domain` / `code` / `role`）。用户的站点名或域名对不上时，把候选列给用户选。

### 文章列表

`geo_news_list`，按需组合：

| 参数 | 说明 |
|---|---|
| `website_id` | 限定站点 |
| `category_id` | 限定栏目 |
| `search` | 标题/摘要/正文关键词 |
| `is_published` | `true` 只看已上线，`false` 只看草稿 |
| `page` / `limit` | 翻页 |

返回 `news`（id、title、website_id、is_published、slug、category_id、时间）+ `total`/`page`/`pages`。结果可能分页：总数超过一页时告诉用户还有多少条，不要谎称「全部」。

### 单篇

`geo_article_get`：按 `id` 读落库记录（标题、站点、slug、发布状态）。

### 栏目

`geo_categories_list`：按 `website_id` 或关键词查栏目，拿 `category_id` 供建稿/改稿使用。

## 写操作

### 新建后发布

`geo_article_publish`：必填 `website_id` / `title` / `summary` / `content`（markdown），可选 `tags` / `category_id` / `image` / `author` / `source` / `source_url` / `is_published`。

- 默认草稿；只有用户明确说「直接上线/立即发布」才传 `is_published: true`。
- 新建接口没有幂等键：失败后不要盲目重试，先 `geo_news_list` 用 `search` 查一下是否已经建出来。

### 修改已有文章

`geo_article_update`：`id` + 要改的字段，只改传入的字段。

- 改之前先 `geo_article_get` 读当前值，把「旧值 → 新值」列给用户确认。
- 上线用 `is_published: true`，退回草稿用 `false`。
- 工具会读回落库记录；核对后再汇报。

### 删除文章

`geo_article_delete`：`id`。

- 只在用户明确要求删除**这一篇**时调用；先 `geo_article_get` 确认标题与站点，把「即将删除 id / 标题 / site」再说一次。
- 已有投稿或投放记录时后台会拒绝删除；把拒绝原因原样转述，不要改走别的路径、也不要先改状态再删。

## GEO 任务（关键词问答）

- `geo_tasks_list`：按站点、批次、平台、状态、关键词筛选；每行有状态、尝试次数、最后错误。
- `geo_task_retry`：重试单条失败任务；达到尝试上限时后台会拒绝，如实转述。
- 任务由浏览器客户端执行，状态更新有延迟；重试后不要立刻断言成功，隔一会儿再查一次。

## 品牌可见度报告

- `geo_reports_list`：跨站点列报告，可按站点、状态、来源、生成日期过滤。
- `geo_report_get`：读一份报告——QA 数、引用数、QA 窗口、目标品牌可见度分与品牌榜。
- `geo_report_generate`：按站点发起生成，可给 QA 窗口；**生成消耗模型调用**，先确认站点、窗口与费用再执行。
- `geo_report_job`：跟进生成任务；只有 `succeeded` 才给出报告 id，`failed` 时转述错误原因。
- 跨站点报告接口需要账号具备 `geotool.reports.all` 权限；后台返回 403 时说明是权限问题，请管理员在后台分配，不要改用别的账号或接口绕行。

## 硬性要求

1. 任何写操作前确认「站点 + 文章 + 改动项 + 发布状态」；发错站点或误上线不可自行补救。
2. 删除只在用户点名该文章时执行；账号、角色、权限与站点配置仍归后台管理页面，不在这里改。
3. 付费操作（发起报告生成）先说明成本并得到确认，不静默批量触发。
4. 失败如实上报工具返回的原因，不静默重试、不绕过权限。
5. 不向用户索要、不复述、不落盘密码；凭据只在设置页维护。
6. 汇报用后台自己的字段：`website_id`、文章 `id`、`slug`、`is_published`、报告 `id`、任务 `id`，不要编造页面链接或统计数据。
