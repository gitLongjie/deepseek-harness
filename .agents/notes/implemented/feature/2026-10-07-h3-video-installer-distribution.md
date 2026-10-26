# Agent Note: The H3 video stack ships with the installer

Status: implemented

English | [中文](2026-10-07-h3-video-installer-distribution.zh.md)

## Problem

The desktop packages depend on the four H3 video packages (`dsh-experimental-h3-video`, `dsh-experimental-tool-video`, `dsh-experimental-video-workbench`, `dsh-client-ui-video-workbench`) and mount the settings card plus the workbench rows, but the only composition mounting the service and its six model tools was one user's local `~/.dsh/.agent-presets/h3-video-director/` preset — machine-local paths (`D:/ComfyUI/...`) included. A fresh install therefore shipped the settings card and an empty workbench while the model had no video tools at all: sessions on the `standard` preset answered "generate a video" with a markdown storyboard. The ComfyUI local backend lived entirely outside the package, and its ~40 GB of H3 weights exceed what an NSIS installer can carry.

## Decision

Distribution rides the channels the desktop already owns, plus one optional payload:

- **Shipped preset**: `apps/desktop/config/agent-presets/h3-video-director/` (copy of the user preset plus its `preset.yml`) — boot already forces `config/agent-presets` into the agent-presets roots as system-trust, so every install lists and can hire the video director. Its local-backend paths became `~`-expanded user-data paths (`~/AppData/Local/DeepagensWork/comfyui/...`), overridable per deployment through the existing `h3-video` settings namespace.
- **Workflow template in asar**: `apps/desktop/config/comfyui/h3-t2v-api-template.json` (copied from the working ComfyUI models tree; the preset's old path was one directory short of the real file). The `files` glob `config/**` already carries it.
- **Optional ComfyUI payload**: `deploy-app.mjs` packs `apps/desktop/resources/comfyui-dist` (program tree only — python_embeded, ComfyUI sources, H3 nodes; never weights) beside the app through a validated `extraResources` overlay on `desktop-oem-config.mjs`. An absent directory packages without it; the payload directory is git-ignored except its README.
- **First-launch deployment** (`apps/desktop/src/main/desktop/comfyui-bootstrap.ts`): after the host boots, the packaged app copies the payload once into `%LOCALAPPDATA%/DeepagensWork/comfyui` (marker `.comfyui-dist-v1`, user edits never overwritten) and always restores the workflow template at `models/h3-t2v-api-template.json` when missing. Fire-and-forget: deployment takes minutes, the shell runs on the remote MiniMax backend meanwhile, and failures log rather than block.

## Alternatives considered

- **Mounting the service and tools in the web-app host composition.** Rejected for this distribution: realm semantics (the preset's `isolate: { h3Video: true }` group) exist precisely so video mounts per session; a host-plane mount changes availability and billing posture for every preset, a product decision this change does not make.
- **Weights in the installer.** Rejected on arithmetic: diffusion_models 20 GB + text_encoders 15 GB + checkpoints 4 GB against the NSIS ceiling. Users place weights into the deployed tree themselves (the bundled template names the files), or run the remote backend.
- **A first-launch downloader instead of the bundled program tree.** Deferred: it needs a hosting URL and progress UI the desktop does not own yet; the bundled tree works offline today and does not preclude a downloader for weights later.

## Consequences

- Every install lists the H3 Video Director preset; hiring it gives the six video tools (`video_plan`, `video_keyframes`, `video_assets`, `video_asset_images`, `video_render`, `video_assemble`) and the director persona. The `standard` preset is unchanged — automatic video on plain sessions remains a deliberate non-goal.
- The preset's `comfy.workflowPath`/`inputDir` now assume the deployed tree's location; machines running ComfyUI elsewhere override through the H3 settings card (the `h3VideoSettings` overlay the service already layers).
- Dropping a ComfyUI program tree into `apps/desktop/resources/comfyui-dist/` grows the installer by its size (typically 2–3 GB); the first launch spends minutes copying it and the log lines narrate that.
- The deployment marker version (`.comfyui-dist-v1`) is the redeploy switch: bump the constant to push a new program tree over an existing install.
- Nothing here starts ComfyUI: the user (or a future desktop companion) still launches it on :8188. Process supervision is future work.

## References

- Preset source of truth: `apps/desktop/config/agent-presets/h3-video-director/agent.cordis.yml`
- Payload contract: `apps/desktop/resources/comfyui-dist/README.md`
- Wiring: `apps/desktop/scripts/deploy-app.mjs` (`extraResources` overlay), `apps/desktop/scripts/desktop-oem-config.mjs`, `apps/desktop/src/main/index.ts` (post-boot call), `apps/desktop/src/main/desktop/comfyui-bootstrap.ts`
- Related notes: `2026-10-06-video-workbench.md` (the workbench this distribution surfaces), `2026-10-03-h3-video-user-settings.md` (the settings overlay the paths fall back to)
