/**
 * Browser half of the native directory-picker backend: fills ui-workspace's
 * two directory-flow holes with a renderless occupant that answers each
 * `open` by driving `directoryPicker/pick` (the node half's OS chooser) and
 * reporting the one outcome — picked path, cancellation, or failure — back
 * through the owner conversation. Mounting this package therefore composes
 * both sides of the native interaction with one cordis.yml row; no client
 * code branches on a capability kind.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the SlotMap merge declaring the directory-flow holes.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { NativeFlowInjected } from './flow.ts'
import { NativeDirectoryFlow } from './flow.ts'


/** This optional surface does not block client boot while the renderer starts. */
export const inject: string[] = []

/**
 * Client plugin body: register the renderless native flow into both
 * directory-flow holes through `slots.inject()` because the ui-workspace
 * entries may activate later or replace their declarations.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const injected = (): NativeFlowInjected => ({
    pick: () => {
      const uiWorkspace = ctx.get('uiWorkspace')
      if (uiWorkspace === undefined) throw new Error('ui-directory-picker-native: uiWorkspace is unavailable')
      return uiWorkspace.pickDirectory()
    },
  })
  let installed = false
  const install = (): void => {
    if (installed) return
    const slots = ctx.get('slots') as SlotRegistry | undefined
    if (slots === undefined) return
    installed = true
    // Both declaration lifetimes must be live before the pair installs; the
    // generator makes the two registrations one transactional effect. The
    // outer/inner nesting order is arbitrary; neither hole has precedence.
    slots.inject('conversation.hero.workspace.directoryFlow', () =>
      slots.inject('sidebar.workspaces.directoryFlow', function* () {
        yield slots.register({
          name: 'conversation.hero.workspace.directoryFlow', inject: injected,
        }, NativeDirectoryFlow)
        yield slots.register({
          name: 'sidebar.workspaces.directoryFlow', inject: injected,
        }, NativeDirectoryFlow)
      }))
  }
  install()
  ctx.effect(() => ctx.on('internal/status', install), 'directory-picker-native: await renderer slots')
}
