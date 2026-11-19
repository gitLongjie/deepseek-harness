# Agent Note: 分享的专家进入正在运行的名单

Status: implemented

[English](2026-11-19-publish-shared-expert-without-restart.md) | 中文

## Problem

把一条 WorkBuddy 专家分享贴进对话，再要求它出现在 DeepWork 的专家列表里，会去改 `apps/desktop/config/agent-presets/`，并且必须把进程完整重启一次。名单在进程启动时建好。写进部署目录的文件要到下次启动才看得见，而重启会打断用户正在进行的对话。

## Decision

`@deepseek-ai/dsh-expert-publish` 是宿主插件。用户消息里有 WorkBuddy 启动链接，或「创建了一个专家「名称」」时，这一轮的第一步要求模型用显示名派生的稳定 id 调用 `publish_expert`。工具把专家写到 `$DSH_HOME/published-experts/<id>/`，并在当前进程里调用 `agentPresets.register`。同一个 id 会替换那次登记。如果这一轮结束时没有这次调用，并且本插件还没有拥有这个 id，它就用分享文本登记一张短卡片。

子组合是固定的：人设、说明、当前平台的 shell、文件系统工具、present，以及保存下来的技能目录。模型不选择插件行。专家页打开时读取 `agentPresets.list`，所以卡片可以聘用到新会话，不用重启。下次启动会加载同一目录。

## Alternatives considered

**继续把预设目录写进部署树。** 拒绝：那个目录只在启动时被包含，所以每加一个专家都要重启，之后的检出还可能覆盖它。

**通过 plugin_manager 安装 profile 补丁，再靠 HMR。** 拒绝：没有 HMR 的 profile 会报告需要重启，而这正是这次要去掉的结果。注册表已经接受一次现场的 `register` 调用。

**抓取 WorkBuddy 启动页并复制它的提示词。** 拒绝：那个页面是客户端渲染的壳，里面没有专家提示词。人设必须在这一轮里写出来。

## Consequences

- 对上的分享会变成当前进程里的一张卡片。用户打开专家，把它聘用到一个新对话。
- 处理这次分享的会话保持自己当前的组合。
- 已经打开的专家页要再次打开才会更新。
- 工具不能替换部署自带的 id。对这个插件已经拥有的 id 再次调用 `publish_expert` 会替换那张卡片。回合结束时的补登记不会替换这个插件已经拥有的 id，所以同名分享如果之后没有再次调用工具，较长的人设会留在原地。
