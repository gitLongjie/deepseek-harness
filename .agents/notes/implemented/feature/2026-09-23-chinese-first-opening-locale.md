# Agent Note: The opening locale is Chinese-first, not browser-derived

Status: implemented

English | [中文](2026-09-23-chinese-first-opening-locale.zh.md)

## Problem

The client opened in the browser's language: the initial locale matched `navigator.languages` by full tag and then primary subtag, so a fresh install on an English-locale system (the common case for the desktop webview, which reports the OS locale) presented the entire product in English. The product is Chinese-first — its brand, sign-in copy, and audience are Chinese — and a first-run reader with no stored preference should meet Chinese regardless of the machine's locale settings.

## Decision

The opening locale is always the product default (`DEFAULT_LOCALE` = `zh`). The browser-language detection (`detectBrowserLocale`, `navigator` matching, the `window` guard for non-browser runs) is deleted; a runtime without a stored Host preference opens on the default, and the Settings → General row remains the only way another language becomes the durable choice. An explicit stored preference still wins over the default, and clearing the preference returns to Chinese. Registering a language pack no longer auto-switches the active locale when it happens to match the browser; the pack only appears in the selector until picked.

`FALLBACK_LOCALE` (`en`) keeps its second job, dictionary terminal of every fallback chain, and loses the first: it no longer doubles as an opening locale. The `usePinnedBrowserLanguages` test helper becomes inert for locale selection and stays for suites that assert navigator-facing behavior; removing it would sweep a dozen packages for no behavior change.

## Alternatives considered

**Keep browser detection but prefer zh.** Equivalent to deletion for the shipped `zh`/`en` pair (the only tags detection could match) while keeping the matching code alive for a case it can never decide differently — dead machinery with a misleading contract.

**Force zh only in the desktop composition.** The behavior lives in one shared client package; a build-time override would fork the opening-locale contract between web and desktop and add a configurability surface nothing else needs.

**Ask on first run.** A language prompt before the product's first screen is friction the product does not want; the settings row already owns the switch, and Chinese-first matches the audience.

## Consequences

A fresh install always opens in Chinese, whatever the OS locale; an English reader picks English once and the stored preference holds. The cost is real: an English-locale machine that wants English now needs one explicit selection instead of inheriting it — accepted, because the reverse was the reported defect. Auto-switching on language-pack registration is gone; a pt-BR pack must be picked to take effect.

## Testing

`packages/client/locale/tests/locale.client.spec.ts` pins the Chinese opening under every browser shape (English, regional, unshipped, `languages`-less, non-browser), the no-auto-switch language-pack registration, and the Host preference still winning over the default. `apply.client.spec.ts` reworks the Host-preference refresh cycle to use `en` as the differing preference. `document-language.client.spec.ts` keeps `<html lang>` coverage with updated wording.
