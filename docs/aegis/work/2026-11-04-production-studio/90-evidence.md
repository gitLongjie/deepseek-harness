# 已执行验证

2026-11-04：`pnpm exec vitest run apps/desktop/tests/video-production-skills.spec.ts apps/desktop/tests/expert-presets.spec.ts packages/client/ui-video-workbench/tests/browser-plugin.client.spec.ts` 通过 3 个文件、8 项测试，覆盖预设本地技能根挂载、技能实际加载和原有插件行为。

扩展四项独立技能后：`pnpm exec vitest run apps/desktop/tests/video-production-skills.spec.ts packages/client/ui-video-workbench/tests/video-workbench-page.client.spec.tsx` 通过 2 个文件、24 项测试。

加入预览状态回归测试后：`pnpm exec vitest run packages/client/ui-video-workbench/tests/video-workbench-page.client.spec.tsx` 通过 24 项测试。检查导演台、剪辑台和图谱标签的未实现状态明确显示，且保留已有成片入口。

`pnpm exec tsc -p packages/client/ui-video-workbench/tsconfig.json --noEmit` 通过。对本任务路径执行 `git diff --check` 通过。未执行完整 build:artifacts/build:check、真实视频生成、3D 渲染或多轨导出；本轮不存在这些功能已完成的证据。

先前工作台测试失败已定位为 fixture 使用旧 settingsScope 服务，而 locale 当前注入 configForms；更新 fixture 后测试通过。没有用跳过测试或弱化断言掩盖失败。

原生路线确认后的实现验证：作品存储测试 4 项通过，覆盖重开、旧版本保留、跨 store 并发保存、损坏最新版本、无效输入和超限保存。编辑器测试 2 项通过，覆盖保存、冲突保留、撤销重做和放弃草稿确认。共享 transport 测试 1 项通过（修正旧 fixture 缺少 owner Peer），覆盖原文件路由和新增作品新建/读取及无效请求。原页面 24 项、插件注册 6 项通过；合计五个测试文件 37 项，分多次执行。

宿主和客户端包 TypeScript noEmit 检查通过；客户端先因依赖声明尚未生成失败，在宿主声明生成后通过。build:artifacts 已完整通过；随后运行 pnpm run build，对最后的存储改动验证，最终结果待补充。两份 README 中英配对记录已更新。上述检查不替代真实 3D、多轨剪辑或桌面端到端验收。

完整 build 最终结果：8 项通过、2 项失败，失败项为 host aggregate check 和 client aggregate check；全仓日志位于 .tmp/studio-build.log。聚合错误包含无关模块的旧测试接口引用。本任务页面测试中的两处 ByRoleOptions.exact 已移除，并复跑页面和编辑器 26 项通过。最后的浏览器 UUID 修改使用 dsh-util-crypto；客户端包 noEmit 和包 bundle 再次通过。新增五个源码文件通过项目 Oxlint 检查；最初误用 ESLint 时因仓库无该工具配置失败，不能算 lint 通过。完整聚合检查仍未通过，也未在局部修正后重跑全仓。

2026-11-04 后续实现：`pnpm exec vitest run packages/video/video-workbench/tests packages/client/ui-video-workbench/tests apps/desktop/tests/video-production-skills.spec.ts apps/desktop/tests/expert-presets.spec.ts` 最终 11 文件通过，84 项通过、1 项原有跳过。真实 FFmpeg 测试实际执行（不是跳过），导出混合音频和可选字幕 MP4，经 FFprobe 验证流类型与时长；越界源导出拒绝且清理本次输出。工具测试经实际 ToolExecutionPipeline 验证保存、读取、GUI/模型冲突与插件卸载。共享草稿测试跨图谱/画布/剧本切换保存不丢其他字段，导出与技能按钮仅使用已保存版本。

最后完整构建 `.tmp/studio-native-final-build.log`：8 通过，2 失败，耗时 103.83 秒。宿主和客户端 aggregate check 都有既存其他模块错误，本次 video-workbench 相关路径未报错。源码包编译与各类 bundle/Web build 均通过。不得把产物构建通过写成整仓 build 通过。

新增源码定向 Oxlint 通过；宿主与客户端包 tsc 检查通过；本任务路径 git diff --check 通过。两个 README 中英配对检查通过；Windows 对宿主 README.i18n.yaml 的 truncate-open 返回 UNKNOWN，临时脚本用 r+ 文件描述符运行原记录器计算，未修改配对校验规则，随后原配对检查通过。未跑完整 doc-sync、浏览器端到端、真实 GPU 预览或新工具 recorded-session snapshots。
