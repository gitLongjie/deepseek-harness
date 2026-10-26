# Agent Note: a launch revalidates the stored key instead of creating a login session

Status: implemented

English | [中文](2026-10-20-ui-login-key-revalidation.zh.md)

## Problem

The login gate signed in again at every launch: `restore()` replayed the stored account pair through `POST /api/claw/login`. On the Deepagens Claw gateway that call creates a server-side login session, and the gateway caps the login sessions an account may hold and the rate at which it may create them. A desktop application that signs in on each start therefore spends a budget meant for interactive devices: on 2026-10-20 the account signed in at 10:01 and 10:08 and was refused from 10:49 on, with `{"message":"failed to create login session","success":false}` — an HTTP 200 body whose only defect is that the gateway would not open another session. The credentials, the network path, and the gateway itself were healthy; the client had simply used up the sessions itself.

Nothing released the sessions either. The login response carries no session token, sign-out only clears local state, and the client has no call that revokes a server session, so every launch added one permanently.

## Decision

A launch restores the session by revalidating the key the last sign-in issued, and calls the login endpoint only when that key no longer works.

`restore()` reads one stored record and reads `GET {login origin}/v1/models` with the stored key. An accepted key enters the app: the key is written to `DEEPAGENS_API_KEY` through the same credential adapter a sign-in uses, the gateway catalog sync still runs on it, and the account row renders from the stored profile. A refused key — revoked, expired, short of quota — and any probe that fails to reach the gateway fall through to the pair replay, which is the one path that creates a login session and the one path that can replace the key. A record written before this change holds no key and replays once, which stores one.

The stored record keeps its original `localStorage` key (`dsh.login.pair`) and grows three optional fields — the issued `apiKey`, the reported `account`, and the `avatar` — so an upgraded build keeps its silent sign-in instead of forcing a manual one.

## Alternatives considered

**Sign in on every launch and revoke the session afterwards.** The login response carries no session identifier or token, and the endpoint exposes no revoke call, so the session the client creates cannot be released from the browser.

**Keep signing in at every launch and back off after a refusal.** Still creates one session per launch and still ends in the same lockout; a delay only moves the failure later.

**Drop the silent sign-in and show the card at every launch.** Meets the no-stale-key goal but costs the password at every start, which is the behavior the pair replay exists to avoid.

**Raise or disable the gateway's login-session limit.** The gateway is a deployment-owned new-api service outside this repository; requiring a loosened server limit for the client to work hides the client's own spend.

**Store only the key, not the pair.** A revoked key would strand the user at the card on every launch with no automatic recovery, and a password change would need finding out by hand.

## Consequences

- An ordinary launch costs one authenticated model-list read instead of a login session, so the gateway's per-account session budget is no longer consumed by starting the application.
- A revoked, expired, or quota-exhausted key is still caught at launch and replaced, which is the property the pair replay was introduced for ([launch-time pair replay](2026-09-25-ui-login-launch-time-pair-replay.md)).
- The stored record now keeps the issued key and profile in `localStorage` beside the plaintext pair; both stay inside the renderer profile.
- A server-side rename or avatar change appears after the next pair replay, not on a key revalidation.
- An account already at the gateway's limit stays refused on its next launch — the replay still needs to create a session — until the rolling window passes or old sessions are revoked in the gateway.

## Testing

The `LoginStore` restore suite pins the paths: an accepted key signs in with one model-list read and no login `POST`; a refused key replays the pair and stores the newly issued key; an unreachable probe falls back to the pair replay; a record without a key replays once; a refused pair leaves the record stored and reports the server message on the gate. The sign-in suite pins the record a successful sign-in writes and that sign-out clears it.
