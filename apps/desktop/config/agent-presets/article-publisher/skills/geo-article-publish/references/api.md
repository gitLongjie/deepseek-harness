# web-admin-go 文章发布接口参考

本文件是对 `D:\Project\GEO\web-admin-go` 实际代码（`handler/` 与 `model/entity/`）核实的接口速查，供 `geo-article-publish` 技能调用时对字段。

## 约定

- 基址 `${base}`：默认 `http://localhost:8001`（项目默认端口，监听 `0.0.0.0:8001`）。
- 认证：管理路由统一 `Authorization: Bearer {access_token}`；`/api/v1/news` 需要 `content.news` 或 `geotool.articles` 权限（角色 3「内容编辑」已含 `content.news`）。
- 响应统一 JSON；失败时 `message` 字段给出原因。

## 端点

### 登录

```
POST /api/v1/auth/login
Body: { "username": "...", "password": "..." }
```

成功响应（节选）：

```json
{
  "access_token": "…",
  "refresh_token": "…",
  "user": { "id": 0, "username": "…", "full_name": "…" },
  "websites": [
    { "id": 4, "name": "…", "code": "…", "domain": "…", "role": "editor", "pen_name": "…" }
  ],
  "roles": []
}
```

- 首次正确登录无需验证码；连续失败会触发验证码与封禁，技能不要做循环重试式爆破。
- `websites` 即该账号可用站点列表，多站点解析优先用它。

### 站点列表（登录返回为空时回退）

```
GET /api/v1/websites          → { "data": [...], "total": n, "page": 1, "limit": 20, "pages": n }
```

非超管账号只会看到 `user_websites` 里分配给它的站点。

### 发布文章

```
POST /api/v1/news
Content-Type: application/json
Authorization: Bearer {access_token}
```

请求体（`entity.News` 的宽松反序列化，`website_id`/`category_id` 传字符串数字也能解析）：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `website_id` | int | 是 | 目标站点 |
| `title` | string | 是 | 标题（DB `not null`） |
| `summary` | string | 是 | 摘要，保存前会剥 HTML 标签，写纯文本 |
| `content` | string | 是 | 正文，markdown，保存前 `RichToHTML` 转 HTML |
| `tags` | string | 否 | 逗号分隔字符串 |
| `category_id` | int | 否 | 栏目 |
| `image` | string | 否 | 封面图 URL |
| `author` / `source` / `source_url` | string | 否 | 作者/来源/来源链接 |
| `is_published` | bool | 否 | 默认 false（草稿）；true 直接上线 |
| `is_featured` / `page_show` / `sort_order` | bool/int | 否 | 展示相关，可缺省 |

成功响应：

```json
{ "success": true, "data": { "id": 123, "slug": "…", "title": "…", "website_id": 4, "is_published": false } }
```

要点：

- `POST /api/v1/news` 的 `Create` 处理器不校验站点归属，但创建后会失效该站点 sitemap 与 news 缓存；`publish-from-task` 端点会强制 `is_published=false` 并补 `source/author/source_url`，投递到草稿箱，需要"直接上线"时不走它。
- `news` 表 `slug` 有唯一索引，后端按标题自动生成并去重。

### 读回校验

```
GET /api/v1/news/{id}         → { "success": true, "data": { ...全字段... } }
```

发布后用它核对 `title` / `website_id` / `is_published` / `slug`。

## 认证后台事实（供排查）

- 管理路由的认证中间件 `AuthRequiredWithService` 支持 `X-Internal-API-Key` 头直通超管（值等于 `.env` 的 `INTERNAL_API_KEY`）。本技能默认用专用账号登录（最小权限 + 日志可溯源），仅在确需批量运维时才考虑内部密钥，且需用户明确同意。
- 操作日志中间件会记录管理写操作；专用账号让"操作人"可溯源到具体账号。