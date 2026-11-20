# Agent Note: Expert plaza modules

Status: implemented

English | [中文](2026-11-20-expert-plaza-modules.zh.md)

## Problem

A hireable expert could be packaged and followed, but not published or updated by the person who wrote it. The expert page therefore had a roster and an npm catalog, and no place where one signed-in account could put a persona online for someone else to download.

## Decision

Any signed-in token-api user publishes a module to `/api/expert-hub`. The server stamps the author from the session and stores the zip on the item. The public id is `u{userId}-{localId}`, lowercase letters, digits, and hyphens, at most 64 characters. The same version with different bytes is rejected; a newer `x.y.z` replaces the item and publishes immediately. Identical bytes of the current version succeed as already current. Owner id 0 and another user's slug cannot be replaced.

The expert page has two modules. My experts uploads a local card this account saved (`origin` absent or `mine`) and a shipped preset whose directory sits outside `.agent-presets`. A card's detail dialog reads the persona and skill titles. Expert plaza downloads or updates a public module and hires it only after it is installed. A download is registered through the same `ctx.expertPublisher` as `publish_expert`, with roster id equal to the public slug and `origin: 'plaza'`. Plaza installs and package copies under `.agent-presets` are not uploaded again. The host stores the persona, skill, and card fields and does not run scripts from the bundle. Tool names stay the host packages already installed.

Upload uses `DEEPAGENS_API_KEY`. The origin defaults to `https://claw.deepagens.com` and can be set with the plugin `origin` field. The npm `catalog`, `installEntry`, and `uninstall` methods stay the store path.

## Alternatives considered

**Put experts in the task-plugin sandbox.** Rejected: that sandbox is root-only and cannot fetch, touch the filesystem, or require modules, so it cannot carry a persona the host must register.

**Let the package name its own author and public id.** Rejected: a self-declared author can impersonate someone else, and a slash or mixed-case id cannot be a roster id. The session supplies the author, and the server allocates the slug.

**A second in-memory publisher for downloads.** Rejected: after a restart, `loadPublishedExperts` refills the original publisher. A second map would treat an update as an id the deployment already owns and refuse it.

## Consequences

Upload is available to every signed-in account, and a downloaded expert is hireable without a restart. The sensitive-content scan still rejects a persona that contains words such as `password`. A plaza page lists at most 100 published experts. The npm catalog is unchanged.
