---
description: "民大工作台专家包：把 GEO 优化专家作为可安装的专家卡片发布到 dsh 专家市场。"
kind: "package-reference"
---

# @xmanrui/expert-geo-optimizer

[English](README.md) | 中文

## 概述

`@xmanrui/expert-geo-optimizer` 是第一个专家包：把「GEO 优化专家」发布为 dsh 专家市场里可下载、可聘用的专家卡片。包内 `experts/geo-optimizer/` 是完整的专家目录（`preset.yml` 卡片元数据、`agent.cordis.yml` 组合、`skills/` 工具箱），随包附带一个微同步插件，宿主每次启动把专家目录同步进 harness home 的用户预设根（`.agent-presets`），预设名单的用户根在下一次读取时即发现它（trust: user）。专家页对其的展示与聘用经由既有的 agentPresets 投影与暂存机制，本包不新增任何模型侧机制。

## 使用本包

在插件市场安装本包（或 `pnpm add @xmanrui/expert-geo-optimizer` 到受管 profile 后重启宿主）。「GEO 优化专家」即出现在专家页首位，卡片数据与部署随附的参考专家一致；聘用到新对话会真实组装该专家。

`dsh.expert.roots` 声明包内专家根；`dsh.bundle.patch` 声明激活补丁（archify skill-root 先例的 `!!js` 锚定，包不携带对 harness 自身的依赖）。

## 发布

`npm run build` 从部署的真实来源（`apps/desktop/config/agent-presets/geo-optimizer/`）同步专家内容；`npm publish` 发布。服务器侧把 `store-entry.json` 的内容加入 DSH 1024Store 的 `/api/v1/plugins`（`category: "expert"`），客户端市场即可浏览并安装。

## 已知限制

- 同步只增不删：卸载本包后，最后一次同步的专家目录保留在用户预设根，可在预设创作界面删除。
- `avatar`/`subtitle`/`badge` 已随包发布，名单投影携带它们的工作随市场安装通道推进；当前投影忽略未知字段，卡片以字形头像兜底。
