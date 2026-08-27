# Agent Note: Removed the first-run DeepSeek API-key onboarding prompt

Status: implemented

English | [中文](2026-08-27-remove-deepseek-apikey-onboarding.zh.md)

## Problem

On first launch the client showed a blocking "添加一个 API Key 开始使用" modal prompting for a DeepSeek API key whenever no provider could serve requests. The first-launch account login now delivers the credential, so the prompt was redundant: a signed-in user saw a demand for a key they already have, and the step machinery (generic slot, coordinator, modal primitive) existed solely for that one dialog.

## Decision

Delete the whole mechanism rather than unregister the single step: the `settings.onboarding` slot declaration (ui-settings `contract/slots.ts`), the coordinator in `SettingsRoot` (session-blank gate, completed-step set), `DeepSeekOnboardingDialog` + `OnboardingModal` + their `onboardingReadiness` projection (ui-settings-models), and the `OnboardingSurface` primitive (ui-primitives). `ProviderEditor` drops the dialog-only props (`credentialOnly`, `credentialRequired`, `autoFocusCredential`, label overrides) back to the Models-page shape. The generated client slot catalog regenerates without the entry.

## Kept

- The durable `ui-onboarding` settings namespace: retired `welcomeNoticeVersion` fields in stored `settings.yaml` must stay valid.
- `providerUsable`: ModelsSection's first-run posture still reads it.

## Alternatives considered

**Unregister only the step, keep the slot machinery.** Rejected under the pre-release foundation stance: with zero registrants the coordinator, primitive, and slot type are dead weight knip would flag.

**Keep the dialog gated on "login provided no credential".** Rejected as speculative: no such state exists today, and reintroducing a prompt is easy if one appears.

## Verification

`pnpm run typecheck` clean; focused vitest over ui-settings-models, ui-settings-general, ui-settings, ui-primitives passes (47 files / 886 tests). The two web onboarding e2e specs and their snapshots are deleted.

## Consequences

A user whose login delivers no usable provider lands on the empty Hero with no prompt; the Models settings page remains the manual configuration path.
