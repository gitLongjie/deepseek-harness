# Agent Note: 桌面产物经打包启动冒烟门禁发布

Status: implemented

[English](2026-09-03-desktop-packaged-smoke-gate.md) | 中文

## 问题

桌面安装包反复出现少带一份运行时资源的问题——本地 dsh-im 运行时、esbuild 平台二进制、前端 dist、Node 模式沙箱 runner 的解包闭包——而且每次缺失都只在装好的副本上才暴露，因为打包到发布之间没有任何环节真正启动过产物。CI 在三个平台打包但从不启动产物，发布任务直接从构建作业上传。完整性知识散落在若干手工清单里——`electron-builder.yml` 的 `asarUnpack` glob、`deploy-app.mjs` 的暂存步骤、`import.meta.url` 相对目录——没有任何自动校验把它们与应用运行时真正读取的内容关联起来，打包应用自身也不会在缺资源时拒绝启动，而是带着静默故障上场。

## 决策

- 桌面包自己拥有 `src/main/desktop/packaged-resources.ts`，作为磁盘运行时资源的单一事实来源：`ASAR_UNPACK_GLOBS` 由 `deploy-app.mjs` 从构建产物导入并注入生成的 electron-builder overlay；`findMissingPackagedResources` 是启动期完整性断言。`electron-builder.yml` 不再声明 `asarUnpack`；清单与断言同属一个模块，无法漂移。
- 每次打包态启动在宿主树挂载前先断言完整性——web dist、内置 agent 预设、桌面 patch、workflow worker 入口，Windows 上还有沙箱 runner 链与 koffi 的解包孪生——缺失时响亮失败：本地化原生对话框加日志、退出码 1，而不是半残运行。
- `DSH_PACKAGED_SMOKE=1` 把打包应用变成冒烟目标：门禁脚本以隔离的 `userData`、`DSH_HOME`、日志和结论文件路径启动它；宿主启动完成后，主进程执行自检套件而非进入 shell——三个已就绪的 IPC 载体服务、一次 preset 名册读取（每个随附 preset 都必须能从打包 node_modules 解析）、真实的前端 index 渲染、ripgrep 实际 spawn、workflow worker 子路径经打包 node_modules 的解析，以及 Windows 上的 koffi 原生加载（走归档侧解析）和一次 Node 模式沙箱 runner 运行——runner 必须以 `windows-acl-run:` 坏参数签名、退出码 127 应答；没有该签名的退出码 0 正是历史上"启动了第二个应用实例"的故障形态，因此签名而非退出码才是通过条件。
- `pnpm --filter @deepseek-ai/dsh-desktop run smoke` 打包 `--dir` 产物、启动真实解包产物、按结论门禁；`--publish` 仅在冒烟通过后执行发布构建。发布 workflow 的各平台任务在构建与上传之间运行这道门禁，打包面的改动在 pre-push 证据里也包含冒烟。

## 已考虑的替代方案

**CI 只构建不启动，继续扩静态 glob。** 更便宜，但静态完整性看不到运行时会读什么；esbuild 平台二进制连续五次修复，以及 dsh-im、前端 dist、runner 的漏带，全部源自这种盲区。

**只做启动期响亮断言，不设冒烟门禁。** 断言只覆盖有人记得写进清单的资源，且只检查存在、不检查可加载。冒烟能抓住任何参与启动的缺失资源，并真正执行文件检查做不到的加载与 spawn（原生绑定、Node 模式 runner、ripgrep）。

**先发布再对发布资产做金丝雀冒烟。** 否决：冒烟运行时坏产物已经是正式发布，更新频道的用户正在消费它。

**把冒烟放进 PR 打包矩阵（`desktop-build.yml`）。** 暂缓：它会给每个桌面 PR 增加数分钟，而不可恢复的时刻是发布而非 PR 评审；门禁属于发布 workflow。

## 后果

发布 workflow 现在每个平台构建两次桌面（冒烟的 `--dir` 运行，再加发布构建），冒烟增加一次启动量级的时间；本地迭代可对既有 `dist-electron` 产物用 `--skip-build` 重跑。换来的：没有任何未经启动验证资源集的产物到达发布或用户；打包清单的回归在门禁处失败并指名缺失资源；未来任何绕过门禁的缺失仍会在启动期以本地化对话框响亮失败，而不是静默错乱。仅 Windows 的孪生断言保持平台限定，非 Windows 产物既不误报也不静默跳过自己平台的检查。冒烟沿用了应用的单实例锁设计，因此门禁在模块初始化前隔离 `userData`——正是当年吞掉 runner 启动的那把锁。

## 测试

`apps/desktop/tests/packaged-resources.spec.ts` 在打包与 checkout 两种布局、两个平台上钉住清单 glob 与逐标签的缺失报告；`builder-identity.spec.ts` 覆盖 overlay 携带 `asarUnpack` 的契约。端到端门禁是 `pnpm --filter @deepseek-ai/dsh-desktop run smoke`：Windows 上启动真实产物并全绿通过；发布 workflow 在三个平台重复同一步骤。
