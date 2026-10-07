# Agent Note: The video workbench lands first (oh-story-dsh pattern)

Status: implemented

English | [中文](2026-10-06-video-workbench.zh.md)

## Problem

The community [oh-story-dsh](https://github.com/zenstory-ai/oh-story-dsh) plugin demonstrated three principles by packing four creative workbenches (novel / short drama / game / video recap) into DSH Web: files are the creative facts (the workbench projects project files and writes no parallel database), paid operations confirm first, and the host adds read-only routes while the browser adds a panel. Our H3 video pipeline (`h3-video` + `tool-video`) already lands plans, keyframes, segments, and final assemblies in one output directory — but nothing browses them: users dig through `~/.dsh/cache/video` by hand.

Porting oh-story's client wholesale is neither feasible nor necessary: as an external plugin it can only mount through the `shell.overlay` plus DOM-anchor `createPortal` trick, and it carries a whole drama document protocol (`用途`/`控制` slots) our plan schema has no authored equivalent of.

## Decision

A video workbench v1 following oh-story's projection principles on this repository's regular extension points:

- **Host half** (`dsh-experimental-video-workbench`, a HOST row of the web-app bundle): two read-only routes. `GET /api/video-workbench/projects` scans `plans/*.json` reporting per-shot on-disk state (multi_shot collapses onto the synthetic `all` segment; a corrupt plan degrades to one error row); `GET /api/video-workbench/file?path=` serves one whitelisted file. `outputDir` defaults to `dshCachePath('video')` — the same directory the h3-video service defaults to, so a stock deployment configures nothing.
- **Containment**: the requested path is first split into plain name segments (rejecting `..`, drive letters, `<>:"|?*`, and NUL), joined segment-by-segment under the projected root, resolved through `realpath` on both ends, and re-checked with `relative` — a symlink inside the directory pointing outside is refused too. Extension whitelist (text/image/video/audio), 256 MB per file.
- **Browser half** (`dsh-client-ui-video-workbench`, a client row of the patch): the layout's global-panel mechanism, not a DOM portal — one `sidebar.panellist` row (id `video-workbench`, the ui-schedule-work pattern) plus the keyed `main` page. Catalog column on the left; keyframe thumbnails, per-shot state, and the final `<video>` on the right; refresh on open, every 10 seconds, and on the button; copy through the `videoWorkbench` dictionary namespace.
- **No write path**: the workbench is invisible to the model loop (no tools, no session events); the browser's only capability is reading. Rendering still flows through `tool-video`'s `/video` pipeline.

## Alternatives considered

- **Porting oh-story's whole client (overlay + portal).** Rejected: in-repository plugins have the regular slot mechanism; querySelector anchors are a fragility we will not accept.
- **New holes in ui-sidebar/ui-conversation.** Rejected: `sidebar.panellist` + the keyed `main` slot already cover "sidebar entry + global panel"; more holes would be needless contract growth.
- **Serving data through a Remote instead of HTTP routes.** Rejected: media (mp4) over a JSON Remote means whole-file base64; a same-origin streaming HTTP response feeds `<video>`/`<img>` natively, which is also what oh-story does.
- **Edit/re-render buttons in v1.** Not done: paid operations confirm first is oh-story's red line; the write path belongs to the tool-video flow (which already has its confirmation gate), so the workbench starts as a pure read projection.

## Consequences

- The Web/desktop sidebar gains a video workbench panel; finals and keyframes are viewable on click, without anything from the output directory entering session history.
- Two new packages and two patch rows; `tsconfig.base.json` paths gained the mappings (verify-cordis-config's source-plane requirement), and the web-app and desktop dependency lists gained two rows each.
- Both typecheck aggregates carry their package: `tsconfig.host.json` references the host half and `tsconfig.client.json` the browser half. A new package absent from its aggregate compiles nowhere, so `tsc -b` fails with TS6307 on the package's own relative imports, `tsdown` never runs, and the host half emits no `lib/index.js` — the Loader row then fails to import while the client bundle, built by its own package-local tsdown config, looks healthy. The missing aggregate entry is therefore invisible until the panel fails to appear.
- The listing is one read-only scan every 10 seconds; cost scales with readdir/stat over the output directory, with no pagination yet (project count is the number of `plans/*.json`); a `?since=` query can come later on the route.
- Future workbenches (oh-story's novel/drama shapes) can reuse this "host read-only routes + panellist/main panel" skeleton; the role/skill layers (oh-story's role-tool and skill providers) wait until a workbench needs them.
- The file service has no Range support in v1 (the browser buffers the whole body, then seeks); the Mimosa write gate false-positives the range-header parsing as command injection, so that surface was dropped to land — it can return once the gate rule is corrected.

## References

- oh-story-dsh workbench pattern: its `packages/dsh-plugin/src/client/index.tsx` (slot declaration + projection), `src/workspace-route.ts` (read-only routes + whitelist), `src/client/workbench-presence.ts` (project detection)
- This repository: `packages/experimental/video-workbench/src/{index,projects,file-serve}.ts`, `packages/client/ui-video-workbench/src/client/{index,VideoWorkbenchPage,endpoints,locales}.ts`
- Composition: `packages/bundle/web-app/cordis.patch.yml` (HOST row `video-workbench` + client row `ui-video-workbench`)
- Related note: `2026-10-06-h3-video-oh-story-alignment.md` (the pipeline alignment landed the same day)
