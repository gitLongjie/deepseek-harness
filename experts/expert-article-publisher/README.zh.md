---
description: "民大工作台专家包：把民大工作台文章专家作为可安装的专家卡片发布到 dsh 专家市场。"
kind: "package-reference"
---

# @xmanrui/expert-article-publisher

[English](README.md) | 中文

## 概述

`@xmanrui/expert-article-publisher` 把「民大工作台文章专家」发布为 dsh 专家市场里可下载、可聘用的专家卡片。包内 `experts/article-publisher/` 是完整的专家目录（`preset.yml` 卡片元数据、`agent.cordis.yml` 组合、`skills/` 工具箱——`geo-article-publish` 工作流、API 参考与一次性账号创建脚本），随包附带一个微同步插件，宿主每次启动把专家目录同步进 harness home 的用户预设根（`.agent-presets`），预设名单的用户根在下一次读取时即发现它（trust: user）。专家页对其的展示与聘用经由既有的 agentPresets 投影与暂存机制，本包不新增任何模型侧机制。

该专家生成文章或接收用户提供的文章，经 `POST /api/v1/news` 发布到运行中的 `web-admin-go` 多站点后台，落到选定的 `website_id`。认证用最小权限的专用账号（角色「内容编辑」），凭据由 `skills/geo-article-publish/scripts/setup-account.ps1` 写入目标项目的 `.env`。

## 使用本包

在插件市场安装本包（或 `pnpm add @xmanrui/expert-article-publisher` 到受管 profile 后重启宿主）。专家即出现在专家页，聘用到新对话会真实组装该专家。每个后台首次发文前先运行一次账号创建脚本。

`dsh.expert.roots` 声明包内专家根；`dsh.bundle.patch` 声明激活补丁（archify skill-root 先例的 `!!js` 锚定，包不携带对 harness 自身的依赖）。

## 发布

`npm run build` 从部署的真实来源（`apps/desktop/config/agent-presets/article-publisher/`）同步专家内容；`npm publish` 发布。服务器侧把 `store-entry.json` 的内容加入 DSH 1024Store 的 `/api/v1/plugins`（`category: "expert"`），客户端市场即可浏览并安装。

## 已知限制

- 同步只增不删：卸载本包后，最后一次同步的专家目录保留在用户预设根，可在预设创作界面删除。
- `avatar`/`subtitle`/`badge` 已随包发布，名单投影携带它们的工作随市场安装通道推进；当前投影忽略未知字段，卡片以字形头像兜底。
- 后端地址与专用账号默认取 `http://localhost:8001` 与项目 `.env`；后端或凭据在别处时用 `GEO_ADMIN_BASE_URL` / `GEO_ADMIN_USERNAME` / `GEO_ADMIN_PASSWORD` 覆盖。