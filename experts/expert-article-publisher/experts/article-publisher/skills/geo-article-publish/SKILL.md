---
name: geo-article-publish
description: 编写或接收文章并自动发布到 GEO 多站点内容后台（web-admin-go）。Use when 用户提到发文、发布文章、写文章并发布、投稿、把文章发到站点/后台、推送内容到 web-admin-go、批量发文、内容发布 — even if they only say "帮我发一篇"、"写篇文章发上去" or "把这篇文章发到 XX 站点".
---

# 民大工作台文章专家：文章发布技能

把一篇（生成或用户提供的）文章发布到 `D:\Project\GEO\web-admin-go` 这个多站点后台。核心动作：确定输入 → 解析目标站点 → 登录拿 token → `POST /api/v1/news` → 读回校验。接口字段与示例见 [references/api.md](references/api.md)。

## 配置解析（每轮执行前先做）

- 后端地址：环境变量 `GEO_ADMIN_BASE_URL`，默认 `http://localhost:8001`。
- 登录账号：环境变量 `GEO_ADMIN_USERNAME` / `GEO_ADMIN_PASSWORD`，默认读 `D:\Project\GEO\web-admin-go\.env` 的 `ARTICLE_BOT_USERNAME` / `ARTICLE_BOT_PASSWORD`（由 [scripts/setup-account.ps1](scripts/setup-account.ps1) 一次性写入）。
- 优先级：进程环境变量 > `.env` 文件。凭据只用于本技能接口调用，绝不写进文章正文、摘要或日志。

## 工作流程

### Step 1 — 确定输入：收文还是写文

- 用户给了文章（标题/正文/摘要/标签任一项）→ 直接用，缺失字段补全（正文必须有实质内容，不能只补占位符）。
- 用户只给了主题/关键词 → 由你撰写，标题、正文（markdown）、摘要（纯文本）、标签（逗号分隔）一次给全。
- 用户给了本地文件路径 → 用文件工具读出来，再进入 Step 4。

### Step 2 — 认证并列出可选站点

1. `POST {base}/api/v1/auth/login`，body `{"username": ..., "password": ...}`。
2. 成功返回 `access_token` 与 `websites`（每项含 `id/name/code/domain`）；后续请求头统一带 `Authorization: Bearer {access_token}`。
3. 若登录返回的 `websites` 为空，回退 `GET {base}/api/v1/websites`（同样带 token）取 `data` 数组。

### Step 3 — 解析目标站点（多站点）

- 用户指定了站点名/域名/别名 → 在 `websites` 里按 `name`/`domain`/`code` 匹配出唯一 `website_id`。
- 匹配到多个或零个 → 列出候选（id + name + domain）让用户选，绝不擅自猜。
- 只有一个站点时仍需确认一次，避免默认站点漂移。

### Step 4 — 发送

`POST {base}/api/v1/news`：

```json
{
  "website_id": 4,
  "title": "标题",
  "summary": "纯文本摘要",
  "content": "markdown 正文",
  "tags": "标签1,标签2",
  "is_published": false
}
```

- `title` / `summary` / `content` / `website_id` 必填；缺任一字段在发送前停下补齐或向用户确认。
- `is_published` 默认 `false`（进草稿/待审）；仅当用户明确要求"直接上线/立即发布"才传 `true`。
- 可选：`category_id`、`image`、`author`、`source`、`source_url`。
- 正文用 markdown 写，后端会 `RichToHTML` 转 HTML；摘要写纯文本，别塞标签。

### Step 5 — 回执校验

1. 成功响应 `{success:true, data:{id, slug, ...}}`；用 `GET {base}/api/v1/news/{id}` 读回，核对 `title` / `website_id` / 发布状态与发送一致。
2. 汇总输出：站点名、`website_id`、文章 `id`、`slug`、发布状态（草稿/已上线）、下一步建议。

## 硬性要求

- 每次发送前把「目标站点 + 发布状态」跟用户确认一次；发错站点或误上线都不可自行补救。
- 失败要读响应体里的 `message` 如实上报，不静默重试（`news` 无幂等键，盲重试会重复建文章）。
- `access_token` 只在本次会话内使用，不打印、不落盘到文章或笔记。