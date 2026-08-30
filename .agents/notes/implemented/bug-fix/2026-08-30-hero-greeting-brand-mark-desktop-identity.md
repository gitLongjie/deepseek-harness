# Agent Note: Hero greeting, app-icon brand mark, and desktop shell identity

Status: implemented

English | [中文](2026-08-30-hero-greeting-brand-mark-desktop-identity.zh.md)

## Problem

Three user-visible branding defects in the desktop client. The sidebar and the blank-session hero rendered a leftover whale mark (an inline data URI in `MewoLogo`, mirrored in the web boot page) that does not match the shipped app icon in `apps/desktop/build/icon.png`, so the running product showed two contradictory logos at once. The hero headline was a fixed tagline plus a release-stage badge (`探索未至之境`/`Into the Unknown` and `预览版`/`Preview`) — static marketing copy where a greeting could sit. And a Windows development launch (`pnpm dev`) presented itself as "electron" with Electron's atom icon in the taskbar and Task Manager because the main process set no application identity and the launcher ran the unmodified `electron.exe`.

## Decision

**One brand mark: the app-icon artwork.** `packages/client/ui-primitives/src/MewoLogo.tsx` and the boot-page copy in `packages/client/web/src/boot-page.ts` inline a 72px square render of `apps/desktop/build/icon.png`. The mark is square (`MARK_SOURCE_WIDTH`/`MARK_SOURCE_HEIGHT` both 72 in the primitives component) and keeps flowing through the existing brand slots to the hero, the sidebar wide header and rail, and the boot wordmark. The tray keeps `tray.ico`, which already carried the same art.

**The hero greets by local time.** `packages/client/ui-conversation/src/client/skeleton/hero-greeting.ts` buckets the local hour into five slots — morning from 05:00, noon from 11:00, afternoon from 14:00, evening from 18:00, night from 23:00, with 00:00–04:59 staying night — and `heroGreetingKey` returns the matching `hero.greeting.<slot>` locale key. `HeroShell` renders `t(heroGreetingKey())` in place of the old headline and badge; the badge element, its CSS column, and the `hero.headline`/`hero.preview` dictionary entries are gone from both dictionaries, and the `en` dictionary's `Record<ConversationKey, string>` typing keeps the key sets in parity. The Chinese lines share the tagline tail (`早上好，去探索未至之境` … `深夜好，去探索未至之境`); English has no noon or late-night greeting idiom, so `hero.greeting.noon` and `hero.greeting.night` read `Good afternoon. Explore the unexplored.` and `Burning the midnight oil. Explore the unexplored.`

**The desktop shell and executable carry the same identity.** At module load in `apps/desktop/src/main/index.ts`, `app.setName(DESKTOP_WINDOW_TITLE)` and, on win32, `app.setAppUserModelId('ai.deepseek.works')` — the electron-builder.yml `appId`, so dev and packaged share one taskbar identity — run before `installSingleInstanceLock`. The new id avoids reusing the Windows taskbar icon cache previously associated with the Electron development launcher. Harness data stays under `~/.dsh` via `resolveDshHome`, independent of the app name; only `desktop.log` and the updater cache folders move. On Windows, `apps/desktop/scripts/dev.ts` copies Electron beside the original executable as `深度Works-dev.exe` and writes the committed multi-size `build/icon.ico`, product name, description, and version into the copied PE resources before launch. The builder's global and Windows icon settings write the same artwork into the packaged `深度Works.exe`.

## Alternatives considered

**Keep the release badge beside the greeting.** Rejected: the badge is release-stage metadata, not identity; the version already surfaces in the sidebar local-build mark, the About menu, and the updater.

**Set the AppUserModelId only.** Rejected: the app name also feeds the macOS menu bar and about panel, and userData-derived paths should not depend on whichever name the dev manifest and the packaged manifest happen to carry.

**One interpolated headline key with a time parameter.** Rejected: the five buckets are a closed choice of wording, which belongs in the dictionaries, so each locale owns its full greeting line.

## Consequences

The product shows one mark everywhere, and the hero reads as a greeting rather than an advertisement. The time-of-day slot is derived at render from the OS-local clock: no session event and no model-visible input, so the model-visible-or-logged rule is not engaged. Development and packaged launches share the Windows taskbar identity, and both the Task Manager Apps row and process view read 深度Works and the boat icon from the executable resources. The development copy lives beside Electron so Chromium can resolve its runtime resources without packaging the app for every launch.
