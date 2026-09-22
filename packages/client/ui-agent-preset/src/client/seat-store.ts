/**
 * Hero-chip controller: which preset the NEXT session gets.
 *
 * The new-session screen has no session, so a pick is staged rather than
 * applied. It reaches a session when one becomes current and is still blank —
 * whether the workspace connect created it or reused an existing blank one,
 * which is why staging cannot simply ride along on `sessions.create`.
 *
 * The stage is forgotten once applied. The next new session starts from the
 * Host-effective default again, which is what {@link
 * AgentPresetSeatController.prepareNewSession} restores on the placeholder a
 * later flow adopts.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote merge into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type {} from '@deepseek-ai/dsh-agent-presets/types'
import { presetDisplayEntries, presetOptions, readRoster } from './settings-store.ts'
import type { AgentPresetOption } from './settings-store.ts'

/** Hero-chip snapshot. */
export interface AgentPresetSeatState {
  /** Whether the new-session surface exposes preset selection. */
  showPicker: boolean
  /** Presets the deployment supplies; empty means the chip renders nothing. */
  options: readonly AgentPresetOption[]
  /**
   * Roster row naming {@link current}, resolved over the WHOLE healthy roster
   * rather than over `options`: the market hires expert-marked presets, so a
   * session composed from one is named by that preset here while the menu
   * still offers modes alone. Absent when no healthy preset carries the id,
   * which is the only case where a surface falls back to the raw id.
   */
  currentPreset: AgentPresetOption | undefined
  /** The staged choice, empty until the roster loads. */
  current: string
  /** A rejected apply's message, cleared by the next attempt. */
  error: string | null
  busy: boolean
  /**
   * One-shot cue that the chip should introduce itself (the creator-draft
   * entry staged the pick from another screen, so the user never touched the
   * chip); the renderer clears it via `introduced()` once played.
   */
  introduce: boolean
}

const INITIAL: AgentPresetSeatState = {
  showPicker: false, options: [], currentPreset: undefined,
  current: '', error: null, busy: false, introduce: false,
}

/** Stages the next session's preset and applies it when one appears. */
export class AgentPresetSeatController {
  /** Chip snapshot the renderer subscribes to. */
  readonly store: SnapshotStore<AgentPresetSeatState> = createSnapshotStore(INITIAL)

  /**
   * The Host-effective default, so a consumed stage can fall back to it without
   * re-reading the roster.
   */
  private fallback = ''

  /** Set while a pick is waiting for a session; cleared once applied. */
  private staged: string | undefined

  /**
   * Every healthy preset the last roster read reported, for naming a
   * composition the menu does not offer and for resolving the default.
   */
  private entries: readonly AgentPresetOption[] = []

  /**
   * The presets this flow's surfaces can offer, from the same roster read as
   * {@link defaultId}: what a pick made here can possibly have chosen.
   */
  private options: readonly AgentPresetOption[] = []

  /** The preset a Session created now composes: the roster's marked default. */
  private defaultId: string | undefined

  /** Only the newest roster read may publish after overlapping refreshes. */
  private loadGeneration = 0

  constructor(
    private readonly ctx: ClientContext,
    /**
     * One session's list facts: the current session when no id is given, so
     * the applier and the placeholder step read the same projection.
     */
    private readonly sessionOf: (id?: SessionSummary['id']) => Pick<
      SessionSummary,
      'id' | 'blank' | 'projectionValues'
    > | undefined,
  ) {}

  private set(patch: Partial<AgentPresetSeatState>): void {
    this.store.set({ ...this.store.getSnapshot(), ...patch })
  }

  /**
   * The state fields that name one preset id: the id itself and the healthy
   * roster row carrying it, so every publish names the composition the same
   * way a fresh roster read would.
   * @param id - preset id the snapshot should name.
   * @returns the naming fields to merge into a snapshot patch.
   */
  private naming(id: string): Pick<AgentPresetSeatState, 'current' | 'currentPreset'> {
    return { current: id, currentPreset: this.entries.find(entry => entry.id === id) }
  }

  /**
   * Read the roster and open the chip on the Host-effective default.
  * @returns once the snapshot reflects the host.
  */
  async load(): Promise<void> {
    const generation = ++this.loadGeneration
    const roster = await readRoster(this.ctx)
    if (generation !== this.loadGeneration) return
    if (!roster.ok) {
      this.set({ error: roster.error })
      return
    }
    const { presets, modeSelectionEnabled } = roster.value
    if (!modeSelectionEnabled) this.staged = undefined
    const options = presetOptions(presets)
    // The chip opens on the Host-effective default while the roster still
    // offers it as a mode; a default it no longer offers (deleted, or
    // expert-marked market inventory) falls through to the first offered one.
    this.fallback = presets.find(preset => preset.isDefault
      && options.some(option => option.id === preset.id))?.id ?? options[0]?.id ?? ''
    // Naming and the placeholder step read the whole healthy roster: a session
    // running an expert-marked preset is named by that preset even though the
    // menu cannot offer it, and the default a fresh create composes is the
    // marked row whether or not this chip may display it as a mode.
    this.entries = presetDisplayEntries(presets)
    this.options = options
    this.defaultId = presets.find(preset => preset.isDefault)?.id
    const session = this.sessionOf()
    this.set({
      showPicker: modeSelectionEnabled,
      options,
      // Staged pick first, then the composition the current session
      // already carries, then the Host-effective default. The middle term is
      // what keeps a late-landing load from regressing the display after
      // an applied stage was consumed — the chip mounts (and loads) only
      // once the flow's session is current, so the reply can arrive after
      // apply() already composed it.
      ...this.naming(this.staged ?? (session === undefined ? this.fallback : presetOf(session) ?? '')),
      error: null,
      ...modeSelectionEnabled ? {} : { introduce: false },
    })
  }

  /**
   * Stage one preset for the next session, applying it immediately when a
   * blank session is already current.
   *
   * The refusal is returned as well as stored, because the two readers need
   * different things from it: the chip's own label carries the standing state,
   * while the caller that made this pick is the one that has to say why the
   * label came back — and only it knows the pick was a person's, not the
   * applier catching up with a session that just became current.
   * @param id - the preset to stage.
   * @returns the refusal text, or undefined once the pick settled.
   */
  async select(id: string): Promise<string | undefined> {
    if (this.store.getSnapshot().busy) return undefined
    this.stage(id)
    await this.apply()
    return this.store.getSnapshot().error ?? undefined
  }

  /**
   * Stage a pick WITHOUT the immediate apply, for a flow that starts the
   * receiving session after the pick (the settings section's creator entry).
   * `select()`'s immediate apply would meet the still-current running session
   * and drop the stage as unservable; staging alone leaves it for the
   * list-change applier, which fires when the started session becomes
   * current.
   * @param id - the preset to stage.
   * @param introduce - true when the stage came from another screen and the
   * chip should announce itself on the session it lands on.
   */
  stage(id: string, introduce = false): void {
    this.staged = id
    this.set({ ...this.naming(id), error: null, introduce })
  }

  /**
   * Capture the exact blank Session a Settings action may bring along.
   * @returns its id, or undefined outside a blank Session.
   */
  blankSessionId(): SessionSummary['id'] | undefined {
    const session = this.sessionOf()
    return session?.blank === true ? session.id : undefined
  }

  /**
   * Apply a Settings choice only if its captured Session is still current and
   * blank. The selection uses the existing stage/apply path.
   * @param expectedSessionId - blank Session captured before the Settings write.
   * @param id - the effective default that the write persisted.
   * @returns the Host refusal text, or undefined when applied or no longer relevant.
   */
  async syncBlankSession(
    expectedSessionId: SessionSummary['id'],
    id: string,
  ): Promise<string | undefined> {
    const session = this.sessionOf()
    if (session === undefined || !session.blank || session.id !== expectedSessionId) return undefined
    this.stage(id)
    await this.apply()
    return this.store.getSnapshot().error ?? undefined
  }

  /**
   * Restore the composition a fresh Session gets on the blank Session a
   * new-session flow adopts.
   *
   * A Workspace's blank Session IS its New Session placeholder, and flows
   * share it: a hire composes the expert into it, and the next new-session flow
   * adopts that same Session. Left alone, that flow would start the chat it
   * promises under a composition nobody chose for it — and the chip would name
   * a preset its own menu cannot even offer.
   *
   * What is restored is only what these surfaces cannot have chosen. A pick
   * made on this screen or the settings page is that flow's own answer and
   * stays; a composition the menu has no row for — an expert hired from the
   * market, a preset deleted since — is another flow's leftover. A staged pick
   * returns immediately too: it IS what this flow asked for, and the applier
   * owns switching the Session onto it.
   * @param sessionId - the adopted placeholder, still blank.
   * @returns once the composition settled, or immediately when there is nothing to do.
   */
  async prepareNewSession(sessionId: SessionSummary['id']): Promise<void> {
    if (this.staged !== undefined) return
    const session = this.sessionOf(sessionId)
    // A Session with history keeps the composition that history was produced
    // under; only the untouched placeholder is housekeeping's business.
    if (session === undefined || session.blank !== true) return
    if (this.defaultId === undefined) await this.load()
    const defaultId = this.defaultId
    if (defaultId === undefined) return
    const current = presetOf(session)
    if (current === defaultId) return
    if (current !== undefined && this.options.some(option => option.id === current)) return
    const result = await this.ctx.remote.agentPresets.select(sessionId, defaultId)
    // A refusal means the Session stopped being the placeholder this flow
    // adopted — someone started using it, so its composition is now theirs to
    // choose and this step leaves it alone.
    if (!result.ok) return
  }

  /** Acknowledge the introduction cue once the chip has played it. */
  introduced(): void {
    if (!this.store.getSnapshot().introduce) return
    this.set({ introduce: false })
  }

  /**
   * Hand the staged choice to the current session, if there is one to take it.
   *
   * Called both by `select()` and by whoever observes the current session
   * changing, because the session may appear either before or after the pick.
   * @returns once the switch settled, or immediately when there is nothing to do.
   */
  async apply(): Promise<void> {
    const staged = this.staged
    const session = this.sessionOf()
    if (staged === undefined) {
      const current = session === undefined ? this.fallback : presetOf(session) ?? ''
      if (current !== this.store.getSnapshot().current) this.set(this.naming(current))
      return
    }
    if (session === undefined) return
    // A started session's history was produced under its own composition; the
    // host refuses the swap, so the stage is no longer meaningful.
    if (!session.blank || presetOf(session) === staged) {
      this.staged = undefined
      return
    }
    this.set({ busy: true, error: null })
    const result = await this.ctx.remote.agentPresets.select(session.id, staged)
    this.staged = undefined
    if (!result.ok) {
      const { error } = result
      this.set({
        busy: false,
        // A refusal carries its cause twice: `message` wraps it in the
        // roster's own frame, which names the preset the surface reporting
        // this already names, and a `reason` detail holds the same cause
        // without it. Read by the detail rather than by the code, because
        // every refusal that has a cause to give names it the same way.
        error: 'reason' in error.details && typeof error.details.reason === 'string'
          ? error.details.reason
          : error.message,
        ...this.naming(presetOf(session) ?? ''),
      })
      return
    }
    // Consumed: the next new session opens on the Host-effective default again.
    this.set({ busy: false, ...this.naming(result.value) })
  }
}

function presetOf(
  session: Pick<SessionSummary, 'projectionValues'> | undefined,
): string | undefined {
  const value = session?.projectionValues?.agentPreset
  return typeof value === 'string' ? value : undefined
}
