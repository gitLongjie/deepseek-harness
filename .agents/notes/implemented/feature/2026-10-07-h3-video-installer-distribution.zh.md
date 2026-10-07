# Agent Note: H3 视频栈随安装包分发

Status: implemented

[English](2026-10-07-h3-video-installer-distribution.md) | 中文

## 问题

桌面应用已依赖四个 H3 视频包（`dsh-experimental-h3-video`、`dsh-experimental-tool-video`、`dsh-experimental-video-workbench`、`dsh-client-ui-video-workbench`）并挂载了设置卡片与工作台行，但唯一挂载服务与六个模型工具的组合是某位用户本机的 `~/.dsh/.agent-presets/h3-video-director/` 预设——连同其中的机器本地路径（`D:/ComfyUI/...`）。全新安装因此只带着设置卡片和一个空工作台，模型没有任何视频工具：`standard` 预设上的会话对"生成一个视频"只能回答一份 markdown 分镜脚本。本地 ComfyUI 后端完全在包外，其约 40 GB 的 H3 权重也超出 NSIS 安装器能承载的量级。

## 决策

分发走桌面已有的通道，外加一个可选载荷：

- **随包预设**：`apps/desktop/config/agent-presets/h3-video-director/`（用户预设的副本加其 `preset.yml`）——boot 本就把 `config/agent-presets` 以 system-trust 注入 agent-presets roots，每台安装都能列出并聘用视频导演。其本地后端路径改为 `~` 展开的用户数据路径（`~/AppData/Local/DeepagensWork/comfyui/...`），各部署可通过既有 `h3-video` 设置命名空间覆盖。
- **工作流模板进 asar**：`apps/desktop/config/comfyui/h3-t2v-api-template.json`（复制自工作中的 ComfyUI models 树；预设里旧路径比真实文件少了一层目录）。`files` 通配 `config/**` 本就携带它。
- **可选 ComfyUI 载荷**：`deploy-app.mjs` 把 `apps/desktop/resources/comfyui-dist`（仅程序树——python_embeded、ComfyUI 源码、H3 节点；绝不带权重）通过 `desktop-oem-config.mjs` 上经校验的 `extraResources` overlay 打到应用旁。目录缺失则不带它打包；载荷目录除 README 外整体 git-ignore。
- **首启部署**（`apps/desktop/src/main/desktop/comfyui-bootstrap.ts`）：host 启动后，打包应用把载荷一次性复制进 `%LOCALAPPDATA%/DeepagensWork/comfyui`（标记 `.comfyui-dist-v1`，用户改动永不覆盖），并总是补齐 `models/h3-t2v-api-template.json`。fire-and-forget：复制耗时数分钟，期间外壳靠远端 MiniMax 后端照常工作，失败只记日志不阻塞。

## 备选方案

- **把服务与工具挂进 web-app 宿主组合。** 本次分发否决：realm 语义（预设的 `isolate: { h3Video: true }` 组）正是为按会话挂视频而设；宿主面挂载会改变所有预设的可用性与计费姿态，那是不该由这次改动代做的产品决策。
- **权重进安装包。** 算术上否决：diffusion_models 20 GB + text_encoders 15 GB + checkpoints 4 GB 对 NSIS 上限。用户自行把权重放进部署树（随包模板列出了文件名），或走远端后端。
- **首启下载器替代随包程序树。** 暂缓：它需要桌面尚不拥有的托管 URL 与进度 UI；随包程序树今天即可离线工作，也不妨碍日后为权重加下载器。

## 后果

- 每台安装都能列出"H3 视频导演"预设；聘用即得六个视频工具（`video_plan`、`video_keyframes`、`video_assets`、`video_asset_images`、`video_render`、`video_assemble`）与导演 persona。`standard` 预设不变——普通会话自动生成视频仍是有意的非目标。
- 预设的 `comfy.workflowPath`/`inputDir` 现假定部署树位置；ComfyUI 跑在别处的机器通过 H3 设置卡片（服务本就叠加 `h3VideoSettings` overlay）覆盖。
- 把 ComfyUI 程序树放进 `apps/desktop/resources/comfyui-dist/` 会让安装包按其体积增大（典型 2–3 GB）；首启花数分钟复制，日志行会叙述。
- 部署标记版本（`.comfyui-dist-v1`）是重部署开关：改常量即向既有安装推送新程序树。
- 这里没有任何东西启动 ComfyUI：用户（或未来的桌面伴生进程）仍要在 :8188 拉起它。进程看护是后续工作。

## 参考

- 预设唯一事实源：`apps/desktop/config/agent-presets/h3-video-director/agent.cordis.yml`
- 载荷契约：`apps/desktop/resources/comfyui-dist/README.md`
- 接线：`apps/desktop/scripts/deploy-app.mjs`（`extraResources` overlay）、`apps/desktop/scripts/desktop-oem-config.mjs`、`apps/desktop/src/main/index.ts`（boot 后调用）、`apps/desktop/src/main/desktop/comfyui-bootstrap.ts`
- 相关 note：`2026-10-06-video-workbench.md`（本分发所呈现的工作台）、`2026-10-03-h3-video-user-settings.md`（路径回退所依赖的设置 overlay）
