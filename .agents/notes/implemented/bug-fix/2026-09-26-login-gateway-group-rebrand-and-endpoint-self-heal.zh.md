# Agent Note：登录网关模型分组品牌化与已存会话端点自愈

Status: implemented

[English](2026-09-26-login-gateway-group-rebrand-and-endpoint-self-heal.md) | 中文

延伸自[喵工作台 OEM 品牌迁移笔记](../feature/2026-09-26-miao-workbench-oem-rebrand.zh.md)。

## 问题

OEM 更名之后，模型界面仍显示上游品牌。`llm-deepseek` 注册的登录网关分组带着 provider id `deepagens`、设置命名空间 `llm-deepagens` 与显示/提供商名 `Deepagens`——模型选择器、模型设置页和持久化的 `agent-default-model` 值渲染的都是这些名字。另一边，网关端点本身不是代码：一次登录会把登录 origin 的 `/v1` 写进提供商设置、把 `DEEPSEEK_BASE_URL` 写进凭据层，因此部署的 `loginUrl` 迁移后，已登录的客户端仍显示并请求旧地址（`https://claw.deepagens.com/v1`），直到用户退出重登——而第一次迁移已经证明用户会把它当成 bug 报上来。

## 决策

两半，同一次改动：

- **网关路由采用部署品牌。** Provider id `miaoworker`、设置命名空间 `llm-miaoworker`、显示与提供商名 `喵工作台`（`llm-deepseek` 注册；`ui-login` 写入）。改名即迁移：旧命名空间里存的端点与目录变成不再读取的孤儿，新命名空间从空开始、由登录流程播种；指向旧 provider id 的持久化默认模型过不了「目录是否服务当前默认」检查，下一次目录同步会重新指向。
- **已存会话记录签发它的登录 origin。** 登录时写入 `LoginSession.authOrigin`；`load()` 将它与本构建的登录 origin 比较，不一致时（部署迁移过，或会话早于该字段）后台尽力重播种：按当前 origin 重写凭据对、重跑网关目录同步，然后记录新 origin。全程尽力而为——凭据写被拒绝则不记录 origin、下次启动重试；新账号服务器拒绝已存 key 只损失一次目录发现，下次登录补齐其余。

## 考虑过的替代方案

**保留 `deepagens` id、只改显示名。** 拒绝：id 与命名空间会持久化进用户设置和日志，旧品牌在改名本应覆盖的所有界面里继续存活；且只改显示名对陈旧端点这一半毫无作用。

**在存储设置里检测旧上游地址（`claw.deepagens.com`）并清除。** 拒绝：这会把某个部署的地址硬编码进产品代码。将记录的 origin 与本构建登录端点比较是部署无关的，也覆盖本部署未来的再次迁移。

**只依赖退出重登。** 拒绝：第一次 loginUrl 迁移就是带着这条指引发布的，用户仍再次报告旧地址；启动自愈让 key 仍被新服务器接受的会话无感完成迁移。

## 后果

旧的 `llm-deepagens` 命名空间数据留在磁盘上成为死重量——设置服务没有 section 卸载接缝，"从不读取"就是迁移方式。origin 不匹配的会话在每次启动时多一次发现请求，直到 origin 记录一致。指向已退役 provider id 的持久化默认模型在目录同步或重新登录之前持续失效；网关不可达时该选择按设计保持失效，与从前一致。

## 验证

`ui-login` 与 `llm-deepseek` 套件（646 个测试）通过，包含新增用例：origin 匹配的会话恢复（不刷新）、早于字段的会话与异源会话（重写凭据 + 同步目录 + 记录 origin）、迁移凭据写被拒（不记录 origin）。`pnpm run typecheck` 通过。构建产物：`grep` 在 ui-login bundle 与 `apps/web/dist` 中找不到 `claw.deepagens.com`，烘焙的登录 URL 是 OEM 值，`llm-deepseek` bundle 携带 `喵工作台` 与 `miaoworker`。
