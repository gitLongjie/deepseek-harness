import type { Volatile } from '@deepseek-ai/cordis'
import type { AgentPresetRow } from './types.ts'
/** Public preset roster and selection configuration. */
/** One declared preset and its current activation failure, if any. */
export interface AgentPreset extends Omit<AgentPresetRow, 'isDefault'> {
  readonly order?: number
}

/** Registry selection policy. */
export interface Config {
  /** Deployment default when the caller omits a preset. */
  default: string
  /** User-selected default; edited through Settings. */
  selectedDefault: Volatile<string | undefined>
}
