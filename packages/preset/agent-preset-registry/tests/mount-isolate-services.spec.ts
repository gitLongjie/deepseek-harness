/** An isolated preset realm resolves host-provided services; only isolate-configured names fork. */
import { createScope } from '@deepseek-ai/dsh-scope'
import { expect, it, onTestFinished } from 'vitest'
import { harness } from './harness.ts'
import { auditRows, mountPreset } from '../src/mount.ts'

it('an entry-local isolate realm resolves a host-provided service', async () => {
  const ctx = await harness()
  onTestFinished(() => ctx.fiber.dispose())
  ctx.loader.builtins.credConsumer = { inject: ['credentials'], apply() {} }
  ctx.provide('credentials', { resolve: async () => undefined })

  const scope = createScope(ctx, {})
  const mount = await mountPreset(scope.ctx, 'probe', [
    { id: 'h3-video', name: 'cordis:group', group: true, isolate: { h3Video: true }, config: [
      { id: 'cred-row', name: 'cordis:credConsumer' },
    ] },
  ])
  const audit = await auditRows(mount.tree)
  expect(audit.failed).toEqual([])
  expect(audit.pending).toEqual([])
})
