# comfyui-dist: the optional bundled ComfyUI payload

Drop a ComfyUI **program tree** here to ship a local video backend with the
installer. `scripts/deploy-app.mjs` picks the directory up automatically and
packs it beside the app under `resources/comfyui-dist/` (electron-builder
`extraResources`); an absent or empty directory packages without it and the
shipped `h3-video-director` preset runs on the remote MiniMax backend only.

What belongs here — program files only:

- a portable Python (`python_embeded/` with torch + ComfyUI dependencies)
- the ComfyUI source tree (`ComfyUI/`, or the portable layout's inner repo)
- the H3 ComfyUI custom nodes (`nodes_minimax_h3.py` and friends)

What never belongs here — the first launch would copy it all into
`%LOCALAPPDATA%/DeepagensWork/comfyui` for nothing:

- model weights (`models/diffusion_models`, `models/text_encoders`,
  `models/checkpoints` — the H3 set is ~40 GB; users place weights into the
  deployed tree's `models/` themselves, matching the bundled
  `config/comfyui/h3-t2v-api-template.json` names)
- `models/input/` scratch and anything under `output/`

Everything in this directory is committed-or-ignored by you: the repository
ignores nothing here automatically, so keep the payload out of git (the tree is
machine-local, typically several GB).

First launch (packaged app, Windows) copies this tree once into
`%LOCALAPPDATA%/DeepagensWork/comfyui`, marks the copy with
`.comfyui-dist-v1`, and never overwrites it afterwards; the H3 workflow
template is (re)placed at `models/h3-t2v-api-template.json` from inside
app.asar whenever missing.
