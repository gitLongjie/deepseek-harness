---
description: "miaoWork 专家包：把miao云海文章专家作为可安装的专家卡片发布到 dsh 专家市场。"
kind: "package-reference"
---

# @xmanrui/expert-article-publisher

[English](README.md) | 中文

## 概述

`@xmanrui/expert-article-publisher` 把「miao云海文章专家」发布为 dsh 专家市场里可下载、可聘用的专家卡片。包内 `experts/article-publisher/` 是完整的专家目录（`preset.yml` 卡片元数据、`agent.cordis.yml` 组合、`skills/` 工具箱——`geo-article-publish` 工作流、API 参考与一次性账号创建脚本），随包附带一个微同步插件，宿主每次启动把专家目录同步进 harness home 的用户预设根（`.agent-presets`），预设名单的用户根在下一次读取时即发现它（trust: user）。专家页对其的展示与聘用经由既有的 agentPresets 投影与暂存机制，本包不新增任何模型侧机制。

该专家生成文章或接收用户提供的文章，经 `geo_*` 工具（`@deepseek-ai/dsh-tool-geo-admin`）发布到运行中的 `web-admin-go` 多站点后台，落到选定的 `website_id`。后台地址与账号来自设置 → 插件 → 深度云海卡片，密码保存在 DSH 凭据存储的 `GEO_ADMIN_PASSWORD` 名下、每次调用时解析，凭据不会出现在会话里。`skills/geo-article-publish/scripts/setup-account.ps1` 每个后台跑一次，创建最小权限的发文账号（角色「内容编辑」）并把账号密码打印出来，供填入那张卡片。

## 使用本包

在插件市场安装本包（或 `pnpm add @xmanrui/expert-article-publisher` 到受管 profile 后重启宿主）。专家即出现在专家页，聘用到新对话会真实组装该专家。首次发文前，每个后台先创建发文账号，并在「设置 → 插件 → 深度云海」填一次地址、账号与密码。

`dsh.expert.roots` 声明包内专家根；`dsh.bundle.patch` 声明激活补丁（archify skill-root 先例的 `!!js` 锚定，包不携带对 harness 自身的依赖）。

## 发布

`npm run build` 从部署的真实来源（`apps/desktop/config/agent-presets/article-publisher/`）同步专家内容；`npm publish` 发布。服务器侧把 `store-entry.json` 的内容加入 DSH 1024Store 的 `/api/v1/plugins`（`category: "expert"`），客户端市场即可浏览并安装。

## 已知限制

- 同步只增不删：卸载本包后，最后一次同步的专家目录保留在用户预设根，可在预设创作界面删除。
- `avatar`/`subtitle`/`badge` 已随包发布，名单投影携带它们的工作随市场安装通道推进；当前投影忽略未知字段，卡片以字形头像兜底。
- 预设挂载 `@deepseek-ai/dsh-tool-geo-admin`，部署必须组装该包及其 `geo-admin` 设置行（深度云海版本已包含）；不带它们的标准 dsh profile 会组装出没有发文工具的专家。
- 账号在设置卡片里填一次；启动环境仍可通过 `GEO_ADMIN_BASE_URL` / `GEO_ADMIN_USERNAME` 提供组合基值，`GEO_ADMIN_PASSWORD` 也仍可从环境解析，便于无界面运行。