/**
 * The 深度云海 card's staged form over the `geo-admin` settings namespace.
 *
 * The section carries the backend address and the publishing account; the
 * password is the one control that does not live there — its literal never
 * rides a response — so the card learns only whether one is configured and
 * writes it through the credentials domain under a fixed reference.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote merge into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  CardForm, textField,
  type CardActions, type CardFieldSpec, type CardFieldState, type CardShell,
} from './card-form.ts'

/**
 * Namespace of the 深度云海 configuration. Spelled here rather than imported:
 * a client package must not depend on a Host package.
 */
export const GEO_ADMIN_NS = 'geo-admin'

/** Credential reference resolving the publishing account's password. */
export const GEO_ADMIN_PASSWORD_REF = 'GEO_ADMIN_PASSWORD'

/** The fields this card edits; field names mirror the Host namespace. */
export interface GeoAdminSettings {
  /** Backend origin. */
  baseUrl?: string
  /** Publishing account name. */
  username?: string
}

/** Every section field this card edits, in display order. */
const FIELDS: readonly CardFieldSpec[] = [textField('baseUrl'), textField('username')]

/** What the credentials domain last reported for the fixed reference. */
interface CredentialState {
  /** Whether any layer supplies a value for it. */
  configured: boolean
  /** Whether `credentials/set` can affect it; false disables the control. */
  writable: boolean
}

/** What the 深度云海 card renders. */
export interface GeoAdminCardState extends CardShell {
  /** The section fields, keyed by field name. */
  fields: Record<string, CardFieldState>
  /** The staged password. */
  password: CardFieldState
  /** Whether the Host reports a stored password. */
  passwordConfigured: boolean
  /** Whether the credentials domain accepts a write for the password. */
  passwordWritable: boolean
}

/** The registration-side face the card's slot entry injects. */
export interface GeoAdminCardFace extends CardActions {
  hooks: {
    /** Card snapshot bound by the renderer. */
    geoAdminCard: SnapshotStore<GeoAdminCardState>
  }
}

/** Bridges the `geo-admin` scope and the credentials domain onto the card. */
export class GeoAdminCardController {
  private readonly form: CardForm<GeoAdminSettings>
  private readonly store: SnapshotStore<GeoAdminCardState>
  private credential: CredentialState | undefined

  /**
   * @param scope - the bound settings scope for the `geo-admin` namespace.
   * @param ctx - the card plugin's context, whose `remote.credentials` domain
   *   answers for the fixed password reference.
   */
  constructor(
    scope: SettingsScope<GeoAdminSettings>,
    private readonly ctx: ClientContext,
  ) {
    this.form = new CardForm(
      scope,
      [...FIELDS],
      [{ field: 'password', write: (text: string) => this.writePassword(text) }],
    )
    this.store = this.form.bind(() => this.projection())
    scope.subscribe(() => { void this.readCredential() })
    void this.readCredential()
  }

  /**
   * Build the face the card's slot registration injects.
   * @returns the card's snapshot and its form actions.
   */
  inject(): GeoAdminCardFace {
    return { hooks: { geoAdminCard: this.store }, ...this.form.actions() }
  }

  /**
   * Re-read after the Host reports a change to a reference this card watches.
   * @param ref - the reference the Host reports as changed.
   */
  refreshCredential(ref: string): void {
    if (ref !== GEO_ADMIN_PASSWORD_REF) return
    void this.readCredential()
  }

  /** Rebuild the card's state from the form and the last credential answer. */
  private projection(): GeoAdminCardState {
    const fields: Record<string, CardFieldState> = {}
    for (const spec of FIELDS) fields[spec.field] = this.form.field(spec.field)
    return {
      ...this.form.shell(),
      fields,
      password: this.form.field('password'),
      passwordConfigured: this.credential?.configured ?? false,
      passwordWritable: this.credential?.writable ?? true,
    }
  }

  /** Ask the credentials domain whether the password reference is configured. */
  private async readCredential(): Promise<void> {
    const response = await this.ctx.remote.credentials.describe([GEO_ADMIN_PASSWORD_REF])
    if (!response.ok) return
    const view = response.value[GEO_ADMIN_PASSWORD_REF]
    const configured = view?.configured ?? false
    // An unknown reference is treated as writable: the control stays usable
    // and the Host is what refuses, rather than the card guessing a refusal.
    const writable = view?.writable ?? true
    if (this.credential?.configured === configured && this.credential.writable === writable) return
    this.credential = { configured, writable }
    this.store.set(this.projection())
  }

  /**
   * Write the staged password, then re-read whether the Host now holds it.
   * @param value - the staged password.
   * @returns whether the Host reports a stored password afterwards.
   */
  private async writePassword(value: string): Promise<boolean> {
    // A refusal surfaces through the re-read below: the Host is the only
    // authority on whether the credential now exists.
    await this.ctx.remote.credentials.set(GEO_ADMIN_PASSWORD_REF, value)
    await this.readCredential()
    return this.credential?.configured ?? false
  }
}
