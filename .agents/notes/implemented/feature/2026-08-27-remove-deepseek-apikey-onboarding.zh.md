# Agent Note: 移除首启 DeepSeek API Key 引导弹窗

Status: implemented

[English](2026-08-27-remove-deepseek-apikey-onboarding.md) | 中文

## 问题

首次启动时，只要没有任何可用模型提供商，客户端就会弹出阻断式“添加一个 API Key 开始使用”弹窗，要求输入 DeepSeek API 密钥。首启账号登录现在已下发凭据，该弹窗成为冗余：已登录用户被要求再次输入已有的密钥，而整套步骤机制（通用插槽、协调器、弹窗原语）只服务于这一个对话框。

## 决策

整体删除该机制，而不是仅注销唯一的步骤：`settings.onboarding` 插槽声明（ui-settings `contract/slots.ts`）、`SettingsRoot` 中的协调器（空会话判定、已完成步骤集合）、`DeepSeekOnboardingDialog` + `OnboardingModal` 及其 `onboardingReadiness` 投影（ui-settings-models）、`OnboardingSurface` 原语（ui-primitives）。`ProviderEditor` 去掉仅弹窗使用的 props（`credentialOnly`、`credentialRequired`、`autoFocusCredential`、标签覆盖），回到模型页形态。生成的客户端插槽目录随之再生成，不再包含该条目。

## 保留

- 持久化 `ui-onboarding` 设置命名空间：已存储 `settings.yaml` 中退役的 `welcomeNoticeVersion` 字段必须保持可解析。
- `providerUsable`：模型页的首启姿态仍在读取它。

## 备选方案

**仅注销步骤，保留插槽机制。** 依据预发布基础优先原则否决：零注册者时，协调器、原语与插槽类型都是 knip 会标记的死代码。

**保留弹窗并以“登录未下发凭据”为条件。** 否决为臆测：今天不存在这种状态，真出现时再重新引入提示也很容易。

## 验证

`pnpm run typecheck` 通过；针对 ui-settings-models、ui-settings-general、ui-settings、ui-primitives 的 vitest 聚焦运行通过（47 个文件 / 886 个测试）。删除了两个 web onboarding e2e 用例及其快照。

## 后果

登录未带来可用提供商的用户会直接落在空白 Hero，不再有提示；模型设置页仍是手动配置入口。
