# Agent Note: Business-entry task launch

Status: implemented

English | [中文](2026-10-16-business-entry-task-launch.zh.md)

## Problem

The seven business-entry rows (daily report, topics, sentiment briefing, video script, reports, multi-format rewrite, rumor debunking) recorded a pick in the group's viewing store and nothing consumed it: opening a business entry did nothing beyond highlighting the row. The group advertised tasks the deployment could not run.

## Decision

A row click now opens its task's conversation. The plugin declares the cordis services it needs (`workspaces`, `sessions`, `uiWorkspace`) alongside `slots` and `locale`; its module-table externals are unchanged because the launch reaches no new modules. The click first looks for the Session the entry already owns — the most recently updated non-archived Session whose title equals the entry's localized label — and opens it with `uiWorkspace.openSession`, which is the whole effect: no new Session, no second copy of the instruction. That title is the entry's durable mark, written by the launch itself, so the association survives a reload, a restart, and a window that never saw the launch, and the conversation a user left is the one the row goes back to.

When the entry owns no Session yet, the click starts one. It resolves the target workspace with the same policy the sidebar's New Session control applies — the open session's workspace, else the most recently active one — and opens that workspace's New Session through `uiWorkspace.openWorkspace(id, beforeOpen)` (placeholder created or reused). Inside the synchronous `beforeOpen` hook — the documented moment a freshly created Session is addressable before it opens — it resolves the Session face (binding first, then scope + `sessionOf`) and sends the entry's localized instruction as the Session's first user message (`session.prompt` with one text part, `queue` mode), then renames the Session to the entry label (best-effort: a refused rename never turns a delivered prompt into a reported failure, and an untitled run is simply not resumable). With no workspace registered the click calls `sessions.create({})` and `openSession` directly, so the task runs even on a fresh deployment.

A second registration-side fact serves the same mark: an apply-level snapshot store publishes `{ current, entries }` — which Session is open plus every entry's own runs, newest first — derived from the Session list and the workspace archive set, republished whenever either changes. It reaches the component through the reserved `hooks` compartment as the bound `useHistory` selector hook, so the row's disclosure and the resume target read one snapshot and cannot disagree about which run is the latest. The row shows the count of past runs, and disclosing it lists them (time, running flag, current marker) with a first item that starts a fresh run.

Ctrl/⌘/Alt+click is the explicit fresh run: it skips the owned Session and starts another one. It never deletes, replaces, or renames the earlier Session, and the row's tooltip states the pair of gestures.

Launch status rides the entry's declared store (`pending`, `error`, `historyFor`): rows disable while a launch is in flight (a spinner replaces the row's dot), a refused launch reports its own reason in a dismissible notice under the list rather than failing silently, and the disclosure state survives the sidebar collapsing into its rail. The slot's inject factory receives the store's baked actions, so the launcher reports on the row that asked for it.

Each instruction is locale-owned copy (`prompt.<id>` in `src/locales.js`, beside the row label) and is a complete instruction, not a form: it opens by asking for the inputs the task needs — data source, monitoring target, source material — because the click supplies nothing else, then states the deliverable's structure. `tests/launch.test.mjs` drives the built bundle through a fake module table and slot registry: it clicks a row and asserts the instruction sent and the session title, that a second click reopens the Session that run produced instead of starting another, that the newest titled Session wins, that an archived one is passed over, that a modifier click starts fresh without touching the owned Session, that an entry's runs publish newest first with the running one flagged and another entry's runs stay out of its list, that the disclosure renders those runs, opens one on selection, marks the open one, and starts a fresh run from its own affordance, the no-workspace fallback, the notice a refused prompt produces, and that the next launch clears it; a catalog test keeps every entry labeled and instructed in both dictionaries.

## Alternatives considered

**Start a fresh Session on every click.** Rejected: these entries are standing tasks, so a plain click would open a new conversation while the previous one had to be hunted for in the workspace's session list — the row would answer "start over", which is what the modifier click is for.

**Leave past runs to the workspace's session list.** Rejected: the entry's runs are one task's history, and that list mixes every task and every unrelated conversation in the workspace. The row's disclosure is the same data scoped to the entry, which is what makes a previous run findable without knowing its title.

**Seed the composer draft instead of sending.** Rejected: a row is a task entry, not a text-template picker. A seeded draft still needs a second gesture before anything happens, and the entry points exist to start the task. The instruction therefore asks for its inputs conversationally rather than carrying fill-in placeholders.

**Key the entry-to-Session association in the plugin's store (or a host-side registry row).** Rejected: the task Session's title already carries the mark, is durable, survives plugin reloads and restarts, and needs no second source of truth to reconcile when a Session is deleted, archived, or renamed by hand. The history snapshot is derived from that title on every publication rather than stored.

**Host-side slash commands per entry.** Rejected: commands address an existing session's input; the entry's job is to create and title the task session. Command registration would add host surface without owning the navigation, and the seven flows need no host tools the agent lacks.

**Dedicated main panels per entry.** Rejected: no data plane exists behind these tasks yet, so a panel would be a form with nowhere to submit. The instruction-first session flow produces deliverables with the tools the agent already has (web search, file generation) and leaves room to grow per-task surfaces without touching the group.

## Consequences

A plain click costs no model turn once the task has a Session, and consumes one only when it starts a run — the cost of "start now". The Session's automatic title regeneration is pinned by the entry-label rename, which is also what makes the entry resumable and its runs listable. The blank-session placeholder's draft is untouched on the first run: the instruction goes through `session.prompt`, not `setDraft`, so an unsent draft survives a launch into the same placeholder. Nothing a previous run produced is deleted or hidden by a later one: earlier Sessions keep their title and history in the workspace's list and in the row's disclosure, and archiving one makes the next plain click start a fresh task rather than reopening it. A task whose title an earlier build never wrote (a launch whose rename was refused) is not listed and not resumed — the click starts another run, which is the same answer a deployment gets before it has any. The store still resets on reload (unchanged), and the catalog remains source-static: adding a task means editing `entries.js` plus both dictionaries and rebuilding. `apps/desktop/scripts/dev.ts` rebuilds and re-copies the plugin into the web profile on every dev launch; the packaged installer bakes its own copy, so shipping this behavior in an installer requires rebuilding it.
