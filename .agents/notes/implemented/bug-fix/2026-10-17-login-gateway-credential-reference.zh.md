# Agent Note: 登录网关拥有自己的凭据引用

Status: implemented

[English](2026-10-17-login-gateway-credential-reference.md) | 中文

## Problem

在「设置 → 模型」里填入的自有 DeepSeek API Key，下一次启动后就没了。模型卡片把键入的密钥存到该路由解析档案点名的引用下，DeepSeek 路由即 `DEEPSEEK_API_KEY`（`packages/llm/llm-deepseek/src/config.ts`）。Deepagens Claw 网关是同一插件的第二条路由，使用自己的 `llm-deepagens` 设置段，却没有声明自己的引用，于是共享 schema 的默认值让它也解析同一个 `DEEPSEEK_API_KEY`。

`ui-login` 每次启动都会重放存储的账号密码对（`LoginStore.restore` → `login`），并在每次登录成功后把网关签发的密钥与端点 origin 写入 `DEEPSEEK_API_KEY` 与 `DEEPSEEK_BASE_URL`。因此每次启动都会用网关密钥覆盖 DeepSeek 路由已存的密钥，退出登录时还会删除它。写 origin 本身没有收益：`resolveAdapterOptions` 只从受信启动环境读取 `$DEEPSEEK_BASE_URL`，从不读凭据库；而目录同步已经把网关端点写入 `llm-deepagens.baseURL`。

## Decision

网关路由拥有自己的凭据引用。`DEEPAGENS_API_KEY_ENV`（`DEEPAGENS_API_KEY`）与 `chat-completions` 固定值一同进入该路由的组合基线，因此路由的解析档案会点名它，模型卡片也就报告并写入该引用。登录插件只写 `LOGIN_CREDENTIAL_REFS`（现仅 `DEEPAGENS_API_KEY`），不再写任何 base URL 凭据。`DEEPSEEK_API_KEY` 从此就是 DeepSeek 卡片所说的含义：那条路由的密钥。

仍把网关密钥存在 `DEEPSEEK_API_KEY` 下的凭据库，现在会把它读作 DeepSeek 路由的密钥，而下一次启动的静默重登录会把网关当前密钥写入 `DEEPAGENS_API_KEY`。

## Alternatives considered

- **只在交互式登录时写凭据，启动重放不写。** 账号服务器每次登录都会签发新密钥，重放正是让轮换后的密钥生效的路径；跳过这次写入会让网关路由一直持有旧密钥，直到用户手工登录。
- **存储值与签发值不同时跳过写入。** `CredentialInfo` 只报告是否配置、来源与可写性，插件无法区分用户自存的密钥与上一次启动签发的密钥。
- **把端点凭据改名保留（`DEEPAGENS_BASE_URL`）。** 没有任何消费方读取 base URL 凭据：适配器的端点来自设置段与启动环境，网关的 `baseURL` 由目录同步负责。

## Consequences

- 启动重登录不再改写 DeepSeek 路由的密钥，退出登录只移除网关自己的引用。
- 模型页的 Deepagens 卡片现在显示并存储 `DEEPAGENS_API_KEY`，其「已配置」标记跟随网关密钥而不是 DeepSeek 密钥。
- 只有把网关密钥存在 `DEEPSEEK_API_KEY` 下的安装，会把该密钥显示为 DeepSeek 路由的密钥，直到用户替换它；网关路由读取的是 `DEEPAGENS_API_KEY`，由下一次登录写入。凭据写入被拒绝时登录仍然响亮中止。
- `DEEPAGENS_API_KEY` 归登录插件所有：启动重登录写入它，退出登录移除它。若部署希望网关路由持有自己的密钥，请在该路由的 `apiKeyEnv` 中另指一个引用——凭据 seam 只报告是否配置，没有可供插件判断“这个值由用户手填”的来源信息。
- 本插件同时执行的默认模型接管保持不变；其已接受的取舍仍记录在[登录默认模型记录](../feature/2026-09-23-login-adopts-first-gateway-model-as-default.zh.md)中。
- `packages/client/ui-login/tests/browser-plugin.client.spec.ts` 固定一次登录写入与取消的确切引用，`packages/llm/llm-deepseek/tests/dynamic-config.spec.ts` 固定网关路由从 `DEEPAGENS_API_KEY` 认证、而已存的 `DEEPSEEK_API_KEY` 不会到达它。
