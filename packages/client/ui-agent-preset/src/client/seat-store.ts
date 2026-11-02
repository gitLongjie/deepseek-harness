/**
 * Hero-chip controller: which preset the NEXT session gets.
 *
 * The new-session screen has no session, so a pick is staged rather than
 * applied. It reaches a session when one becomes current and is still blank —
 * whether the workspace connect created it or reused an existing blank one. A
 * flow that knows its preset before it starts (the settings section's creator
 * entry) passes it to session creation instead, and its stage only drives the
 * chip's display.
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
import type {} from '@deepseek-ai/dsh-agent-preset-registry/types'
import { presetDisplayEntries, presetOptions, readRoster } from './settings-store.ts'
import type { AgentPresetOption } from './settings-store.ts'

/** Hero-chip snapshot. */
export interface AgentPresetSeatState {
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
  /** An error message; explicit selection failures also carry the preset for a Toast. */
  error: string | { readonly preset: AgentPresetOption; readonly reason: string } | null
  busy: boolean
  /**
   * One-shot cue that the chip should introduce itself (the creator-draft
   * entry staged the pick from another screen, so the user never touched the
   * chip); the renderer clears it via `introduced()` once played.
   */
  introduce: boolean
}

const INITIAL: AgentPresetSeatState = {
  options: [], currentPreset: undefined,
  current: '', error: null, busy: false, introduce: false,
}

/** Mutable one-shot preset choice shared across Provider-bound seat controllers. */
export interface AgentPresetStage {
  /** Preset awaiting application; absence means no staged choice. */
  id: string | undefined
  /** Whether the receiving chip should announce the applied choice once. */
  introduce: boolean
}

/**
 * Result of one attempt to hand a staged preset to the current Session: the Host applied it,
 * it waits for a Session to appear, nothing changed (busy, already composed, started, or no
 * stage), or the Host refused it.
 */
export type AgentPresetApplyOutcome =
  | { readonly kind: 'applied' | 'staged' | 'unchanged' }
  | { readonly kind: 'refused'; readonly reason: string }

const UNCHANGED: AgentPresetApplyOutcome = { kind: 'unchanged' }

/** Stages the next session's preset and applies it when one appears. */
export class AgentPresetSeatController {
  /** Chip snapshot the renderer subscribes to. */
  readonly store: SnapshotStore<AgentPresetSeatState> = createSnapshotStore(INITIAL)

  /**
   * The Host-effective default, so a consumed stage can fall back to it without
   * re-reading the roster.
   */
  private fallback = ''

  /**
   * The preset a pick through THIS seat last landed on a session.
   *
   * An expert is hired from the market rather than offered by the menu, so a
   * placeholder carrying one is indistinguishable from a leftover by roster
   * membership alone — which is what made a completed hire revert to the
   * default on adoption. This is what tells the two apart: a composition this
   * seat itself composed is that pick's, while one it never composed is
   * another flow's leftover.
   */
  private honored: string | undefined

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
  /** Completion of the active Host selection; Settings choices wait before staging. */
  private pendingSelection: Promise<undefined> | undefined

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
    private readonly staged: AgentPresetStage = { id: undefined, introduce: false },
  ) {}

  private set(patch: Partial<AgentPresetSeatState>): void {
    this.store.set({ ...this.store.getSnapshot(), ...patch })
  }

  private clearStage(): void {
    this.staged.id = undefined
    this.staged.introduce = false
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
    // A roster refresh can finish after a selection; leave its announcement for the chip.
    const error = this.store.getSnapshot().error
    if (!roster.ok) {
      if (typeof error !== 'object' || error === null) this.set({ error: roster.error })
      return
    }
    const { presets } = roster.value
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
      options,
      ...this.naming(this.staged.id ?? (session === undefined ? this.fallback : presetOf(session) ?? '')),
      error: typeof error === 'object' ? error : null,
      introduce: this.staged.introduce,
    })
    await this.apply()
  }

  /**
   * Stage one preset for the next session, applying it immediately when a
   * blank session is already current.
   *
   * The refusal is stored for the chip's announcement and returned to callers
   * such as Settings that also report the result of their own write.
   * @param id - the preset to stage.
   * @returns how the pick settled; a refusal carries its text.
   */
  async select(id: string): Promise<AgentPresetApplyOutcome> {
    if (this.store.getSnapshot().busy) return UNCHANGED
    this.stage(id)
    return await this.apply()
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
    this.staged.id = id
    this.staged.introduce = introduce
    this.set({ ...this.naming(id), error: null, introduce })
  }

  /** Acknowledge a displayed refusal without dismissing a newer attempt.
   * @param refusal - the selection error whose Toast finished.
   */
  dismissRefusal(refusal: AgentPresetSeatState['error']): void {
    if (refusal !== null && typeof refusal === 'object' && this.store.getSnapshot().error === refusal) {
      this.set({ error: refusal.reason })
    }
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
   * blank after any pending selection settles. The selection uses the existing stage/apply path.
   * @param expectedSessionId - blank Session captured before the Settings write.
   * @param id - the effective default that the write persisted.
   * @returns the Host refusal text, or undefined when applied or no longer relevant.
   */
  async syncBlankSession(
    expectedSessionId: SessionSummary['id'],
    id: string,
  ): Promise<string | undefined> {
    while (this.pendingSelection !== undefined) await this.pendingSelection
    const session = this.sessionOf()
    if (session === undefined || !session.blank || session.id !== expectedSessionId) return undefined
    this.stage(id)
    const outcome = await this.apply()
    return outcome.kind === 'refused' ? outcome.reason : undefined
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
   * made on this screen, the settings page, or the expert market is that flow's
   * own answer and stays; a composition this seat never composed — a preset
   * deleted since, a chat another flow left behind — is a leftover. A staged
   * pick returns immediately too: it IS what this flow asked for, and the
   * applier owns switching the Session onto it.
   *
   * "This seat never composed" is the load-bearing half, and roster membership
   * cannot express it: an expert is hired from the market rather than offered
   * by the menu, so a placeholder carrying one looks exactly like a leftover.
   * {@link honored} is what separates them, which is why a completed hire
   * survives the next adoption instead of reverting to the default.
   * @param sessionId - the adopted placeholder, still blank.
   * @returns once the composition settled, or immediately when there is nothing to do.
   */
  async prepareNewSession(sessionId: SessionSummary['id']): Promise<void> {
    if (this.staged.id !== undefined) return
    const session = this.sessionOf(sessionId)
    // A Session with history keeps the composition that history was produced
    // under; only the untouched placeholder is housekeeping's business.
    if (session === undefined || session.blank !== true) return
    if (this.defaultId === undefined) await this.load()
    const defaultId = this.defaultId
    if (defaultId === undefined) return
    const current = presetOf(session)
    if (current === defaultId) return
    // A composition this seat's own pick landed — an expert hired from the
    // market, which this menu cannot offer — is that pick's, not a leftover.
    // Still-healthy is part of it: a preset deleted since the hire leaves a
    // composition nothing can mount, so restoring the default is the only
    // useful answer and the leftover rule applies again.
    if (current !== undefined && current === this.honored
      && this.entries.some(entry => entry.id === current)) return
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
    this.staged.introduce = false
    this.set({ introduce: false })
  }

  /**
   * Hand the staged choice to the current session, if there is one to take it.
   *
   * Called both by `select()` and by whoever observes the current session
   * changing, because the session may appear either before or after the pick.
   * List updates do not repeat a selection while its response is pending.
   * @returns how this attempt settled; only a Host commit of the staged preset is applied.
   */
  async apply(): Promise<AgentPresetApplyOutcome> {
    if (this.store.getSnapshot().busy) return UNCHANGED
    const staged = this.staged.id
    const session = this.sessionOf()
    if (staged === undefined) {
      const current = session === undefined ? this.fallback : presetOf(session) ?? ''
      const shown = this.store.getSnapshot()
      if (current !== shown.current) this.set(this.naming(current))
      return UNCHANGED
    }
    if (session === undefined) return { kind: 'staged' }
    // A started session's history was produced under its own composition, and
    // the host refuses the swap. That consumes a pick made on this chip, which
    // targets the session it is showing; a pick staged from another screen (a
    // hire) targets a session the flow has not started yet, so a session still
    // running here is not the one it is waiting for and must not consume it.
    if (presetOf(session) === staged) {
      this.clearStage()
      return UNCHANGED
    }
    if (!session.blank) {
      if (!this.staged.introduce) this.clearStage()
      return UNCHANGED
    }
    const completion = Promise.withResolvers<undefined>()
    this.pendingSelection = completion.promise
    this.clearStage()
    const refuse = (reason: string): AgentPresetApplyOutcome => {
      this.set({
        error: { reason, preset: this.store.getSnapshot().options.find(option => option.id === staged) ?? { id: staged } },
        ...this.naming(this.staged.id ?? presetOf(session) ?? ''),
      })
      return { kind: 'refused', reason }
    }
    try {
      this.set({ busy: true, error: null })
      const result = await this.ctx.remote.agentPresets.select(session.id, staged)
      if (!result.ok) {
        const { error } = result
        // Prefer the bare cause; the Toast already names the rejected preset.
        const refusal = 'reason' in error.details && typeof error.details.reason === 'string'
          ? error.details.reason
          : error.message
        return refuse(refusal)
      }
      this.set(this.naming(this.staged.id ?? result.value))
      // Consumed: the next new session opens on the Host-effective default
      // again. Recorded as this seat's own pick so that adopting this Session
      // later as a New Session placeholder cannot restore the default over the
      // composition the user just hired.
      this.honored = result.value
      return result.value === staged ? { kind: 'applied' } : UNCHANGED
    } catch (error) {
      return refuse(error instanceof Error ? error.message : String(error))
    } finally {
      this.pendingSelection = undefined
      this.set({ busy: false })
      completion.resolve(undefined)
    }
  }
}

function presetOf(
  session: Pick<SessionSummary, 'projectionValues'> | undefined,
): string | undefined {
  const value = session?.projectionValues?.agentPreset
  return typeof value === 'string' ? value : undefined
}
