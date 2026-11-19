---
description: "对话里分享一个专家时，把它登记进正在运行的名单，进程不用重启。"
kind: "package-reference"
---

# @deepseek-ai/dsh-expert-publish

[English](README.md) | 中文

## 摘要

`dsh-expert-publish` 从对话里把可聘用的专家加进正在运行的专家列表。WorkBuddy 启动链接，或「创建了一个专家「名称」」这样的消息，就是这个请求。卡片在当前进程里登记，并写在 harness home 下，所以下次启动还在，当前进程不用重启。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步了解](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发注记](#dev-note)

-----

<a id="use-this-package"></a>

## 使用本包

在宿主上挂一次，跟 agent-preset 注册表放在一起。没有必填配置。`root` 改目录；默认是 `$DSH_HOME/published-experts`。

```yaml
- id: expert-publish
  name: '@deepseek-ai/dsh-expert-publish'
```

Web profile 插入这一行。工具登记在宿主的工具服务上，所以每个 agent 都能看见 `publish_expert`。聘用新卡片会开一个新会话；发布它的那个会话仍用自己原来的组合。

<a id="understand-the-implementation"></a>

## 理解实现

一轮里用户文本对上之后，第一步会追加一条通知，里面是稳定 id：`expert-` 加上显示名的十二位十六进制。模型用这个 id、人设，以及可选的标签、推荐问题和技能正文调用 `publish_expert`。调用写入 `expert.json` 和 `skills/published-expert/SKILL.md`，然后 `agentPresets.register`。同一个 id 会替换上一次登记。部署里已经有的 id 会被拒绝。

如果这一轮结束时没有调用 `publish_expert`，插件用分享文本发布一张短卡片，并且仅当这个 id 还不是它自己拥有的。专家页打开时读取名单，所以不用重启就能看见卡片。

<details>
<summary>实现内部 — 点击展开</summary>

子组合是固定的：人设、agent 说明、当前平台的 shell、文件系统工具、present，以及指向已保存目录的技能目录。模型不提供插件行。

</details>

<a id="further-exploration"></a>

## 进一步了解

- [Agent preset 注册表](../agent-preset-registry/README.zh.md) — 登记，以及专家页读取的名单。
- [专家页](../../client/ui-expert/README.zh.md) — 可聘用的卡片。

<a id="model-experience"></a>

## 模型体验

### publish_expert

#### 模型看到什么

一个全局工具。描述要求在分享那一轮结束前调用它。

##### 工具描述

```markdown
Publish or replace one hireable expert in the running expert list. Call it before the turn ends when the user shares an expert (a WorkBuddy launch link, or a message that says they created an expert in 「」) or asks to add an expert to the expert list. Pass the id from the turn instruction when one is present. The card is usable immediately; do not edit repository presets and do not ask for an application restart. Republishing the same id replaces that expert.
```

#### Token 影响

工具 schema 在每次请求的宿主工具列表里。对上的分享还会在该轮第一步追加一条通知。

#### KV Cache 影响

工具 schema 属于稳定的宿主工具列表。通知追加在用户消息之后，更早的前缀仍可复用。替换一个专家不会改变工具 schema。

### 分享通知

#### 模型看到什么

对上的那一轮的第一步，一条 source 为 `expert-publish` 的 user 角色通知。`<id>` 是稳定 id，`<name>` 是解析出的显示名。

##### 通知

```markdown
This user message shares an expert to add to the expert list. Before this turn ends, call publish_expert once with id "<id>", name "<name>", and a description and persona that carry the expert's job. Include tags, quickPrompts, and skillMarkdown when you have them. Republishing the same id replaces the card. The card is hireable immediately. Do not edit repository preset files and do not ask the user to restart the application.
```

#### Token 影响

分享那一轮跑过之后，这条通知留在该会话的后续请求里。同一轮的后面几步不会再加一条。

#### KV Cache 影响

追加在用户消息之后。对不上的一轮什么也不加。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **分享链接不会被抓取。** WorkBuddy 的启动页不含专家提示词，所以人设是这一轮写出来的内容。这一轮没有调用工具时，回合结束时的卡片只用名称和破折号后面的那一句。
- **已经打开的专家页不会自己刷新。** 页面在打开时读取名单。卡片是在页面已经打开时发布的，关掉再打开「专家」。
- **发布所在的会话不会切换组合。** 把卡片聘用到一个新对话。

<a id="dev-note"></a>

### 开发注记

- **2026-11-19** — 分享来的专家登记进正在运行的名单，并写在 harness home 下，所以专家列表不用重启进程就会更新。
