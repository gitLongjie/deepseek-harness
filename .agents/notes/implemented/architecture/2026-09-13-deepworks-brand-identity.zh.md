# Agent Note: 深度Work 品牌身份与云海标志

Status: implemented

[English](2026-09-13-deepworks-brand-identity.md) | 中文

## 问题

产品存在两套互相矛盾的 身份:运行时显示名来自 `oem.config.json`(`深度Work`),而安装器身份是 `desktop-oem-config.mjs` 与 `electron-builder.yml` 中硬编码的 ASCII `MeowWork`——于是一个名为 深度Work 的产品,在 Windows 上呈现的是 `MeowWork` 的路径、快捷方式与卸载条目。所有用户可见文案(登录标题、侧边栏品牌、harness 身份句、Web GUI 字符串)仍写着 MeowWork,应用图标也还是被替换的猫头标志。

## 决策

`oem.config.json` 的 `productName`(深度Work)同时作为运行时显示名与安装器身份的唯一来源:`createElectronBuilderOemConfig` 不再硬编码产品名,`executableName`、`shortcutName`、`uninstallDisplayName` 与全部平台的 `artifactName` 都携带 OEM 名称。磁盘安装目录通过 `perMachine: true` 加 `build/installer.nsh` 中的 `customInit` 宏固定为 ASCII 的 `C:\Program Files\DeepagensWork`,非 ASCII 的显示名改名不会移动安装路径。打包包名 `name` 为 ASCII 的 `DeepagensWork`:electron-builder 由它推导 `APP_FILENAME` 做目录净化,ASCII 值保证显示名为非 ASCII 时该检查依然稳定。

标志为云海 D(`apps/desktop/build/反白上下源文件.png`,454×454):ICO 含七帧 PNG(16–256),`icon.png` 为 512,`MewoLogo` 与 boot 页以 72×72 data URI 内嵌,`favicon.svg` 包裹同一 PNG。技术身份保持不变——`appId com.meowwork.app`、AUMID `ai.deepagens.worker`、发布仓库 `gitLongjie/miaoWorker`——改名对用户不可见,却会破坏更新检测与任务栏分组。

## 已否决的替代方案

**保留 ASCII 安装器身份(MeowWork/DeepagensWork),深度Work 仅用于显示。** 否决:部署方要求快捷方式、卸载条目与发布资产上就是产品名本身,而不是音译。

**随品牌一起改名 `appId` 与 AUMID。** 否决:二者是不可见的标识符,变更会破坏更新检测与任务栏分组;可见的改名并不需要它们。

## 后果

发布资产变为 `深度Work-<version>-*.exe`——GitHub release 上首次出现非 ASCII 资产名。electron-publish 会对 URL 编码,但若发布流程拒绝,`artifactName` 是回退到 ASCII 值的唯一旋钮。安装目录与 Electron user-data 目录都从显示名推导,OEM 改名会同时移动 `C:\Program Files\…` 与 `%APPDATA%\…` 且不迁移既有状态——固定的 DeepagensWork 目录把这一风险限制在 user-data 一侧。

## 验证

`apps/desktop/tests/builder-identity.spec.ts` 钉住安装器身份(可执行名、快捷方式、卸载显示、资产名、每机器标志、`installer.nsh` 固定)与 OEM overlay 投影。图标管线通过 Windows Shell API 提取品牌化可执行文件的图标组并渲染验证;安装器只嵌入新标志(与旧标志 PNG 条目做长字节比对)。
