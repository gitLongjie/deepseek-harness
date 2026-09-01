# Agent Note: macOS bundles without a signing certificate are ad-hoc sealed after pack

Status: implemented

[English](2026-09-02-macos-adhoc-seal-after-pack.md) | 中文

## 问题

以 `mac.identity: null` 构建的桌面版发布产物，其应用 bundle 会被 macOS Gatekeeper 报告为**「已损坏，无法打开」**——完全没有任何绕过入口——出现在 macOS Sequoia（以及 14.x 的 arm64）。DMG 本身完好（已发布资产的 sha256 摘要可验证、UDIF `koly` 尾部魔数存在），因此用户把完全正常的下载读成了文件损坏。v1.1.0 发布版在 Apple Silicon + Sequoia 上正好命中。

`identity: null` 让 electron-builder 完全跳过签名，这比"未签名"更糟：Electron 的各个 binary 只保留各自的**linker 签名**（`flags=0x20002 (adhoc,linker-signed)`），bundle 没有 `_CodeSignature/CodeResources`，`codesign --verify --deep --strict` 报错 "code has no resources but signature indicates they must be present"。签名承诺密封一个并未密封的 bundle，macOS 把这种破损的密封呈现为"已损坏"——死路一条：macOS 15 移除了右键 → 打开的绕过方式，且对"已损坏"的应用不提供"仍要打开"按钮。

## 决策

`build/afterPack.cjs` 挂在 electron-builder 的 `afterPack` 阶段——bundle 组装完成之后、dmg 与 zip 目标构建之前——仅在 `darwin` 上用 ad-hoc 签名密封 bundle（`codesign --force --deep --sign -`），随后做严格验证（`codesign --verify --deep --strict`），密封破损时大声失败构建。钩子在 `CSC_LINK` 或 `CSC_NAME` 存在时直接返回，因此将来配置真实签名证书时无需改配置即可替换它；`mac.identity`/`hardenedRuntime`/`entitlements` 为那条路径原样保留。

结果是带**有效 ad-hoc 签名**的 bundle：Gatekeeper 以普通的"无法验证开发者"对话框拦截，用户通过 系统设置 → 隐私与安全性 → 仍要打开 一次性放行（或在终端执行 `xattr -dr com.apple.quarantine /Applications/Deepagens-Worker.app`）。无需 Apple 开发者账号。

## 已考虑的替代方案

**保留 `identity: null`，只写终端命令文档。** `xattr -dr com.apple.quarantine` 确实能解锁当前发布版，但每个用户都要先撞上无解的"已损坏"对话框，且文档里右键 → 打开的路径在 Sequoia 上已不存在。否决其作为唯一修复；保留作为 v1.1.0 下载的文档化后备。

**升级 electron-builder v27，其 `mac.sign.identity: "-"` 原生支持 ad-hoc 签名。** 升级是一次破坏性迁移（签名选项移入 `mac.sign`、asar 与 target 模式变更），影响所有平台的构建，却只为一行 mac 修复。暂否决；v27 迁移时是移除钩子的自然时机。

**真实 Developer ID 签名加公证。** 正确的长期答案（还能恢复 macOS 自动更新——Squirrel.Mac 拒绝非 Developer ID 构建的应用内更新，ad-hoc 也一样）。它需要付费证书与 APPLE_* 密钥；配置已为其预接线，钩子会自动让位。

## 后果

每个未签名 mac 产物都被密封：Gatekeeper 流程变得可恢复，打包后的应用通过 `codesign --verify --deep --strict`，密封破损会在 CI 构建期失败而不是在用户的 Mac 上。签名仍是 ad-hoc——没有 TeamIdentifier、没有公证——所以 Gatekeeper 仍会拦一次（仍要打开），且在配置真实 Developer ID 签名之前 macOS 应用内更新不可用。

## 测试

钩子的 darwin 分支跑在 `desktop-build.yml` 的 macos 作业（以及发布流程）上，严格验证在那里为构建把关；非 darwin 空操作与钩子加载已在 Windows 上验证，`electron-builder --dir` 接受 `afterPack` 键。诊断密封问题前，已通过 sha256 与 UDIF 尾部验证已发布的 v1.1.0 DMG 资产完好。
