/**
 * The H3 video cards' staged forms over the `h3-video` settings namespace.
 *
 * One controller class serves the three cards (local ComfyUI, hosted MiniMax,
 * output and disk): each binds the same scope with its own field list, so a
 * save writes only the fields that card shows. The MiniMax key is the one
 * control that does not live in the section — its literal never rides a
 * response — so the remote card learns only whether one is configured and
 * writes it through the credentials domain, addressed by the reference the
 * section names.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote merge into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { CardForm, numberField, textField, type CardActions, type CardFieldSpec, type CardFieldState, type CardShell } from './card-form.ts'

/**
 * Namespace of the H3 video configuration. Spelled here rather than imported:
 * a client package must not depend on a Host package.
 */
export const H3_VIDEO_NS = 'h3-video'

/** Credential reference the MiniMax backend resolves when the section names none. */
export const DEFAULT_MINIMAX_API_KEY_REF = 'MINIMAX_API_KEY'

/** The H3 fields this package's cards edit; field names mirror the Host namespace. */
export interface H3VideoSettings {
  /** Local ComfyUI base URL. */
  comfyUrl?: string
  /** Local ComfyUI workflow template path. */
  comfyWorkflowPath?: string
  /** Local ComfyUI input directory. */
  comfyInputDir?: string
  /** Local ComfyUI poll interval in milliseconds. */
  comfyPollIntervalMs?: number
  /** Local ComfyUI task timeout in milliseconds. */
  comfyTaskTimeoutMs?: number
  /** Local ComfyUI concurrent task limit. */
  comfyMaxConcurrency?: number
  /** Resolutions the local backend accepts. */
  comfyResolutions?: string[]
  /** Shortest local segment, in seconds. */
  comfyMinDurationSeconds?: number
  /** Longest local segment, in seconds. */
  comfyMaxDurationSeconds?: number
  /** Hosted MiniMax API base URL. */
  minimaxBaseUrl?: string
  /** Hosted MiniMax video model. */
  minimaxModel?: string
  /** Credential reference naming the hosted API key. */
  minimaxApiKeyRef?: string
  /** Hosted MiniMax poll interval in milliseconds. */
  minimaxPollIntervalMs?: number
  /** Hosted MiniMax task timeout in milliseconds. */
  minimaxTaskTimeoutMs?: number
  /** Hosted MiniMax concurrent task limit. */
  minimaxMaxConcurrency?: number
  /** Download directory for generated segments. */
  outputDir?: string
  /** Output-volume free-space floor in megabytes. */
  minFreeSpaceMb?: number
  /** Disk-usage estimate for the preflight, bytes per second. */
  estimatedBytesPerSecond?: number
}

/**
 * A comma-list field. An empty draft clears the field; any other draft parses
 * to the trimmed non-empty comma-separated list.
 * @param field - field name inside the namespace section.
 * @returns the field's conversion spec.
 */
function listField(field: string): CardFieldSpec {
  return {
    field,
    format: value => Array.isArray(value) ? value.join(', ') : '',
    parse: (text) => {
      const trimmed = text.trim()
      if (trimmed === '') return { kind: 'clear' }
      const list = trimmed.split(',').map(item => item.trim()).filter(item => item.length > 0)
      return list.length > 0 ? { kind: 'set', value: list } : undefined
    },
  }
}

/** The local ComfyUI card's fields. */
export const H3_LOCAL_FIELDS: readonly CardFieldSpec[] = [
  textField('comfyUrl'),
  textField('comfyWorkflowPath'),
  textField('comfyInputDir'),
  listField('comfyResolutions'),
  numberField('comfyMaxConcurrency'),
  numberField('comfyMinDurationSeconds'),
  numberField('comfyMaxDurationSeconds'),
  numberField('comfyPollIntervalMs'),
  numberField('comfyTaskTimeoutMs'),
]

/** The hosted MiniMax card's fields. */
export const H3_REMOTE_FIELDS: readonly CardFieldSpec[] = [
  textField('minimaxApiKeyRef'),
  textField('minimaxBaseUrl'),
  textField('minimaxModel'),
  numberField('minimaxMaxConcurrency'),
  numberField('minimaxPollIntervalMs'),
  numberField('minimaxTaskTimeoutMs'),
]

/** The output-and-disk card's fields. */
export const H3_OUTPUT_FIELDS: readonly CardFieldSpec[] = [
  textField('outputDir'),
  numberField('minFreeSpaceMb'),
  numberField('estimatedBytesPerSecond'),
]

/** Every H3 field in display order: local ComfyUI, hosted MiniMax, output and disk. */
export const H3_ALL_FIELDS: readonly CardFieldSpec[] = [...H3_LOCAL_FIELDS, ...H3_REMOTE_FIELDS, ...H3_OUTPUT_FIELDS]

/** What the credentials domain last reported, and for which reference. */
interface CredentialState {
  /** Reference this answer describes; a stale response for another one is dropped. */
  ref: string
  /** Whether any layer supplies a value for it. */
  configured: boolean
  /** Whether `credentials/set` can affect it; false disables the control. */
  writable: boolean
}

/** What one H3 card renders. */
export interface H3CardState extends CardShell {
  /** This card's fields, keyed by field name. */
  fields: Record<string, CardFieldState>
  /** The staged API key; present only on the remote card. */
  apiKey?: CardFieldState
  /** Whether the Host reports a credential configured for the referenced key. */
  apiKeyConfigured?: boolean
  /** Whether the credentials domain accepts a write for it; false disables the control. */
  apiKeyWritable?: boolean
}

/** The registration-side face one H3 card's slot entry injects. */
export interface H3CardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer. */
    h3Card: SnapshotStore<H3CardState>
  }
}

/** Bridges the `h3-video` scope (and, for the remote card, the credentials domain) onto one card. */
export class H3CardController {
  private readonly form: CardForm<H3VideoSettings>
  private readonly store: SnapshotStore<H3CardState>
  private readonly fieldNames: readonly string[]
  private credential: CredentialState | undefined

  /**
   * @param scope - the bound settings scope for the `h3-video` namespace.
   * @param fields - the field specs this card edits.
   * @param ctx - the card plugin's context; required only by the remote card,
   *   whose `remote.credentials` namespace answers for the key the section
   *   references.
   */
  constructor(
    private readonly scope: SettingsScope<H3VideoSettings>,
    fields: readonly CardFieldSpec[],
    private readonly ctx?: ClientContext,
  ) {
    this.fieldNames = fields.map(field => field.field)
    this.form = new CardForm(
      scope,
      [...fields],
      this.ctx === undefined ? [] : [{ field: 'minimaxApiKey', write: text => this.writeKey(text) }],
    )
    this.store = this.form.bind(() => this.projection())
    if (this.ctx !== undefined) {
      scope.subscribe(() => { void this.readCredential() })
      void this.readCredential()
    }
  }

  private projection(): H3CardState {
    const fields: Record<string, CardFieldState> = {}
    for (const name of this.fieldNames) fields[name] = this.form.field(name)
    if (this.ctx === undefined) return { ...this.form.shell(), fields }
    return {
      ...this.form.shell(),
      fields,
      apiKey: this.form.field('minimaxApiKey'),
      apiKeyConfigured: this.credential?.configured ?? false,
      apiKeyWritable: this.credential?.writable ?? true,
    }
  }

  /**
   * Ask the credentials domain about the reference the section currently names.
   * The answer is stored with the reference it describes: `minimaxApiKeyRef`
   * can change between the request and its response, and two reads can settle
   * out of order, so a response is published only while it still answers for
   * the reference in force.
   */
  private async readCredential(): Promise<void> {
    if (this.ctx === undefined) return
    const ref = refOf(this.scope.getSnapshot())
    if (this.credential?.ref !== ref) {
      // A new reference knows nothing yet; keeping the old answer would claim
      // the key is configured under a name nobody has checked.
      this.credential = { ref, configured: false, writable: true }
      this.store.set(this.projection())
    }
    const response = await this.ctx.remote.credentials.describe([ref])
    if (!response.ok || ref !== refOf(this.scope.getSnapshot())) return
    const view = response.value[ref]
    const configured = view?.configured ?? false
    // An unknown reference is treated as writable: the control stays usable
    // and the Host is what refuses, rather than the card guessing a refusal.
    const writable = view?.writable ?? true
    if (this.credential.configured === configured && this.credential.writable === writable) return
    this.credential = { ref, configured, writable }
    this.store.set(this.projection())
  }

  /**
   * Re-read after the Host reports a change to the reference this card watches.
   * @param ref - the reference the Host reports as changed.
   */
  refreshCredential(ref: string): void {
    if (this.ctx === undefined || ref !== this.credential?.ref) return
    void this.readCredential()
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): H3CardFace {
    return { hooks: { h3Card: this.store }, ...this.form.actions() }
  }

  /**
   * Write the staged key, then re-read whether the Host now holds one.
   * @param value - the staged credential literal.
   * @returns whether the Host reports a configured credential afterwards.
   */
  private async writeKey(value: string): Promise<boolean> {
    if (this.ctx === undefined) return false
    // Refusals surface through the re-read below: the Host is the only
    // authority on whether the key now exists.
    await this.ctx.remote.credentials.set(refOf(this.scope.getSnapshot()), value)
    await this.readCredential()
    return this.credential?.configured ?? false
  }
}

/**
 * The credential reference the section names, or the provider's default.
 * @param snapshot - the current scope snapshot.
 * @returns the reference to address.
 */
function refOf(snapshot: SettingsScopeSnapshot<H3VideoSettings>): string {
  const declared = snapshot.value?.minimaxApiKeyRef
  return declared !== undefined && declared.length > 0 ? declared : DEFAULT_MINIMAX_API_KEY_REF
}
