# Agent Note: The local video backend provisions its own AutoDL GPU

Status: implemented

[English](2026-10-18-autodl-gpu-provisioning.md) | 中文

## Problem

`h3-video` 的本地后端此前只能针对别人一直开着的 ComfyUI 服务器渲染。`comfy.url` 是固定地址，因此没有可用 GPU 的机器根本走不通本地生成；而租用 GPU 的运维者必须手工创建实例、启动 ComfyUI、把关键帧拷进去、渲染期间守着、结束后再释放。本记录针对的部署会为 768P H3 片段租用 AutoDL 容器实例：它希望 harness 在有任务时创建实例、整条渲染中复用、任务结束后停止付费，并且账号 token 从配置解析。

## Decision

`comfy.gpu` 行让本地后端自备机器。该行以 `gpuSpecUuid` 为锚点；缺少它时 GPU 不受管理，沿用 `comfy.url`。行内携带 AutoDL 算力规格、启动镜像、CUDA 下限、GPU 数量、磁盘扩容、地区列表、实例名、开机命令、服务端口、轮询/开机/探测/请求超时，以及空闲策略（`idleTimeoutMs`、`idleAction`、`releaseOnDispose`）。

生命周期是一个厂商中立的接口。`GpuVendor` 暴露实例操作（`list`、`create`、`status`、`powerOn`、`powerOff`、`release`、`serviceUrl`），`GpuInstancePool` 只持有单个实例：按 `instanceName` 复用账号下已有实例、把已关机实例重新开机、等待 `status: running`、从实例快照读取映射的服务域名、持续探测 `/system_stats` 直到 ComfyUI 应答，并对外给出解析后的地址。厂商不向池贡献任何字段；`createAutoDLVendor` 绑定 AutoDL 的创建体。

ComfyUI provider 每次操作都向池要地址（`resolveBaseUrl`），因此一次渲染的首次提交会开机，而轮询继续使用池缓存的地址。客户端侧，AutoDL 的 `{ code, msg, data, request_id }` 信封会被解包或抛成 `AutoDLError`；两个 GET 端点把字段作为查询参数发送，因为 `fetch` 拒绝 GET 带 body；无 scheme 的 `service_<port>_domain` 补成 `https://…`，而已自带 scheme 的值按原样使用。

`submit` 在入队前为本地路由获取池，`poll` 在任务结算或抛错时释放占用，`cancel` 同样如此，因此空闲计时衡量的是真实工作而不是提交动作。创建实例后开机的失败同样会启动该计时，因为实例仍在计费。实例上仍有任务时，显式 `stop` 与 `release` 会被拒绝，因此模型发出的释放不会在渲染过程中拆掉机器；销毁时按 `releaseOnDispose` 强制释放。`idleAction` 默认 `power_off`——结束 GPU 计费并保留已安装环境——而 `release` 会删除实例及其磁盘。

没有本地输入目录时图像条件依然可用：`comfy.inputDir` 缺席时，关键帧与参考图通过 ComfyUI 的 `/upload/image` 端点上传。因此 `comfy.gpu` 会在加载时拒绝 `comfy.inputDir` 与 `comfy.url`：地址由实例提供，而本进程无法写远端目录。

该行中由 `./settings` 覆盖拥有的是 token 引用：插件卡片编辑 `gpuApiTokenRef`，密钥经凭据域写入；算力规格、启动镜像、实例名与开机命令仍留在组合里。token 每次请求都通过 `ctx.credentials` 解析，因此轮换凭据无需重载组合即可生效。字面量 `apiToken` 仅供测试场景使用。

三个服务方法与 `video_gpu` 工具把生命周期暴露给模型：`gpuStatus`（跟踪实例时刷新厂商状态）、`gpuUp`（开机或复用并等待 ComfyUI）、`gpuDown('stop' | 'release')`。本地 `video_render` 会隐式开机；`video_gpu up` 只是把开机失败提前暴露。

## Alternatives considered

- **让 ComfyUI provider 直接调用厂商。** 否决：provider 就得承载 AutoDL 的信封、端点与开机编排，第二个后端还要重复一遍。由池拥有生命周期，provider 只请求地址。
- **要求预先开机的实例并继续用 `comfy.url`。** 否决：运维者渲染之间一直在付费，还要重复手工创建/释放，而这正是本记录要解决的问题。
- **开机失败时回退到托管 API。** 否决：托管后端按秒计费，而组合的契约是不存在隐式切换成本模型的调用路径。开机失败就以模型可读的原因让该片段失败。
- **单独的云 GPU 包。** 暂缓：目前只有一个消费者，包边界会为一个只有单一实现的接口增加清单、聚合条目与文档。`GpuVendor` 把厂商替换能力留在 `h3-video` 内，直到出现第二个消费者。
- **把 AutoDL 的 snapshot 与 status 按 GET 带 JSON body 发送。** 否决：标准不允许且全局 `fetch` 会抛错；线上 API 接受查询参数形式的字段。
- **默认空闲即释放。** 否决：释放会销毁实例磁盘，因此默认只关机，删除交给显式动作或 `releaseOnDispose`。

## Consequences

- 本地渲染可以跑在本机没有的硬件上。一次渲染的首次提交要等待创建、开机与 ComfyUI 就绪（受 `bootTimeoutMs` 约束），因此首次 `job_output` 比纯生成时间到得更晚。
- 成本控制是显式的：空闲计时从最后一个任务结算时开始，字面量策略决定关机还是释放。进程崩溃最多留下一个实例，直到运维者或下一次 `video_gpu` 调用处理它。
- 新的失败模式会到达模型：无库存、开机超时、开机命令始终没启动 ComfyUI、缺少 token，都会以指名实例的原因使本地提交失败。
- 图像条件对远端服务器换了形态：`/upload/image` 成为第二条上传路径，`comfy.inputDir` 的已知限制收窄到本地部署。
- 配置面多了一行。AutoDL 实例名在账号内全局，因此两个共享账号与 `instanceName` 的 harness 进程会复用同一实例，而不是各持一个。

## References

- [AutoDL 容器实例 Pro API](https://api.autodl.com/docs/instance_pro_api/)——创建、快照、状态、列表、开关机、释放，以及算力规格表。
- [AutoDL API 鉴权](https://api.autodl.com/docs/common_api/)——携带开发者 token 的 `Authorization` 头。
- [H3 视频生成工具](2026-09-29-h3-video-generation-tools.zh.md)——本记录所扩展的接口、provider 与素材优先流程。
