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
   * A no-op while no conversation flow is bound: there is no seat to land
   * the pick on, and the caller surfaces that by starting nothing.
   * @param id - the preset id the next session should compose.
   */
  stageNextSessionPreset(id: string): void
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

  /** @param ctx - Client root Context. */
  constructor(ctx: Context) {
    super(ctx, 'uiAgentPreset')
  }

  /** @param id - the preset id the next session should compose. */
  stageNextSessionPreset(id: string): void {
    this.stage?.(id)
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
}
