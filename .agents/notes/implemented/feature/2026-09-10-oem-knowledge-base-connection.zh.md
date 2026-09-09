# Agent Note:OEM 拥有的知识库连接

Status: implemented

[English](2026-09-10-oem-knowledge-base-connection.md) | 中文

## 问题

知识库连接此前只存在于 web bundle 的 patch 行(硬编码的 localhost baseUrl)与手工导出的环境变量里。OEM 部署——由 `oem.config.json` 构建的打包桌面应用——没有地方声明产品连接哪个 WeKnora 部署。

## 决策

`oem.config.json` 增加受校验的 `knowledgeBase` 段(baseUrl、apiKeyEnv、可选 tenantId 与 webUiUrl;密钥本体永不进入该文件——只有凭据引用名)。桌面主进程优先从源码树的 `oem.config.json` 解析,否则用打包覆盖层烘进应用清单 `extraMetadata.dsh` 的段(更新源的双路先例),并在分层快照冻结之前注入环境——不替换启动环境已拥有的值。kb-weknora 提供者把 yml 缺席的连接字段经信任环境层(`$WEKNORA_BASE_URL`、`$WEKNORA_API_KEY_ENV`、`$WEKNORA_TENANT_ID`、`$WEKNORA_WEB_UI_URL`)解析再到内置默认,镜像 llm-deepseek 的端点回退;bundle 行不再钉死 `baseUrl`,回退链因此保持存活。

优先级自高到低:显式 cordis.yml 配置、导出变量、OEM 段、`.env` 层、内置本地默认。

## 备选方案

**打包时把该段写进 profile patch。** 否决:patch 行需要生成、用户无法看到或覆盖结果;环境层已有明确的优先级,插件接缝也已解析它。

**插件直读 `oem.config.json`。** 否决:插件将依赖打包布局中不存在的仓库根文件,OEM 身份会泄漏到拥有它的启动器边界之下。

**把 API 密钥放进 OEM 文件。** 否决:OEM 文件是被提交的构建输入;密钥留在凭据接缝的引用名之后。

## 后果

打包部署纯在 `oem.config.json` 里配置知识库端点;源码运行可继续用导出变量或 `.env`。客户端构建校验该段,畸形值让构建失败而不是让启动的应用失败。

## 验证

`scripts/oem-config.client.spec.ts` 覆盖段解析、投影与拒绝。`kb-weknora` 提供者测试覆盖环境回退链(无配置时取环境、显式配置压过环境、本地默认低于两者)。桌面 spec 覆盖源码文件优先于清单、段校验、以及 apply-if-unset 语义。
