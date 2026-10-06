/**
 * The H3 video configuration card: local ComfyUI, hosted MiniMax, and output
 * with disk policy, over one settings namespace. The MiniMax key is written
 * through the credentials domain, never into the settings section, so the
 * literal never rides a response.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SecretField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { H3CardFace } from './h3-video-card-controller.ts'
import type {} from './slot-contract.ts'

/** Props the renderer binds for the H3 card. */
export type H3VideoCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<H3CardFace>

/** Locale keys addressing one H3 field's label and hint. */
type H3LabelKey =
  | 'h3ComfyUrl' | 'h3ComfyUrlHint' | 'h3ComfyWorkflowPath' | 'h3ComfyWorkflowPathHint'
  | 'h3ComfyInputDir' | 'h3ComfyInputDirHint' | 'h3ComfyResolutions' | 'h3ComfyResolutionsHint'
  | 'h3ComfyMaxConcurrency' | 'h3ComfyMaxConcurrencyHint' | 'h3ComfyMinDuration' | 'h3ComfyMinDurationHint'
  | 'h3ComfyMaxDuration' | 'h3ComfyMaxDurationHint' | 'h3ComfyPollInterval' | 'h3ComfyPollIntervalHint'
  | 'h3ComfyTaskTimeout' | 'h3ComfyTaskTimeoutHint'
  | 'h3MinimaxApiKeyRef' | 'h3MinimaxApiKeyRefHint' | 'h3MinimaxBaseUrl' | 'h3MinimaxBaseUrlHint'
  | 'h3MinimaxModel' | 'h3MinimaxModelHint' | 'h3MinimaxMaxConcurrency' | 'h3MinimaxMaxConcurrencyHint'
  | 'h3MinimaxPollInterval' | 'h3MinimaxPollIntervalHint' | 'h3MinimaxTaskTimeout' | 'h3MinimaxTaskTimeoutHint'
  | 'h3OutputDir' | 'h3OutputDirHint' | 'h3MinFreeSpaceMb' | 'h3MinFreeSpaceMbHint'
  | 'h3EstimatedBytesPerSecond' | 'h3EstimatedBytesPerSecondHint'

/** One rendered field: its DOM id, copy keys, numeric flag, and form field name. */
interface FieldSpec {
  id: string
  labelKey: H3LabelKey
  hintKey: H3LabelKey
  numeric?: boolean
  field: string
}

/** Every field in display order: local ComfyUI, hosted MiniMax, output and disk. */
const FIELDS: readonly FieldSpec[] = [
  { id: 'h3-comfy-url', labelKey: 'h3ComfyUrl', hintKey: 'h3ComfyUrlHint', field: 'comfyUrl' },
  { id: 'h3-comfy-workflow', labelKey: 'h3ComfyWorkflowPath', hintKey: 'h3ComfyWorkflowPathHint', field: 'comfyWorkflowPath' },
  { id: 'h3-comfy-input', labelKey: 'h3ComfyInputDir', hintKey: 'h3ComfyInputDirHint', field: 'comfyInputDir' },
  { id: 'h3-comfy-resolutions', labelKey: 'h3ComfyResolutions', hintKey: 'h3ComfyResolutionsHint', field: 'comfyResolutions' },
  { id: 'h3-comfy-concurrency', labelKey: 'h3ComfyMaxConcurrency', hintKey: 'h3ComfyMaxConcurrencyHint', numeric: true, field: 'comfyMaxConcurrency' },
  { id: 'h3-comfy-min-duration', labelKey: 'h3ComfyMinDuration', hintKey: 'h3ComfyMinDurationHint', numeric: true, field: 'comfyMinDurationSeconds' },
  { id: 'h3-comfy-max-duration', labelKey: 'h3ComfyMaxDuration', hintKey: 'h3ComfyMaxDurationHint', numeric: true, field: 'comfyMaxDurationSeconds' },
  { id: 'h3-comfy-poll', labelKey: 'h3ComfyPollInterval', hintKey: 'h3ComfyPollIntervalHint', numeric: true, field: 'comfyPollIntervalMs' },
  { id: 'h3-comfy-timeout', labelKey: 'h3ComfyTaskTimeout', hintKey: 'h3ComfyTaskTimeoutHint', numeric: true, field: 'comfyTaskTimeoutMs' },
  { id: 'h3-minimax-keyref', labelKey: 'h3MinimaxApiKeyRef', hintKey: 'h3MinimaxApiKeyRefHint', field: 'minimaxApiKeyRef' },
  { id: 'h3-minimax-baseurl', labelKey: 'h3MinimaxBaseUrl', hintKey: 'h3MinimaxBaseUrlHint', field: 'minimaxBaseUrl' },
  { id: 'h3-minimax-model', labelKey: 'h3MinimaxModel', hintKey: 'h3MinimaxModelHint', field: 'minimaxModel' },
  { id: 'h3-minimax-concurrency', labelKey: 'h3MinimaxMaxConcurrency', hintKey: 'h3MinimaxMaxConcurrencyHint', numeric: true, field: 'minimaxMaxConcurrency' },
  { id: 'h3-minimax-poll', labelKey: 'h3MinimaxPollInterval', hintKey: 'h3MinimaxPollIntervalHint', numeric: true, field: 'minimaxPollIntervalMs' },
  { id: 'h3-minimax-timeout', labelKey: 'h3MinimaxTaskTimeout', hintKey: 'h3MinimaxTaskTimeoutHint', numeric: true, field: 'minimaxTaskTimeoutMs' },
  { id: 'h3-output-dir', labelKey: 'h3OutputDir', hintKey: 'h3OutputDirHint', field: 'outputDir' },
  { id: 'h3-min-free', labelKey: 'h3MinFreeSpaceMb', hintKey: 'h3MinFreeSpaceMbHint', numeric: true, field: 'minFreeSpaceMb' },
  { id: 'h3-estimated-bps', labelKey: 'h3EstimatedBytesPerSecond', hintKey: 'h3EstimatedBytesPerSecondHint', numeric: true, field: 'estimatedBytesPerSecond' },
]

/**
 * Render the H3 video configuration card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function H3VideoCard(props: H3VideoCardProps) {
  const { t } = props
  const state = props.useH3Card(snapshot => snapshot)
  const disabled = !state.writable
  const fields = FIELDS.flatMap((spec) => {
    const field = state.fields[spec.field]
    return field === undefined ? [] : [{ spec, field }]
  })
  return (
    <PluginCard
      t={t}
      titleKey="h3Title"
      descriptionKey="h3Description"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      {state.apiKey !== undefined && (
        <SecretField
          id="plugin-config-h3-minimax-key"
          label={t('h3MinimaxApiKey')}
          hint={t('h3MinimaxApiKeyHint')}
          // The credentials domain accepts a key even when the settings
          // document itself is read-only; they are separate stores with
          // separate refusals.
          disabled={!(state.apiKeyWritable ?? true)}
          text={state.apiKey.text}
          configured={state.apiKeyConfigured ?? false}
          stateLabel={state.apiKeyConfigured === true ? t('h3MinimaxApiKeySet') : t('h3MinimaxApiKeyUnset')}
          onEdit={(text) => { props.edit('minimaxApiKey', text) }}
        />
      )}
      {fields.map(({ spec, field }) => (
        <ValueField
          key={spec.id}
          id={`plugin-config-${spec.id}`}
          label={t(spec.labelKey)}
          hint={t(spec.hintKey)}
          overriddenLabel={t('overridden')}
          resetLabel={t('reset')}
          invalidLabel={t('invalidNumber')}
          numeric={spec.numeric === true}
          disabled={disabled}
          {...field}
          onEdit={(text) => { props.edit(spec.field, text) }}
          onReset={() => { props.resetField(spec.field) }}
        />
      ))}
    </PluginCard>
  )
}
