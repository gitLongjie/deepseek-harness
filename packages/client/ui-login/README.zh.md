# @deepseek-ai/dsh-client-ui-login

[English](README.md) | 中文

本包针对部署的账号服务器注册登录流程（默认端点 `https://claw.deepagens.com/api/user/deepagens-claw/login`，可用 `DSH_CLIENT_LOGIN_URL` 覆盖）。将该变量设为空字符串的构建只加载插件、不注册任何占位。

两个占位通过声明感知的 `slots.inject()` 安装，因此与 ui-layout、ui-sidebar 的激活顺序无关，卸载时一并撤出：

- `shell.overlay` —— 整页登录接管（品牌标、用户名/密码表单、服务器消息原文展示）。遮罩自行恢复指针事件，因为 overlay 层本身设计为点击穿透。已登录时不渲染任何内容。
- `sidebar.footer.action` —— 已登录账号行：头像（缺失时以首字母回退）、宽栏模式显示昵称，下拉菜单提供退出登录。

登录成功（线上契约：`POST {username, password}` → `{success, message?, data: {display_name?, avatar?, api_key}}`）后，资料存入 `localStorage`，并通过既有的 `credentials.set` 线上方法写入 `DEEPSEEK_API_KEY` 与 `DEEPSEEK_BASE_URL`（端点 origin）——与模型设置页使用的同一可写层。写入被拒绝时登录响亮中止。退出登录会取消这两个引用并清除本地资料。

端点必须允许来自应用源的跨域调用（带 JSON content-type 的 CORS）；fetch 失败路径报告服务不可达而不是破坏页面。

## 模型体验

无：本包只贡献浏览器呈现与凭证交接，不触及任何模型请求。

#### KV Cache 影响

无：本包既不组装也不发送提供商请求。

## 已知限制与后续工作

- **不刷新会话** —— 存储的资料仅用于展示；服务器端改名或换头像在下次登录后才会出现。
- **无注册 UI** —— 卡片以链接跳转到账号服务器的 `/register` 页面，而不是内嵌流程。
- **不代发会话请求** —— 本包不将账号服务器的 session cookie 重放到其他端点。
