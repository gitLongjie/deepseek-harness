/**
 * Cross-surface agent-preset staging: the one capability another plugin's
 * surface needs — hiring an expert means "make the next session compose THIS
 * preset" — forwarded to whichever conversation binding currently owns the
 * seat flow. The seat itself is binding-scoped, because it applies its staged
 * pick as sessions arrive in that flow, so this root service is the stable
 * identity over a per-binding target.
 * @module @deepseek-ai/dsh-client-ui-agent-preset/client/navigation
 */

import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'

/** Cross-surface agent-preset staging capability. */
export interface UiAgentPreset {
  /**
   * Stage one preset for the NEXT session the flow creates or reuses, and
   * make the hero chip announce the pick the user made from another screen.
   *
   * A caller that gets `false` must NOT go on to start a session: nothing is
   * waiting to compose it, so the chat would open under the deployment default
   * while the surface that asked reports success. That silence is what this
   * return value exists to end — a cross-surface hire can only be honest about
   * landing if it can be told it did not.
   * @param id - the preset id the next session should compose.
   * @returns whether a conversation flow took the pick.
   */
  stageNextSessionPreset(id: string): boolean
  /**
   * Open the experts page when the expert center has bound one.
   * @returns whether a page took the request.
   */
  openExpertsPage(): boolean
  /**
   * Point chip clicks at the experts page.
   * @param open - opens the experts page.
   * @returns the disposer that unbinds it.
   */
  bindExpertPage(open: () => void): () => void
  /**
   * Persist one preset as the default for new tasks and apply it to the current blank task.
   * @param id - the preset id to save.
   * @returns the refusal message, or undefined once it landed. Undefined also when no writer is bound.
   */
  makeDefault(id: string): Promise<string | undefined>
  /**
   * Point default writes at the roster controller.
   * @param save - writes the default and returns a refusal message.
   * @returns the disposer that unbinds it.
   */
  bindMakeDefault(save: (id: string) => Promise<string | undefined>): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Cross-surface agent-preset staging capability. */
    uiAgentPreset: UiAgentPreset
  }
}

/** Implements root-identity staging over the binding-scoped seat. */
export class UiAgentPresetService extends Service implements UiAgentPreset {
  /** The bound flow's staging move, absent between bindings. */
  private stage: ((id: string) => void) | undefined
  /** Opens the experts page, absent until the expert center binds one. */
  private openPage: (() => void) | undefined
  /** Writes the new-task default, absent until the roster controller binds one. */
  private saveDefault: ((id: string) => Promise<string | undefined>) | undefined

  /** @param ctx - Client root Context. */
  constructor(ctx: Context) {
    super(ctx, 'uiAgentPreset')
  }

  /**
   * @param id - the preset id the next session should compose.
   * @returns whether a bound flow took the pick; false while none is bound.
   */
  stageNextSessionPreset(id: string): boolean {
    if (this.stage === undefined) return false
    this.stage(id)
    return true
  }

  /**
   * Point the service at one binding's seat flow.
   * @param stage - the staging move of the binding now owning the seat.
   * @returns the disposer that unbinds it.
   */
  bindStage(stage: (id: string) => void): () => void {
    this.stage = stage
    return () => {
      if (this.stage === stage) this.stage = undefined
    }
  }

  openExpertsPage(): boolean {
    if (this.openPage === undefined) return false
    this.openPage()
    return true
  }

  bindExpertPage(open: () => void): () => void {
    this.openPage = open
    return () => {
      if (this.openPage === open) this.openPage = undefined
    }
  }

  makeDefault(id: string): Promise<string | undefined> {
    const save = this.saveDefault
    if (save === undefined) return Promise.resolve(undefined)
    return save(id)
  }

  bindMakeDefault(save: (id: string) => Promise<string | undefined>): () => void {
    this.saveDefault = save
    return () => {
      if (this.saveDefault === save) this.saveDefault = undefined
    }
  }
}
