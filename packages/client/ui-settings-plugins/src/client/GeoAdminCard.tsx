/**
 * The 深度云海 configuration card: the backend address and publishing account
 * the GEO publishing tools sign in as, plus the account password. The password
 * is written through the credentials domain, never into the settings section,
 * so the literal never rides a response.
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SecretField, ValueField } from './fields.tsx'
import { PluginCard } from './PluginCard.tsx'
import type { GeoAdminCardFace } from './geo-admin-card-controller.ts'
import type {} from './slot-contract.ts'

/** Props the renderer binds for the 深度云海 card. */
export type GeoAdminCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<'settings.plugins'>
  & InjectFace<GeoAdminCardFace>

/** Locale keys addressing one field's label and hint. */
type GeoLabelKey = 'geoBaseUrl' | 'geoBaseUrlHint' | 'geoUsername' | 'geoUsernameHint'

/** One rendered section field: its DOM id, copy keys, and form field name. */
interface FieldSpec {
  id: string
  labelKey: GeoLabelKey
  hintKey: GeoLabelKey
  field: string
  placeholderKey?: 'geoBaseUrlPlaceholder'
}

/** Every section field in display order. */
const FIELDS: readonly FieldSpec[] = [
  { id: 'geo-admin-base-url', labelKey: 'geoBaseUrl', hintKey: 'geoBaseUrlHint', field: 'baseUrl', placeholderKey: 'geoBaseUrlPlaceholder' },
  { id: 'geo-admin-username', labelKey: 'geoUsername', hintKey: 'geoUsernameHint', field: 'username' },
]

/**
 * Render the 深度云海 configuration card.
 * @param props - locale copy, the card snapshot, and its form actions.
 * @returns the card.
 */
export function GeoAdminCard(props: GeoAdminCardProps) {
  const { t } = props
  const state = props.useGeoAdminCard(snapshot => snapshot)
  return (
    <PluginCard
      t={t}
      titleKey="geoTitle"
      descriptionKey="geoDescription"
      state={state}
      onSave={props.save}
      onDiscard={props.discard}
    >
      {FIELDS.flatMap((spec) => {
        const field = state.fields[spec.field]
        if (field === undefined) return []
        return (
          <ValueField
            key={spec.id}
            id={`plugin-config-${spec.id}`}
            label={t(spec.labelKey)}
            hint={t(spec.hintKey)}
            overriddenLabel={t('overridden')}
            resetLabel={t('reset')}
            invalidLabel={t('invalidNumber')}
            disabled={!state.writable}
            {...spec.placeholderKey === undefined ? {} : { placeholder: t(spec.placeholderKey) }}
            {...field}
            onEdit={(text) => { props.edit(spec.field, text) }}
            onReset={() => { props.resetField(spec.field) }}
          />
        )
      })}
      <SecretField
        id="plugin-config-geo-password"
        label={t('geoPassword')}
        hint={t('geoPasswordHint')}
        // The credentials domain accepts a value even when the settings
        // document is read-only; they are separate stores with separate
        // refusals.
        disabled={!state.passwordWritable}
        text={state.password.text}
        configured={state.passwordConfigured}
        stateLabel={state.passwordConfigured ? t('geoPasswordSet') : t('geoPasswordUnset')}
        onEdit={(text) => { props.edit('password', text) }}
      />
    </PluginCard>
  )
}
