# Agent Note:侧边栏知识库分区

Status: implemented

[English](2026-09-08-sidebar-knowledge-base-section.md) | 中文

## 问题

harness 此前无法命名企业知识部署所暴露的内容。单独挂载的 `dsh-weknora` 插件给了模型检索工具,但 Web 客户端无法列出知识库;侧边栏浏览区是单一的 `sidebar.workspaces` 占用者,加上一个独立的新会话大按钮,没有第二个浏览分区的位置。

## 决策

知识库能力做成镜像 market 家族的三角色接缝:`dsh-kb` 声明 `ctx.knowledgeBase`(列表加部署控制台 URL),`dsh-kb-weknora` 以每次读取一个有界 `GET /knowledge-bases` 加逐次凭据解析实现它,`dsh-kb-gateway` 把它投影到 `knowledgeBase` Remote 命名空间。侧边栏 shell 在工作区区域之上声明 `sidebar.knowledge` 洞,新的 `dsh-client-ui-knowledge-base` 浏览器插件填充它:可折叠分区,带内联搜索、部署控制台动作,以及每个库一行、点击即新建会话的行。新会话控件从立体 pill 降级为扁平列表行,但保持固定位置与竖轨图标,最高频动作因此永不滚出屏幕。

WeKnora 的 base URL 是部署自有的内网配置,因此提供者刻意不设公网地址守卫——市场传输的 HTTPS-only 公网主机规则在此不适用。企业可见性留在知识服务一侧:列出的库就是所配置凭据可读的全部。检索被延期:接缝在消费方需要之前只承载列表,行点击在按会话的 agent preset 能限定知识工具之前只开启普通会话。

## 备选方案

**在 ui-workspace 的浏览器内部渲染该分区。** 否决:知识库不是 workspace 域的状态;shell 本就拥有侧边栏子树,兄弟声明的洞让域所有权保持干净。

**客户端直连 WeKnora 获取列表。** 否决:API 密钥会到达浏览器,宿主信任围栏存在的意义正是把部署凭据留在服务端。

**把检索内容自动注入每次请求。** 否决:这是模型可见上下文,需要新的 `SessionEventMap` 成员来满足模型可见即可日志重建,而模型主动调用工具的流程以更低成本满足同一需求。

## 后果

部署在 Web bundle 中默认得到知识分区;移除三个 bundle 行即关闭该界面,失败的列表退化为重试行而非坏掉的区域。提供者与 WeKnora Go 类型之间的契约漂移会响亮失败(非数组列表、缺 id 的库),而非静默清空侧边栏。按所选库限定会话工具,以及接缝上的检索动词,仍是后续工作。

## 验证

`dsh-kb` 测试覆盖服务定义注册;`dsh-kb-weknora` 测试覆盖加载期配置失败、请求形状与请求头、逐次凭据解析,以及每一条传输/契约失败分支;`dsh-kb-gateway` 测试覆盖线面投影;`ui-knowledge-base` 测试覆盖分区状态、折叠持久化、搜索、竖轨与浏览器插件注册。侧边栏 shell 快照已为新插槽锚点与改样的新会话行刷新。
