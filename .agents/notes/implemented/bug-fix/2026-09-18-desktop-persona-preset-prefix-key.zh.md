# Agent Note：跟进上游 `text`→`prefix` 改名，重命名桌面预设的 persona 行配置键

Status: implemented

[English](2026-09-18-desktop-persona-preset-prefix-key.md) | 中文

## 问题

上游 40792330c0 把 `dsh-persona` 行的必填配置键从 `text` 改名为 `prefix`（`packages/preset/persona/src/index.ts`），合并 bb1a3b16bb 把这次改名带进了 deepagens。上游不知道的桌面自有预设副本——六个 `apps/desktop/config/agent-presets/*/agent.cordis.yml` 与两个同步生成的 `experts/expert-*/experts/*/agent.cordis.yml`——仍在写 `text:`。所有挂载 persona 行的预设现在都过不了 schema 校验（`$.prefix missing required value`），通过桌面/Web GUI 创建任何会话都会以 `agent-preset/invalid` 被拒绝。渲染端 `startSession` 只把这个拒绝打进控制台（`new session failed:`），于是可见症状就是侧边栏的新会话按钮毫无反应。

## 决策

把六个 `apps/desktop/config/agent-presets/` 预设中的 persona 行键 `text:` → `prefix:`，并用各自的 `scripts/build.mjs` 重新生成两个专家包的同步副本（桌面 config 仍是专家构建逐字拷贝的事实来源）。在 `~/.dsh/.agent-presets/` 下已有 authoring 副本的机器还需要手工重命名那份已安装文件；专家同步插件只覆写它们自带预设的漂移副本，已 authoring 的 article-publisher 副本在修改前会一直保留旧键。

## 已考虑的替代方案

**在 persona schema 里保留 `text` 作为兼容别名。** 改名是上游已发布的形态，部署预设是仅剩的旧键写入方；别名会保住一个该行自身 JSDoc 与所有上游预设都已丢弃的名字。

**在客户端 UI 上呈现创建失败。** 值得做，但与此正交：预设配置仍然无效，修好文件之前每次创建会话仍会失败。静默 `console.warn` 的吞错记为后续项，不能替代修复组合本身。

## 影响

预设来自 `apps/desktop/config/agent-presets/` 的桌面与 Web profile 恢复了新会话创建；已通过在 `dsh web` profile 上实际点击侧边栏按钮验证（创建成功，控制台无拒绝）。在合并之后、本修复之前手工 authoring 过 persona 预设的部署，需要重命名其已安装 `~/.dsh/.agent-presets/<name>/agent.cordis.yml` 中的键。
