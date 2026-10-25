# Agent Note：深度云海配置搬进设置卡片，工具不再走 shell

Status: implemented

[English](2026-10-19-geo-admin-tools-and-experts.md) | 中文

## 问题

深度云海专家原本是一套预设组合，靠 shell 发文：persona 让模型加载技能、从 `D:\Project\GEO\web-admin-go\.env`（或 `GEO_ADMIN_*` 环境变量）读凭据、用 `curl` 登录，再自己 POST 文章。这带来三个后果。

产品里没有配置后台的地方：账号和密码住在某台机器上一个后台项目的 `.env` 里，换一台机器、后台搬家、或者不是开发者的用户，都没有东西可填。密码每次都出现在工具调用参数里，因而进入会话日志。而且专家只能做技能里逐条写死的动作——列不出账号下的文章、查不了草稿、改不了已发布的文章——每加一个操作就要再手写一份 HTTP 配方。

## 决定

- **宿主设置命名空间持有连接。** `@deepseek-ai/dsh-tool-geo-admin` 提供 `./settings`：一条宿主行，注册 `geo-admin` 命名空间（`baseUrl`、`username`），并把它的实时值发布为 `ctx.geoAdminSettings`。它和其他宿主设置行一起待在部署的 web bundle 里，因为 `settings.register` 是每进程一次，预设无法拥有它。启动环境通过 `GEO_ADMIN_BASE_URL` / `GEO_ADMIN_USERNAME` 提供组合基值，无界面运行照旧可用。
- **密码是凭据引用，不是字段。** 设置文档从不携带它；卡片经凭据域把它写到固定引用 `GEO_ADMIN_PASSWORD`，工具每次调用时解析该引用。轮换密码无需重启即可作用于下一次请求，也不会有明文出现在设置响应里。
- **后台经有类型的工具访问，而不是 shell。** 包的主入口注册十三个面向模型的工具——站点、文章列表/读取/新建/修改/删除、栏目、GEO 关键词任务（列表、重试）、品牌可见度报告（列表、读取、发起生成、跟进任务）——每个都用配置好的账号登录，并把后台文档化的信封逐字段收窄。新建从不重试（该端点没有幂等键）；两个文章写工具都会读回落库记录；被拒绝的删除按后台自己的原因转述。每个请求都要求传输层拒绝重定向，因为登录请求带密码、已登录请求带 bearer token。
- **报告与任务路由反代到任务服务。** `web-admin-go` 把 `/api/v1/brand-visibility/*` 与 `/api/v1/geo-tasks*` 转发给任务服务：报告路由答 `{code, message, data}`，GEO 任务答扁平分页。客户端两种都拆封，只投影运维真正会用的字段：任务状态与最后错误、报告计数与 QA 窗口、目标品牌可见度分与品牌榜。发起生成只返回任务，模型用 `geo_report_job` 跟进，而不是阻塞等待。
- **现有插件设置分区里的一张卡片编辑该命名空间。** `ui-settings-plugins` 增加「深度云海」卡片：两个暂存值字段和一个只写密码控件，和 H3 视频卡片一样按 `geo-admin` 命名空间分派。不服务该命名空间的部署不渲染这张卡片。
- **专家预设不再持有传输。** `article-publisher`（深度云海文章专家）去掉 bash/pwsh 行、换成工具行，改为经工具发文；它的初始化脚本创建最小权限账号后把凭据打印出来供填入卡片，不再写后台的 `.env`。新增的 `geo-admin` 专家（深度云海 GEO 专家）用同一套工具读取、核对和修改已有数据。两者都放在新的 `geo/` 包分组下。

## 考虑过的替代方案

- **为现有 shell 技能落地一个私有配置文件。** 否决：它会把机密复制到第二个明文文件，并把路径交给 agent，而凭据 seam 存在的意义正是避免这一点。每次调用解析引用的工具让明文既不进会话、也不进第二个存储。
- **保留 shell 发文，只加卡片。** 否决：没有消费方的卡片对用户毫无改变，而有类型的工具才是把密码从工具参数里拿掉的机制。
- **把包复制进专家包，按卡片挂载工具。** 否决：预设无法注册设置命名空间，而独立 npm 包里的浏览器半侧得自行复刻仓库的 client bundle 预设——设置分区 README 已记录该限制。
- **批量或破坏性报告接口。** 未纳入：删除一次只针对一篇文章，发起报告一次只起一个任务；工具不会自行扩散调用。

## 后果

- 深度云海卡片就是账号所在地；新安装不需要改任何文件即可配置。
- 同一后台现在有两个模型：卡片的分节（账号/地址）与凭据（密码）。两者都按操作解析，任一侧变更都会作用于下一次工具调用。
- 只有当部署组装了 `@deepseek-ai/dsh-tool-geo-admin/settings` 时卡片才出现。只挂载专家预设的标准 dsh profile 会拿到工具行却没有命名空间；此时工具会以「设置 → 插件 → 深度云海」路径报错，而不是静默不做事。
- 发布两个专家包：`@xmanrui/expert-article-publisher`（更新）与 `@xmanrui/expert-geo-admin`（新增）。两者都从 `apps/desktop/config/agent-presets/` 同步，两个预设都挂载 `@deepseek-ai/dsh-tool-geo-admin`。
- 工具由脚本化传输的单元测试与注册表级测试覆盖，卡片由控制器与组件测试覆盖。路由表读自内容后台的 `handler/router.go`、`handler/admin/news.go`，以及任务服务的 `internal/router/router.go`、`internal/handler/brand_visibility.go`；端点为 `GET/POST /api/v1/news`、`GET/PUT/DELETE /api/v1/news/{id}`、`GET /api/v1/categories`、`GET /api/v1/websites`、`GET /api/v1/geo-tasks`、`POST /api/v1/geo-tasks/{id}/retry`、`GET /api/v1/brand-visibility/admin/reports`、`GET /api/v1/brand-visibility/admin/reports/{id}`、`POST /api/v1/brand-visibility/report/generate`、`GET /api/v1/brand-visibility/report/jobs/{id}`。

## 参考

- 实现：`packages/geo/tool-geo-admin/src/{index,settings,http,types,errors}.ts`
- 卡片：`packages/client/ui-settings-plugins/src/client/{GeoAdminCard.tsx,geo-admin-card-controller.ts,locales.ts}`
- 组合：`packages/bundle/web-app/cordis.patch.yml`（`geo-admin-settings` 行）、`apps/desktop/config/agent-presets/{article-publisher,geo-admin}/agent.cordis.yml`
- 专家包：`experts/expert-article-publisher/`、`experts/expert-geo-admin/`
- 后台契约：`D:\Project\GEO\web-admin-go\handler\router.go`（挂载与权限）、`handler/admin/news.go`（列表/新建/更新/删除处理器）、`D:\Project\GEO\generate_article_server_go\internal\router\router.go`（GEO 任务与报告路由）、`internal\handler\brand_visibility.go`（报告列表/读取/生成处理器）
- 相关：`2026-09-19-expert-presets-stay-out-of-mode-surfaces.md`（专家卡片不进入模式菜单）
