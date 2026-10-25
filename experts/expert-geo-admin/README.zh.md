---
description: "深度Work 专家包：把深度云海 GEO 专家作为可安装的专家卡片发布到 dsh 专家市场。"
kind: "package-reference"
---

# @xmanrui/expert-geo-admin

[English](README.md) | 中文

## 概述

`@xmanrui/expert-geo-admin` 把「深度云海 GEO 专家」发布为 dsh 专家市场里可下载、可聘用的专家卡片。包内 `experts/geo-admin/` 是完整的专家目录（`preset.yml` 卡片元数据、`agent.cordis.yml` 组合、`skills/` 工具箱——`geo-admin-data` 操作流程），随包附带一个微同步插件，宿主每次启动把专家目录同步进 harness home 的用户预设根（`.agent-presets`），预设名单的用户根在下一次读取时即发现它（trust: user）。专家页对其的展示与聘用经由既有的 agentPresets 投影与暂存机制，本包不新增任何模型侧机制。

该专家通过 `geo_*` 工具（`@deepseek-ai/dsh-tool-geo-admin`）查询并修改 GEO 多站点内容后台：列站点、列文章与读单篇、列栏目、新建/修改/删除文章、列 GEO 关键词任务并重试失败项、列/读/发起品牌可见度报告（并跟进生成任务）。后台地址与账号来自设置 → 插件 → 深度云海卡片，密码保存在 DSH 凭据存储的 `GEO_ADMIN_PASSWORD` 名下、每次调用时解析，凭据不会出现在会话里。

## 使用本包

在插件市场安装本包（或 `pnpm add @xmanrui/expert-geo-admin` 到受管 profile 后重启宿主）。专家即出现在专家页，聘用到新对话会真实组装该专家。首次使用前在「设置 → 插件 → 深度云海」填一次后台地址、账号与密码。

`dsh.expert.roots` 声明包内专家根；`dsh.bundle.patch` 声明激活补丁（archify skill-root 先例的 `!!js` 锚定，包不携带对 harness 自身的依赖）。

## 发布

`npm run build` 从部署的真实来源（`apps/desktop/config/agent-presets/geo-admin/`）同步专家内容；`npm publish` 发布。服务器侧把 `store-entry.json` 的内容加入 DSH 1024Store 的 `/api/v1/plugins`（`category: "expert"`），客户端市场即可浏览并安装。

## 已知限制

- 同步只增不删：卸载本包后，最后一次同步的专家目录保留在用户预设根，可在预设创作界面删除。
- `avatar`/`subtitle`/`badge` 已随包发布，名单投影携带它们的工作随市场安装通道推进；当前投影忽略未知字段，卡片以字形头像兜底。
- 预设挂载 `@deepseek-ai/dsh-tool-geo-admin`，部署必须组装该包（深度云海版本已包含）；不带它的标准 dsh profile 会组装出没有工具的专家。
- 卡片不删除文章，也不改账号、角色、权限与站点配置；这些仍由后台自己的管理页面负责。
