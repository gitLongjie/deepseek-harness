# Agent Note: The sign-in gate reveals the password through an eye toggle

Status: implemented

English | [中文](2026-09-23-sign-in-show-password-toggle.zh.md)

## Problem

The sign-in form masked the password unconditionally. A mistyped password surfaced only as the account server's generic failure message after a network round trip, and a user who could not see what they typed had no way to tell a typo from a refused credential — especially punishing for passwords pasted with leading whitespace or retyped on the spot.

## Decision

The password field owns an inline reveal button: an open-eye icon while masked, a slashed dimmed eye while revealed, toggling the input between `password` and `text`. The toggle lives in the ui-login locale dictionary (`showPassword` / `hidePassword`, Chinese and English) and its `aria-label` swaps with the state, so assistive tech reads the action, not the icon.

Two structural facts make it work. The field caption moved from a wrapping `label` element to a sibling `label` pointing at the input by id — a `label` must not contain a button, so the old field-as-label frame could not hold the toggle; both fields keep the same `div.field` frame. And `Input`'s `className` widens to `string | undefined` so the reveal frame can pass the input's fit class conditionally under `exactOptionalPropertyTypes`.

The two eye icons are new `ui-primitives` glyphs (`IconEyeOutline16`, `IconEyeOffOutline16`), stroked at 1.3px to read at 16px; the off state dims the eye behind a diagonal slash rather than inventing a second silhouette.

## Alternatives considered

**A checkbox under the field.** The common pre-2020 pattern; it doubles the form's vertical size, separates the control from what it controls, and needs its own caption copy.

**Rely on the browser's native password-reveal (Edge/Windows).** Chromium-only, unstylable, untestable from the component, and absent on Firefox and all WebKit builds — the desktop app ships none of the guarantees.

**Clear-and-retype instead of reveal.** Solves paste-with-whitespace but not verification; the user still never sees the stored value.

## Consequences

The reveal state is component-local and resets on remount; the masked state is the default every render, so the gate never persists an exposed password across reloads. The form's DOM gained one button per password field, and the locale dictionary gained two keys per language.

## Testing

`packages/client/ui-login/tests/components.client.spec.tsx` drives the toggle through the localized accessible names: masked by default, `显示密码` switches the input to text and removes itself, `隐藏密码` restores the mask. `packages/client/ui-primitives/tests/icons.client.spec.tsx` pins the two new glyphs.
