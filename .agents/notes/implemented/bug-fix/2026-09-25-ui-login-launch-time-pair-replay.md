# Agent Note: the login gate replays the stored pair at every launch

Status: implemented

English | [中文](2026-09-25-ui-login-launch-time-pair-replay.zh.md)

## Problem

The sign-in gate trusted a localStorage snapshot. At boot the plugin read `dsh.login.session` and, when a previous sign-in had stored a profile, rendered the app with that stale session — no request reached the account server. The launch therefore never went through the login flow: the product requires the account server to re-issue the key each launch, but a revoked or expired key stayed in use silently.

A second defect rode on the same lifecycle. The sidebar account row kept its interaction state across sessions: opening the sign-out dropdown, signing out, and signing in again re-opened the previous session's dropdown. `SidebarAccount` stays mounted while the gate covers it, so its `menuOpen` flag survived the null-session gap, and the portaled menu resurrected over the freshly signed-in app.

## Decision

The session lives in memory only; the persisted fact is the credential pair. `login()` stores `{username, password}` under `dsh.login.pair` and never stores the session; `logout()` clears the pair alongside the credential references, so signing out means staying signed out across restarts.

`restore()` — called from `apply()` at every client boot — reads the pair and, when present, replays it through the exact `login()` path: the same endpoint call, credential write, gateway catalog sync, and default-model adoption. Success enters the app without the sign-in card; a refusal keeps the pair (the next launch retries) and the gate shows the card with the failure — a server message verbatim, or the network/invalid-response key. While the replay is in flight, `LoginGate` renders only its opaque backdrop, so the card never flashes and the app underneath is unreachable before authentication.

The account row closes its dropdown on a session transition. `SidebarAccount` resets `menuOpen` during render when the session identity changes (the adjust-state-when-a-prop-changes pattern), so a menu opened for one session cannot survive a sign-out → sign-in cycle, and no painted frame shows the stale menu.

`response.text()` moved inside the fetch `try` and the pair write swallows storage refusal, making `login()` total: the boot-time replay cannot raise an unhandled rejection that would strand the gate.

## Alternatives considered

**Keep restoring the stored session, revalidating the stored `api_key` against a session endpoint.** The Deepagens Claw deployment exposes one wire method for authentication, `POST /api/claw/login`; a validate call would need a new server route, and the key being checked is the very thing in doubt. Replaying the pair reuses the existing contract and re-issues a fresh key every launch.

**Persist nothing and show the card on every launch.** This meets the no-stale-key goal but forces typing the password at every start. The pair replay is the same wire call without the manual step, and the card still appears whenever the replay fails.

**`sessionStorage` instead of `localStorage` for the pair.** Chromium may restore `sessionStorage` after an unclean exit, so signed-out-on-restart would not be deterministic. The product requirement is that every launch re-authenticates.

**Reset the dropdown with a `useEffect` on the session.** The effect runs after paint, leaving one visible frame of the stale menu after a re-login; the render-time reset commits the closed state in the same pass.

**Key the account row by session** (`key={session.apiKey}`) to remount it per sign-in. That only resets state when the server issues a different key; the render-time reset on session identity is airtight regardless of what the server returns.

## Consequences

- Every launch costs one login round-trip before the UI settles; a slow or hung account server holds the app behind the backdrop (no timeout is configured — the endpoint is a deployment-owned service address).
- The account password now rests in `localStorage` in the renderer profile, plaintext, like the API key the credential layer already stores on disk. Only a manual sign-in and logout write it, and the plugin sends it to nothing but the login endpoint.
- A password changed server-side costs one failed replay per launch until the user signs in manually once, which updates the stored pair.
- `LoginState.status` (`idle`/`ready`) is gone — the hydration handshake existed only to mask the localStorage read; `restoring` now expresses the one phase the gate must hide.

## Testing

Focused suites pin the behavior: pair parsing tolerates malformed values; a fresh store is signed out; `restore()` without a pair is a no-op, replays the stored pair through the sign-in path (endpoint body, credential write, catalog sync), and falls back to the card with the server message on a refused pair; the session never reaches storage; logout drops the pair. The gate renders backdrop-only during an in-flight replay and nothing once signed in. The account-row spec opens the dropdown, signs out, signs in again, and requires the menu to stay closed.
