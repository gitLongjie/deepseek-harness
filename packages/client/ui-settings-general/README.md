# @deepseek-ai/dsh-client-ui-settings-general

English | [中文](README.zh.md)

Settings shell, ownerless copy, and a durable legacy settings namespace. It occupies `sidebar.settings` with the trigger chrome and modal settings panel, projects the `settings.section` ledger into the navigation, and registers everything on the Settings pages that belongs to no single feature — the trigger/header/close chrome content, the local configuration-file action, the General section and its `settings.general.item` slot, and the `settings` dictionaries. The slot types it renders into belong to ui-settings, the settings domain base; only the shell's own contract types live here, because they reference ui-sidebar's slot type and the base layer must depend on no `ui-*` package. Feature-owned rows (Permission, Language, Appearance) and sections (Models) stay with their feature packages.

The shell ships no section copy of its own — all text arrives from registrants. Nav labels may be locale-following thunks, so the nav projection resolves them through `resolveSlotLabel` and re-renders on the section ledger bump or the locale revision (an optional `ctx.get('locale')` read; no hard locale dependency).

A loopback browser loads the provider's `hasDocument` capability through `settings.describe` and renders **Open configuration file** only when the Host confirms that a provider-owned local document can be prepared. The action sends the pathless, loopback-only `settings.openDocument` request; the Host resolves the provider path again, materializes an absent document, and hands it to a native text editor (`open -t` on macOS, bypassing a browser file association; the desktop file association on Linux and Windows; Windows association after `wslpath -w` translation on WSL). Open failures keep the action available and render a localized error. Reopening the dialog or reconnecting refreshes availability after a transient read failure or Host topology change. Remote browsers never register the action and never issue the privileged settings read.

The Host half registers `ui-onboarding` in the user-settings seam; the registration keeps stored documents that still carry the retired `welcomeNoticeVersion` field valid. No current reader writes the field, and the shell itself remains policy-free.

## Model Experience

None, as the plugin renders browser settings UI; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- The General section has no built-in rows; each row appears only when its owning feature plugin is mounted.
