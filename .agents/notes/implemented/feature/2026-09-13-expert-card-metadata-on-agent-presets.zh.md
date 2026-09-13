# Agent Note：专家卡片搭 preset 名单的便车，而不是新建专家注册表

Status: implemented

[English](2026-09-13-expert-card-metadata-on-agent-presets.md) | 中文

## 问题

产品想要一个专家中心：用户可浏览卡片、聘用到会话、并把新会话默认到某个专家。诱人的做法是平行的 `expert` 域——自己的包、服务、prompt 贡献者和会话绑定——但 harness 本来就从 agent preset 组装每个会话的 agent，而 preset 目录本就携带 persona 行、preset 本地 skill 和展示元数据文件。第二套机制会把专家的三个组成部分拆散到两个注册表，还需要自己的会话日志词汇才能守住 model-visible ⟺ logged。

## 决策

专家就是发布了更丰富展示元数据的 agent preset；本次改动把专家卡片字段——`category`、`tags`、`quickPrompts`、`icon`——扩展进 `preset.yml`，并让它们走既有管线，此外别无新增。`readPresetMetadata`/`renderPresetMetadata` 在该文件既有的降级为空契约下接受并封顶这些字段（八条标签、三条推荐提问、一个短字形）；discovery 把它们展开到 `AgentPreset` 行上；Remote `list` 把它们投影到路径无关的 `AgentPresetRow` 上；`copyComposition` 让它们随创作副本旅行，副本专家因此与来源呈现一致，而 `name`/`order` 仍负责区分副本。桌面的参考专家（`apps/desktop/config/agent-presets/geo-optimizer/`）完整示范了这套约定：声明「先诊断后报价」方法论的 persona 行、经 `customSkillDirs` 挂载的 preset 本地报价 skill，以及 `preset.yml` 里的卡片元数据。

## 考虑过的替代方案

**带自有 prompt 贡献者和 skill 绑定器的 `packages/expert/` 宿主服务。** 否决：persona 行与 preset 本地 skill 根已经完成这两类注入，第二个 prompt 贡献者会和 `dsh-persona` 争夺 section 排序。会话绑定已经以 `agent-preset/selected` 投影存在；`session.metadata.expert` 字段会成为同一事实的第二个来源。

**在 `preset.yml` 旁再放一个 `expert.yml`。** 否决：一个目录两份元数据文件就是展示文本的两个家；pre-release 立场允许直接扩展既有文件。

## 验证

`metadata.spec.ts` 覆盖新字段的读取、降级、封顶与往返；`discovery.spec.ts` 断言它们出现在扫描行上；`remote.spec.ts` 断言名单投影携带它们；`authoring.spec.ts` 断言副本随行这些字段、同时仍丢弃 `name`/`order`。

## 后果

市场式选择器仅凭名单行即可分组、筛选并渲染聘用入口。从 registry 安装仍是未来唯一的宿主侧新增，而它继承一个悬而未决的信任问题：组装是可执行代码（`!!js`），安装通道上线前必须连同其信任层级与 `!!js` 策略一起设计。已上机的市场页不再渲染名单行——页面内容的来源由[专家市场自带精选名单](2026-09-13-expert-market-ships-its-own-roster.zh.md)决策承接；元数据管线留给 preset 面板。
