# Agent Note: 浏览器登录网关对接 Deepagens Claw 账号服务器

Status: implemented

[English](2026-08-25-client-login-gate.md) | 中文

## 问题

Web 与桌面客户端此前没有账号概念：以 Deepagens Claw token 网关（`https://claw.deepagens.com/`）为前端的部署，仍要求每个用户在模型设置页手工粘贴 API Key。产品需要：未登录时显示登录页、外壳中显示已登录头像与昵称、以及退出登录路径——Web 应用与 Electron 桌面应用同时具备且不分叉前端。

## 决策

登录完全落在一个客户端插件 `@deepseek-ai/dsh-client-ui-login` 中——host 侧不新增 wire 域。浏览器直接把输入的凭据 POST 到账号服务器既有端点 `POST /api/user/deepagens-claw/login`（契约：`{username, password}` → `{success, message?, data: {display_name?, avatar?, api_key}}`），桌面应用通过共享同一套插件 bundle 自动继承该流程。端点 URL 默认取部署的账号服务器（`https://claw.deepagens.com/api/user/deepagens-claw/login`，与 LLM 适配器的公共 base URL 同类的包内常量）；`DSH_CLIENT_LOGIN_URL` 在构建期覆盖，设为空字符串则完全编译掉登录门。

UI 占用两个既有可加座位而非新座位：整页登录接管渲染进 `shell.overlay`（遮罩自行恢复指针事件，因为该层设计为点击穿透）；账号行——头像或首字母回退、宽栏显示昵称、退出登录下拉——渲染进 Settings 旁的 `sidebar.footer.action`。两者都通过声明感知的 `slots.inject()` 安装，与 ui-layout、ui-sidebar 的激活顺序无关。

会话交接复用 credentials 缝隙：登录成功经既有 `credentials.set` 线上方法写入 `DEEPSEEK_API_KEY`（签发的 key）与 `DEEPSEEK_BASE_URL`（端点 origin）——与模型设置页相同的可写层——退出登录时全部取消。写入被拒绝时登录响亮中止（`credential-rejected` 呈现为错误，会话不持久化），遵守 fail-loud 规则而不是留下半登录状态。展示资料（昵称、头像 URL、key）持久化在 `localStorage`，视为不可信的展示数据；任何模型可见内容都不依赖它。

## Alternatives considered

The alternatives below were considered and not taken; the headings satisfy the note format while keeping the reasoning.

### 放弃了什么

- **没有 host 侧 auth 域。** 曾考虑类型化的 `auth.*` RPC 面（login/getSelf/logout，含服务端会话重放与头像刷新），但推迟：那要在 `dsh-host-apiproxy` 增加契约 + zod schema + handler + 客户端 + 覆盖测试一整套，而客户端直连的方式只留下 CORS 一项部署要求。
- **不做实时资料刷新。** 服务器端改名或换头像在下次登录后才会出现；存储的资料仅用于展示。
- **本插件不把服务器 session cookie 重放**到其他账号端点。

## Consequences

所有构建现在都以部署的账号服务器为登录门，并把签发的 key 写入凭证层，提供商路由因此跟随账号服务器而无需逐用户录入 key；只有把 `DSH_CLIENT_LOGIN_URL` 设为空字符串的构建才退出该行为。
